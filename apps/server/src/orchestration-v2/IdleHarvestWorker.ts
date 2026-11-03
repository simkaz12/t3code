import {
  CommandId,
  isListedThreadLineage,
  MessageId,
  resolveProjectProviderInstanceEnabled,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { resolveT3McpToolId } from "@t3tools/shared/t3McpToolPresentation";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { configuredBase } from "../mcp/toolkits/memory/client.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const IDLE_MS = 3_600_000;
const MIN_USER_MESSAGES = 3;
const SWEEP_MS = Duration.toMillis(Duration.minutes(5));
const TIMELINE_PAGE_LIMIT = 200;
const HARVEST_TEXT = "Harvest this thread";

type Verdict =
  | { readonly kind: "skip" }
  | { readonly kind: "wait"; readonly wakeAtMs: number }
  | { readonly kind: "ready" };

const SKIP: Verdict = { kind: "skip" };

const toMillis = (value: DateTime.Utc | null | undefined) =>
  value == null ? null : DateTime.toEpochMillis(value);

function latestActivityMs(thread: OrchestrationV2ThreadShell): number {
  const stamps = [
    toMillis(thread.latestUserMessageAt),
    toMillis(thread.latestRunRequestedAt),
    toMillis(thread.latestRunStartedAt),
    toMillis(thread.latestRunCompletedAt),
  ].filter((stamp) => stamp !== null);
  return stamps.length === 0 ? DateTime.toEpochMillis(thread.createdAt) : Math.max(...stamps);
}

function realCheckpointAtMs(thread: OrchestrationV2ThreadShell): number | null {
  const harvest = thread.harvest;
  return harvest != null && harvest.position >= 0 ? DateTime.toEpochMillis(harvest.at) : null;
}

function isHarvestable(thread: OrchestrationV2ThreadShell, nowMs: number): boolean {
  const snoozedUntilMs = toMillis(thread.snoozedUntil);
  return (
    thread.archivedAt === null &&
    thread.settledAt === null &&
    thread.settledOverride !== "settled" &&
    isListedThreadLineage(thread.lineage) &&
    (snoozedUntilMs === null || snoozedUntilMs <= nowMs) &&
    thread.status === "completed" &&
    thread.latestRunId !== null &&
    thread.latestRunCompletedAt != null &&
    thread.activeRunId === null &&
    (thread.activityRunStatus ?? null) === null &&
    thread.pendingRuntimeRequest === null &&
    (thread.pendingGuestMessageCount ?? 0) === 0 &&
    !backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? [])
  );
}

function hasNewUserContent(thread: OrchestrationV2ThreadShell): boolean {
  const authoredMs = toMillis(thread.latestUserAuthoredMessageAt);
  if (authoredMs === null) return false;
  const checkpointMs = realCheckpointAtMs(thread);
  return checkpointMs === null || authoredMs > checkpointMs;
}

function harvestVerdict(thread: OrchestrationV2ThreadShell, nowMs: number): Verdict {
  if (!isHarvestable(thread, nowMs)) return SKIP;
  if (!hasNewUserContent(thread)) return SKIP;
  if (thread.harvest?.pendingRunId != null && thread.harvest.pendingRunId === thread.latestRunId) {
    return SKIP;
  }

  const dueAtMs = latestActivityMs(thread) + IDLE_MS;
  return dueAtMs > nowMs ? { kind: "wait", wakeAtMs: dueAtMs } : { kind: "ready" };
}

