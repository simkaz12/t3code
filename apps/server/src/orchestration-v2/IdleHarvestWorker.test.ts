import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as IdleHarvestWorker from "./IdleHarvestWorker.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const MINUTE_MS = 60_000;
const startMs = Date.parse("2026-11-02T12:00:00.000Z");
const at = (agoMs: number) => DateTime.makeUnsafe(startMs - agoMs);

const shellOf = (name: string, overrides: Partial<OrchestrationV2ThreadShell> = {}) =>
  ({
    id: ThreadId.make(`thread:${name}`),
    projectId: ProjectId.make("project:harvest"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    lineage: { relationshipToParent: "root" },
    status: "completed",
    latestRunId: RunId.make(`run:${name}`),
    activeRunId: null,
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    archivedAt: null,
    settledAt: null,
    settledOverride: null,
    snoozedUntil: null,
    createdAt: at(24 * 60 * MINUTE_MS),
    latestUserMessageAt: at(62 * MINUTE_MS),
    latestUserAuthoredMessageAt: at(62 * MINUTE_MS),
    latestRunRequestedAt: at(62 * MINUTE_MS),
    latestRunStartedAt: at(62 * MINUTE_MS),
    latestRunCompletedAt: at(61 * MINUTE_MS),
    harvest: null,
    ...overrides,
  }) as unknown as OrchestrationV2ThreadShell;

const messagesFor = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `message:${index}`,
    role: "user",
    createdBy: "user",
    updatedAt: at(70 * MINUTE_MS - index),
  }));

const timelineItem = (position: number, type: string, toolName: string | null = null) => ({
  position,
  sourceThreadId: ThreadId.make("thread:source"),
  sourceItemId: `item:${position}`,
  visibility: "local",
  item: { type, toolName },
});

type Shells = Ref.Ref<ReadonlyArray<OrchestrationV2ThreadShell>>;

interface HarnessOptions {
  readonly messageCounts?: Readonly<Record<string, number>>;
  readonly timelines?: Readonly<Record<string, ReadonlyArray<ReturnType<typeof timelineItem>>>>;
  readonly memoryServerUrl?: string;
  readonly afterSnapshot?: (shells: Shells) => Effect.Effect<void>;
  readonly afterDispatch?: (shells: Shells) => Effect.Effect<void>;
}

const updateShell = (
  shells: Shells,
  threadId: string,
  patch: Partial<OrchestrationV2ThreadShell>,
) =>
  Ref.update(shells, (current) =>
    current.map((thread) =>
      thread.id === threadId ? ({ ...thread, ...patch } as OrchestrationV2ThreadShell) : thread,
    ),
  );

