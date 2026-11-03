import { assert, it } from "@effect/vitest";
import { ProjectId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as MemoryNoticeService from "./MemoryNoticeService.ts";

const shellOf = (name: string, overrides: Partial<OrchestrationV2ThreadShell> = {}) =>
  ({
    id: ThreadId.make(`thread:${name}`),
    projectId: ProjectId.make("project:notice"),
    archivedAt: null,
    settledAt: null,
    settledOverride: null,
    ...overrides,
  }) as unknown as OrchestrationV2ThreadShell;

const entry = (
  thread: string,
  outcome: MemoryNoticeService.MemoryNoticeOutcome,
  overrides: Partial<MemoryNoticeService.MemoryNoticeEntry> = {},
): MemoryNoticeService.MemoryNoticeEntry => ({
  threadId: `thread:${thread}`,
  headline: `headline ${thread}`,
  outcome,
  edited: false,
  ...overrides,
});

const withService = <A, E>(
  shells: ReadonlyArray<OrchestrationV2ThreadShell>,
  body: (
    service: MemoryNoticeService.MemoryNoticeService["Service"],
    dispatched: Queue.Queue<Record<string, unknown>>,
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-03T10:00:00.000Z"));
    const dispatched = yield* Queue.unbounded<Record<string, unknown>>();
    const layer = MemoryNoticeService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getThreadShell: (threadId) =>
              Effect.succeed(shells.find((shell) => shell.id === threadId) ?? null),
          }),
          Layer.mock(Orchestrator.OrchestratorV2)({
            dispatch: (command) =>
              Queue.offer(dispatched, command as unknown as Record<string, unknown>).pipe(
                Effect.as({ sequence: 1, storedEvents: [] } as never),
              ),
          }),
        ),
      ),
    );

    return yield* Effect.gen(function* () {
      const service = yield* MemoryNoticeService.MemoryNoticeService;

      return yield* body(service, dispatched);
    }).pipe(Effect.provide(layer));
  });

const threadOf = (command: unknown) => String((command as { threadId: string }).threadId);

const drain = (queue: Queue.Queue<Record<string, unknown>>) =>
  Queue.clear(queue).pipe(Effect.map((items) => items as ReadonlyArray<Record<string, unknown>>));

it.effect("sends one queued server message per origin thread with the composed text", () =>
  withService([shellOf("a")], (service, dispatched) =>
    Effect.gen(function* () {
      yield* service.record(entry("a", "approved"));
      yield* service.record(entry("a", "approved", { headline: "Second", edited: true }));
      yield* service.record(entry("a", "rejected", { headline: "Third", reason: "derivable" }));
      yield* service.record(entry("a", "reinforced"));
      yield* service.record(entry("a", "superseded"));
      yield* service.flush();

      const sent = yield* drain(dispatched);
      assert.equal(sent.length, 1);
      assert.deepInclude(sent[0], {
        type: "message.dispatch",
        threadId: "thread:a",
        createdBy: "agent",
        creationSource: "server",
        memoryNotice: "tray-empty",
        text: "Memory tray resolved: 2 approved (headline a; Second, edited), 1 rejected (Third: derivable), 1 reinforced, 1 superseded.",
      });
      assert.deepEqual(sent[0]?.dispatchMode, { type: "queue_after_active" });
      assert.match(String(sent[0]?.commandId), /^server:memory-notice:thread:a:\d+$/);
      assert.match(String(sent[0]?.messageId), /^memory-notice:thread:a:\d+$/);
    }),
  ),
);

it.effect("sends each thread its own notice, built from only its tiles", () =>
  withService([shellOf("a"), shellOf("b")], (service, dispatched) =>
    Effect.gen(function* () {
      yield* service.record(entry("a", "approved"));
      yield* service.record(entry("b", "rejected", { reason: "status" }));
      yield* service.flush();

      const sent = yield* drain(dispatched);
      assert.deepEqual(
        sent.map(({ threadId, text }) => [threadId, text]),
        [
          ["thread:a", "Memory tray resolved: 1 approved (headline a)."],
          ["thread:b", "Memory tray resolved: 1 rejected (headline b: status)."],
        ],
      );
      assert.equal(
        new Set(sent.map(({ commandId }) => String(commandId).split(":").at(-1))).size,
        1,
      );
    }),
  ),
);

it.effect("sends nothing when nothing was recorded or the batch was already flushed", () =>
  withService([shellOf("a")], (service, dispatched) =>
    Effect.gen(function* () {
      yield* service.flush();
      assert.equal((yield* drain(dispatched)).length, 0);

      yield* service.record(entry("a", "approved"));
      yield* service.flush();
      yield* service.flush();
      assert.equal((yield* drain(dispatched)).length, 1);
    }),
  ),
);