const makeSweep = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const nextSweepAtMs = yield* Ref.make(0);
  const belowMinimum = new Map<ThreadId, number>();

  const stampPendingRun = Effect.fn("IdleHarvestWorker.stampPendingRun")(function* (
    threadId: ThreadId,
    latestRunId: string,
    pendingRunId: string,
  ) {
    yield* orchestrator.setHarvestPendingRun({
      commandId: CommandId.make(`server:harvest-pending:${threadId}:${latestRunId}`),
      threadId,
      harvestPendingRunId: pendingRunId,
    });
  });

  const scanDelta = Effect.fn("IdleHarvestWorker.scanDelta")(function* (
    thread: OrchestrationV2ThreadShell,
  ) {
    let cursor =
      thread.harvest != null && thread.harvest.position >= 0 ? thread.harvest.position : -1;
    let tail: { readonly position: number; readonly itemId: string } | null = null;
    let proposed = false;

    while (true) {
      const page = yield* projections.getTimelinePage(thread.id, {
        afterPosition: cursor,
        view: "activity",
        limit: TIMELINE_PAGE_LIMIT,
      });
      const last = page.items.at(-1);
      if (last === undefined) break;

      for (const projected of page.items) {
        const item = projected.item;
        if (
          item.type === "dynamic_tool" &&
          resolveT3McpToolId(item.toolName) === "memory_propose"
        ) {
          proposed = true;
        }
      }

      cursor = last.position;
      tail = { position: last.position, itemId: last.sourceItemId };
      if (!page.hasMore) break;
    }

    return proposed ? tail : null;
  });

  const checkpointProposedSpan = Effect.fn("IdleHarvestWorker.checkpointProposedSpan")(function* (
    thread: OrchestrationV2ThreadShell,
    latestRunId: string,
    tail: { readonly position: number; readonly itemId: string },
  ) {
    const now = yield* DateTime.now;

    yield* orchestrator.setHarvestCheckpoint({
      commandId: CommandId.make(`server:harvest-skip:${thread.id}:${latestRunId}`),
      threadId: thread.id,
      harvest: {
        at: now,
        position: tail.position,
        itemId: tail.itemId,
        runId: thread.latestRunId,
        pendingRunId: null,
      },
    });
    yield* Effect.logInfo("orchestration-v2.idle-harvest", {
      event: "idle-harvest",
      skipped: "proposed-inline",
    });
  });

  const harvestIfEnoughMessages = Effect.fn("IdleHarvestWorker.harvestIfEnoughMessages")(function* (
    threadId: ThreadId,
  ) {
    const thread = yield* projections.getThreadShell(threadId);
    if (thread === null) return;

    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    if (harvestVerdict(thread, nowMs).kind !== "ready") return;

    const latestRunId = thread.latestRunId;
    if (latestRunId === null) return;

    const authoredMs = toMillis(thread.latestUserAuthoredMessageAt);
    if (authoredMs !== null && belowMinimum.get(thread.id) === authoredMs) return;

    const records = yield* projections.getThreadRecords(
      thread.id,
      ["messages", "contextTransfers"],
      { messageRoles: ["user"] },
    );
    const mergeBackPending = records.contextTransfers.some(
      (transfer) =>
        transfer.type === "merge_back" &&
        transfer.targetThreadId === thread.id &&
        transfer.status === "pending",
    );
    if (mergeBackPending) return;

    const checkpointMs = realCheckpointAtMs(thread);
    const userMessages = records.messages.filter(
      (message) =>
        message.createdBy === "user" &&
        (checkpointMs === null || DateTime.toEpochMillis(message.updatedAt) > checkpointMs),
    );
    if (userMessages.length < MIN_USER_MESSAGES) {
      if (authoredMs !== null) belowMinimum.set(thread.id, authoredMs);
      return;
    }

    const proposedTail = yield* scanDelta(thread);
    if (proposedTail !== null) {
      yield* checkpointProposedSpan(thread, latestRunId, proposedTail);
      return;
    }

    const result = yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`server:harvest:${thread.id}:${latestRunId}`),
      messageId: MessageId.make(`harvest:${thread.id}:${latestRunId}`),
      threadId: thread.id,
      text: HARVEST_TEXT,
      attachments: [],
      createdBy: "agent",
      creationSource: "server",
      harvest: "idle",
      dispatchMode: { type: "start_immediately" },
    });
    if (result.replayed === true) return;

    const createdRun = result.storedEvents.find(
      (stored) => stored.event.type === "run.created" && stored.event.threadId === thread.id,
    );
    const pendingRunId =
      createdRun?.event.type === "run.created"
        ? createdRun.event.payload.id
        : `server:harvest:${thread.id}:${latestRunId}`;

    yield* stampPendingRun(thread.id, latestRunId, pendingRunId);
  });

  const sweepThreads = Effect.fn("IdleHarvestWorker.sweepThreads")(function* (nowMs: number) {
    const preferences = yield* settings.getSettings;
    let wakeAtMs = nowMs + SWEEP_MS;
    const memoryConfigured = yield* Effect.isSuccess(configuredBase(preferences.memoryServerUrl));
    if (!memoryConfigured) return wakeAtMs;

    const snapshot = yield* projections.getShellSnapshot({
      location: "active",
      unsettledOnly: true,
    });

    for (const thread of snapshot.threads) {
      const verdict = harvestVerdict(thread, nowMs);
      if (verdict.kind === "skip") continue;
      if (verdict.kind === "wait") {
        wakeAtMs = Math.min(wakeAtMs, verdict.wakeAtMs);
        continue;
      }

      const enabled = resolveProjectProviderInstanceEnabled(
        preferences,
        thread.projectId,
        thread.providerInstanceId,
      );
      if (!enabled) continue;

      yield* harvestIfEnoughMessages(thread.id).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration-v2.idle-harvest.dispatch-failed", {
            threadId: thread.id,
            cause,
          }),
        ),
      );
    }

    return wakeAtMs;
  });

  return Effect.fn("IdleHarvestWorker.sweep")(function* () {
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    if (nowMs < (yield* Ref.get(nextSweepAtMs))) return;

    yield* Ref.set(nextSweepAtMs, nowMs + SWEEP_MS);
    const wakeAtMs = yield* sweepThreads(nowMs);
    yield* Ref.set(nextSweepAtMs, wakeAtMs);
  });
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sweep = yield* makeSweep;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("idle-harvest", sweep());
  }),
);