const makeHarness = (
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  options: HarnessOptions = {},
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(startMs);
    const messageCounts = options.messageCounts ?? {};
    const shells: Shells = yield* Ref.make(threads);
    const memoryServerUrl = yield* Ref.make(options.memoryServerUrl ?? "http://memory.test");
    const settingsReads = yield* Queue.unbounded<void>();
    const dispatched = yield* Queue.unbounded<{
      readonly threadId: ThreadId;
      readonly command: unknown;
    }>();
    const stamped = yield* Queue.unbounded<{
      readonly threadId: ThreadId;
      readonly harvest: unknown;
    }>();
    const checkpointed = yield* Queue.unbounded<{
      readonly threadId: ThreadId;
      readonly harvest: unknown;
    }>();
    const timelineReads = yield* Queue.unbounded<unknown>();
    const sweeps = yield* Queue.unbounded<void>();
    const layer = IdleHarvestWorker.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Scheduler.layer,
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getShellSnapshot: () =>
              Queue.offer(sweeps, undefined).pipe(
                Effect.andThen(Ref.get(shells)),
                Effect.tap(() => options.afterSnapshot?.(shells) ?? Effect.void),
                Effect.map((current) => ({ threads: current, archivedThreads: [] }) as never),
              ),
            getThreadShell: (threadId) =>
              Ref.get(shells).pipe(
                Effect.map((current) => current.find((thread) => thread.id === threadId) ?? null),
              ),
            getTimelinePage: (threadId, pageOptions) =>
              Queue.offer(timelineReads, pageOptions).pipe(
                Effect.as({
                  items: (options.timelines?.[threadId] ?? []).filter(
                    (projected) => projected.position > (pageOptions.afterPosition ?? -1),
                  ),
                  totalItems: 0,
                  hasMore: false,
                } as never),
              ),
            getThreadRecords: (threadId) =>
              Effect.succeed({
                messages: messagesFor(messageCounts[threadId] ?? 3),
                contextTransfers: [],
              } as never),
          }),
          Layer.mock(Orchestrator.OrchestratorV2)({
            dispatch: (command) =>
              updateShell(shells, (command as { threadId: ThreadId }).threadId, {
                activityRunStatus: "running",
              }).pipe(
                Effect.andThen(options.afterDispatch?.(shells) ?? Effect.void),
                Effect.andThen(
                  Queue.offer(dispatched, {
                    threadId: (command as { threadId: ThreadId }).threadId,
                    command,
                  }),
                ),
                Effect.as({
                  sequence: 1,
                  storedEvents: [
                    {
                      sequence: 1,
                      commandId: null,
                      event: {
                        type: "run.created",
                        threadId: (command as { threadId: ThreadId }).threadId,
                        payload: {
                          id: `run:harvest:${(command as { threadId: string }).threadId}`,
                        },
                      },
                    },
                  ],
                } as never),
              ),
            setHarvestCheckpoint: (input) =>
              updateShell(shells, input.threadId, {
                harvest: input.harvest as OrchestrationV2ThreadShell["harvest"],
              }).pipe(
                Effect.andThen(
                  Queue.offer(checkpointed, { threadId: input.threadId, harvest: input.harvest }),
                ),
                Effect.asVoid,
              ),
            setHarvestPendingRun: (input) =>
              Ref.get(shells).pipe(
                Effect.map((current) => current.find((thread) => thread.id === input.threadId)),
                Effect.map((thread) => ({
                  at: DateTime.makeUnsafe(startMs),
                  position: -1,
                  itemId: null,
                  runId: null,
                  ...thread?.harvest,
                  pendingRunId: input.harvestPendingRunId,
                })),
                Effect.tap((harvest) =>
                  updateShell(shells, input.threadId, {
                    harvest: harvest as OrchestrationV2ThreadShell["harvest"],
                  }),
                ),
                Effect.flatMap((harvest) =>
                  Queue.offer(stamped, { threadId: input.threadId, harvest }),
                ),
                Effect.asVoid,
              ),
          }),
          Layer.mock(ServerSettings.ServerSettingsService)({
            getSettings: Ref.get(memoryServerUrl).pipe(
              Effect.tap(() => Queue.offer(settingsReads, undefined)),
              Effect.map(
                (url) =>
                  ({
                    providerInstances: {},
                    projectSettingsOverrides: {},
                    memoryServerUrl: url,
                  }) as never,
              ),
            ),
          }),
        ),
      ),
    );
    return {
      shells,
      memoryServerUrl,
      dispatched,
      stamped,
      checkpointed,
      timelineReads,
      sweeps,
      settingsReads,
      layer,
    };
  });