it.effect("gives a later batch a new command id", () =>
  withService([shellOf("a")], (service, dispatched) =>
    Effect.gen(function* () {
      yield* service.record(entry("a", "approved"));
      yield* service.flush();
      yield* service.record(entry("a", "approved"));
      yield* service.flush();

      const sent = yield* drain(dispatched);
      assert.equal(sent.length, 2);
      assert.notEqual(sent[0]?.commandId, sent[1]?.commandId);
    }),
  ),
);

it.effect("skips threads that are missing, archived or settled", () =>
  withService(
    [
      shellOf("open"),
      shellOf("archived", { archivedAt: {} as never }),
      shellOf("settled", { settledAt: {} as never }),
      shellOf("override", { settledOverride: "settled" }),
    ],
    (service, dispatched) =>
      Effect.gen(function* () {
        yield* service.record(entry("open", "approved"));
        yield* service.record(entry("archived", "approved"));
        yield* service.record(entry("settled", "approved"));
        yield* service.record(entry("override", "approved"));
        yield* service.record(entry("gone", "approved"));
        yield* service.flush();

        assert.deepEqual(
          (yield* drain(dispatched)).map(({ threadId }) => threadId),
          ["thread:open"],
        );
      }),
  ),
);

it.effect("sends nothing for a batch holding only tiles resolved elsewhere", () =>
  withService([shellOf("a")], (service, dispatched) =>
    Effect.gen(function* () {
      yield* service.record(entry("a", "resolved elsewhere"));
      yield* service.flush();
      assert.equal((yield* drain(dispatched)).length, 0);

      yield* service.record(entry("a", "approved"));
      yield* service.flush();
      assert.equal((yield* drain(dispatched)).length, 1);
    }),
  ),
);

it.effect("notes tiles resolved elsewhere next to the owner's own actions", () =>
  withService([shellOf("a")], (service, dispatched) =>
    Effect.gen(function* () {
      yield* service.record(entry("a", "resolved elsewhere"));
      yield* service.record(entry("a", "approved"));
      yield* service.flush();

      assert.equal(
        (yield* drain(dispatched))[0]?.text,
        "Memory tray resolved: 1 approved (headline a), 1 resolved elsewhere (headline a).",
      );
    }),
  ),
);

it.effect("keeps dispatching to other threads when one dispatch fails", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make<ReadonlyArray<string>>([]);
    const layer = MemoryNoticeService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getThreadShell: (threadId) => Effect.succeed(shellOf(threadId.replace("thread:", ""))),
          }),
          Layer.mock(Orchestrator.OrchestratorV2)({
            dispatch: (command) =>
              Ref.update(attempts, (current) => [...current, threadOf(command)]).pipe(
                Effect.andThen(
                  threadOf(command) === "thread:a"
                    ? Effect.die("boom")
                    : Effect.succeed({} as never),
                ),
              ),
          }),
        ),
      ),
    );

    yield* Effect.gen(function* () {
      const service = yield* MemoryNoticeService.MemoryNoticeService;
      yield* service.record(entry("a", "approved"));
      yield* service.record(entry("b", "approved"));
      yield* service.flush();
    }).pipe(Effect.provide(layer));

    assert.deepEqual(yield* Ref.get(attempts), ["thread:a", "thread:b"]);
  }),
);

it.effect("skips an entry with a blank thread id and still notifies the other threads", () =>
  withService([shellOf("a"), shellOf("b")], (service, dispatched) =>
    Effect.gen(function* () {
      yield* service.record(entry("a", "approved"));
      yield* service.record({ ...entry("a", "rejected"), threadId: "" });
      yield* service.record({ ...entry("a", "rejected"), threadId: "   " });
      yield* service.record(entry("b", "rejected", { reason: "status" }));
      yield* service.flush();

      const sent = yield* drain(dispatched);
      assert.deepEqual(
        sent.map(({ threadId, text }) => [threadId, text]),
        [
          ["thread:a", "Memory tray resolved: 1 approved (headline a)."],
          ["thread:b", "Memory tray resolved: 1 rejected (headline b: status)."],
        ],
      );

      yield* service.flush();
      assert.equal((yield* drain(dispatched)).length, 0);
    }),
  ),
);

it.effect("truncates the headline lists past 2000 characters and keeps the counts", () =>
  Effect.sync(() => {
    const entries = Array.from({ length: 40 }, (_, index) =>
      entry("a", index < 30 ? "approved" : "rejected", {
        headline: `${"long headline ".repeat(8)}${index}`,
        reason: "r".repeat(40),
      }),
    );

    const text = MemoryNoticeService.composeNotice(entries);

    assert.isAtMost(text.length, 2000);
    assert.include(text, "30 approved");
    assert.include(text, "10 rejected");
    assert.isTrue(text.startsWith("Memory tray resolved: "));
    assert.isTrue(text.endsWith("."));
  }),
);
