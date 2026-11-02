import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for harvest checkpoints"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "harvest-checkpoint" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

it.effect("setHarvestCheckpoint is read back from the shell and keeps the thread's updatedAt", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make("thread:harvest-checkpoint");
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create-harvest-checkpoint"),
      threadId,
      projectId: ProjectId.make("project:harvest-checkpoint"),
      title: "Harvest",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    const findShell = Effect.map(orchestrator.getShellSnapshot(), (snapshot) =>
      snapshot.threads.find((thread) => thread.id === threadId),
    );
    const before = yield* findShell;
    assert.isNull(before?.harvest ?? null);

    const harvest = {
      at: yield* DateTime.now,
      position: 7,
      itemId: "item:harvest-last",
      runId: RunId.make("run:harvest"),
      pendingRunId: null,
    };
    yield* orchestrator.setHarvestCheckpoint({
      commandId: CommandId.make("harvest-checkpoint:1"),
      threadId,
      harvest,
    });

    const after = yield* findShell;
    assert.deepEqual(after?.harvest, harvest);
    assert.equal(
      DateTime.toEpochMillis(after!.updatedAt),
      DateTime.toEpochMillis(before!.updatedAt),
    );

    yield* orchestrator.setHarvestCheckpoint({
      commandId: CommandId.make("harvest-checkpoint:2"),
      threadId,
      harvest: { ...harvest, pendingRunId: "run:pending" },
    });
    assert.equal((yield* findShell)?.harvest?.pendingRunId, "run:pending");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("setHarvestPendingRun merges into the current harvest, or writes the sentinel", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make("thread:harvest-pending");
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create-harvest-pending"),
      threadId,
      projectId: ProjectId.make("project:harvest-pending"),
      title: "Harvest",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    const findShell = Effect.map(orchestrator.getShellSnapshot(), (snapshot) =>
      snapshot.threads.find((thread) => thread.id === threadId),
    );
    const before = yield* findShell;
    assert.isNull(before?.harvest ?? null);

    yield* orchestrator.setHarvestPendingRun({
      commandId: CommandId.make("harvest-pending:1"),
      threadId,
      harvestPendingRunId: "run:pending-first",
    });
    const sentinel = (yield* findShell)?.harvest;
    assert.deepInclude(sentinel, {
      position: -1,
      itemId: null,
      runId: null,
      pendingRunId: "run:pending-first",
    });
    assert.equal(
      DateTime.toEpochMillis((yield* findShell)!.updatedAt),
      DateTime.toEpochMillis(before!.updatedAt),
    );

    const harvest = {
      at: yield* DateTime.now,
      position: 7,
      itemId: "item:harvest-last",
      runId: RunId.make("run:harvest"),
      pendingRunId: null,
    };
    yield* orchestrator.setHarvestCheckpoint({
      commandId: CommandId.make("harvest-pending:2"),
      threadId,
      harvest,
    });
    yield* orchestrator.setHarvestPendingRun({
      commandId: CommandId.make("harvest-pending:3"),
      threadId,
      harvestPendingRunId: "run:pending-second",
    });

    assert.deepEqual((yield* findShell)?.harvest, {
      ...harvest,
      pendingRunId: "run:pending-second",
    });
  }).pipe(Effect.provide(layerTest)),
);