it.effect("dispatches one harvest for an hour-idle thread and records the pending run", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness([shellOf("a")]);
    yield* Effect.gen(function* () {
      const first = yield* Queue.take(harness.dispatched);
      assert.deepInclude(first.command as object, {
        type: "message.dispatch",
        commandId: "server:harvest:thread:a:run:a",
        messageId: "harvest:thread:a:run:a",
        threadId: "thread:a",
        text: "Harvest this thread",
        createdBy: "agent",
        creationSource: "server",
        harvest: "idle",
        dispatchMode: { type: "start_immediately" },
      });
      assert.notProperty(first.command as object, "modelSelection");

      const stamp = yield* Queue.take(harness.stamped);
      assert.deepInclude(stamp.harvest as object, {
        position: -1,
        itemId: null,
        runId: null,
        pendingRunId: "run:harvest:thread:a",
      });
      assert.equal(yield* Queue.size(harness.dispatched), 0);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("does not dispatch again while the pending harvest run is the latest run", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness([shellOf("a")]);
    yield* Effect.gen(function* () {
      assert.equal((yield* Queue.take(harness.dispatched)).threadId, "thread:a");
      yield* Queue.take(harness.stamped);
      yield* Ref.update(harness.shells, (current) => [
        ...current.map(
          (thread) =>
            ({
              ...thread,
              latestRunId: RunId.make("run:harvest:thread:a"),
              activityRunStatus: null,
              latestRunCompletedAt: DateTime.makeUnsafe(startMs),
            }) as OrchestrationV2ThreadShell,
        ),
        shellOf("control"),
      ]);

      yield* TestClock.adjust("61 minutes");
      assert.equal((yield* Queue.take(harness.dispatched)).threadId, "thread:control");
      assert.equal(yield* Queue.size(harness.dispatched), 0);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect(
  "does not dispatch when the checkpoint is newer than the last user-authored message",
  () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([
        shellOf("checkpointed", {
          harvest: {
            at: at(30 * MINUTE_MS),
            position: 12,
            itemId: "item:last",
            runId: RunId.make("run:earlier"),
            pendingRunId: null,
          },
        }),
        shellOf("control"),
      ]);
      yield* Effect.gen(function* () {
        assert.equal((yield* Queue.take(harness.dispatched)).threadId, "thread:control");
        assert.equal(yield* Queue.size(harness.dispatched), 0);
      }).pipe(Effect.provide(harness.layer));
    }),
);

it.effect("does not dispatch for fewer than three user messages", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness([shellOf("short"), shellOf("control")], {
      messageCounts: { "thread:short": 2 },
    });
    yield* Effect.gen(function* () {
      assert.equal((yield* Queue.take(harness.dispatched)).threadId, "thread:control");
      assert.equal(yield* Queue.size(harness.dispatched), 0);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("does not dispatch for an archived thread", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness([
      shellOf("archived", { archivedAt: at(10 * MINUTE_MS) }),
      shellOf("control"),
    ]);
    yield* Effect.gen(function* () {
      assert.equal((yield* Queue.take(harness.dispatched)).threadId, "thread:control");
      assert.equal(yield* Queue.size(harness.dispatched), 0);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("waits for the hour mark, then dispatches", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness([
      shellOf("early", { latestRunCompletedAt: at(59 * MINUTE_MS) }),
      shellOf("control"),
    ]);
    yield* Effect.gen(function* () {
      assert.equal((yield* Queue.take(harness.dispatched)).threadId, "thread:control");
      assert.equal(yield* Queue.size(harness.dispatched), 0);

      yield* TestClock.adjust("2 minutes");
      assert.equal((yield* Queue.take(harness.dispatched)).threadId, "thread:early");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("skips the sweep while memory is not configured, then dispatches once it is", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness([shellOf("a")], { memoryServerUrl: "" });
    yield* Effect.gen(function* () {
      yield* Queue.take(harness.settingsReads);
      assert.equal(yield* Queue.size(harness.sweeps), 0);
      assert.equal(yield* Queue.size(harness.dispatched), 0);

      yield* Ref.set(harness.memoryServerUrl, "http://memory.test");
      yield* TestClock.adjust("5 minutes");
      assert.equal((yield* Queue.take(harness.dispatched)).threadId, "thread:a");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("does not dispatch when the thread gained an active run after the snapshot", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness([shellOf("resumed"), shellOf("control")], {
      afterSnapshot: (shells) =>
        updateShell(shells, "thread:resumed", {
          status: "running",
          activeRunId: RunId.make("run:resumed:next"),
        }),
    });
    yield* Effect.gen(function* () {
      assert.equal((yield* Queue.take(harness.dispatched)).threadId, "thread:control");
      assert.equal(yield* Queue.size(harness.dispatched), 0);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("keeps a checkpoint stamped between the dispatch and the pending write", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness([shellOf("a")], {
      afterDispatch: (shells) =>
        updateShell(shells, "thread:a", {
          harvest: {
            at: at(MINUTE_MS),
            position: 7,
            itemId: "item:begun",
            runId: RunId.make("run:begun"),
            pendingRunId: null,
          },
        }),
    });
    yield* Effect.gen(function* () {
      yield* Queue.take(harness.dispatched);
      const stamp = yield* Queue.take(harness.stamped);
      assert.deepInclude(stamp.harvest as object, {
        position: 7,
        itemId: "item:begun",
        runId: "run:begun",
        pendingRunId: "run:harvest:thread:a",
      });
    }).pipe(Effect.provide(harness.layer));
  }),
);

const proposedSkipCase = (toolName: string) =>
  Effect.gen(function* () {
    const harness = yield* makeHarness(
      [
        shellOf("proposed", {
          harvest: {
            at: at(120 * MINUTE_MS),
            position: 4,
            itemId: "item:4",
            runId: RunId.make("run:earlier"),
            pendingRunId: null,
          },
        }),
        shellOf("control"),
      ],
      {
        timelines: {
          "thread:proposed": [
            timelineItem(3, "dynamic_tool", "memory_propose"),
            timelineItem(5, "assistant_message"),
            timelineItem(6, "dynamic_tool", toolName),
            timelineItem(7, "assistant_message"),
          ],
        },
      },
    );
    yield* Effect.gen(function* () {
      assert.equal((yield* Queue.take(harness.dispatched)).threadId, "thread:control");

      const checkpoint = yield* Queue.take(harness.checkpointed);
      assert.equal(checkpoint.threadId, "thread:proposed");
      assert.deepInclude(checkpoint.harvest as object, {
        position: 7,
        itemId: "item:7",
        runId: "run:proposed",
        pendingRunId: null,
      });
      assert.equal(yield* Queue.size(harness.dispatched), 0);
      assert.equal(yield* Queue.size(harness.checkpointed), 0);
    }).pipe(Effect.provide(harness.layer));
  });

it.effect("skips the harvest and advances the checkpoint after a Claude-form memory_propose", () =>
  proposedSkipCase("mcp__t3-code__memory_propose"),
);

it.effect("skips the harvest and advances the checkpoint after a bare memory_propose", () =>
  proposedSkipCase("memory_propose"),
);

it.effect("skips the harvest after a server-dot-tool memory_propose", () =>
  proposedSkipCase("t3-code.memory_propose"),
);

it.effect("reads the timeline after the checkpoint position in the activity view", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness([
      shellOf("a", {
        harvest: {
          at: at(120 * MINUTE_MS),
          position: 9,
          itemId: "item:9",
          runId: RunId.make("run:earlier"),
          pendingRunId: null,
        },
      }),
    ]);
    yield* Effect.gen(function* () {
      yield* Queue.take(harness.dispatched);
      const read = yield* Queue.take(harness.timelineReads);
      assert.deepEqual(read, { afterPosition: 9, view: "activity", limit: 200 });
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("dispatches when the span holds other tool calls but no memory_propose", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness([shellOf("a")], {
      timelines: {
        "thread:a": [
          timelineItem(0, "dynamic_tool", "mcp__t3-code__memory_recall"),
          timelineItem(1, "dynamic_tool", "memory_propose_notes"),
          timelineItem(2, "dynamic_tool", null),
          timelineItem(3, "assistant_message"),
        ],
      },
    });
    yield* Effect.gen(function* () {
      assert.equal((yield* Queue.take(harness.dispatched)).threadId, "thread:a");
      assert.equal(yield* Queue.size(harness.checkpointed), 0);
    }).pipe(Effect.provide(harness.layer));
  }),
);
