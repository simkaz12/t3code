import { CommandId, MessageId, ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

const MAX_TEXT_LENGTH = 2000;
const DETAIL_CAPS = [Number.POSITIVE_INFINITY, 400, 200, 100, 40, 0] as const;

export type MemoryNoticeOutcome =
  | "approved"
  | "rejected"
  | "reinforced"
  | "superseded"
  | "resolved elsewhere";

export interface MemoryNoticeEntry {
  readonly threadId: string;
  readonly headline: string;
  readonly outcome: MemoryNoticeOutcome;
  readonly reason?: string | undefined;
  readonly edited: boolean;
}

interface Batch {
  readonly id: string | null;
  readonly entries: ReadonlyArray<MemoryNoticeEntry>;
}

const EMPTY_BATCH: Batch = { id: null, entries: [] };

export class MemoryNoticeService extends Context.Service<
  MemoryNoticeService,
  {
    readonly record: (entry: MemoryNoticeEntry) => Effect.Effect<void>;
    readonly flush: () => Effect.Effect<void>;
  }
>()("t3/memory/MemoryNoticeService") {}

const truncate = (detail: string, cap: number) =>
  detail.length <= cap ? detail : cap === 0 ? "" : `${detail.slice(0, cap)}...`;

const part = (count: number, label: string, detail: string) =>
  detail === "" ? `${count} ${label}` : `${count} ${label} (${detail})`;

const approvedDetail = (entries: ReadonlyArray<MemoryNoticeEntry>) =>
  entries.map(({ headline, edited }) => (edited ? `${headline}, edited` : headline)).join("; ");

const rejectedDetail = (entries: ReadonlyArray<MemoryNoticeEntry>) =>
  entries.map(({ headline, reason }) => (reason ? `${headline}: ${reason}` : headline)).join("; ");

const headlineDetail = (entries: ReadonlyArray<MemoryNoticeEntry>) =>
  entries.map(({ headline }) => headline).join("; ");

export function composeNotice(entries: ReadonlyArray<MemoryNoticeEntry>): string {
  const of = (outcome: MemoryNoticeOutcome) => entries.filter((entry) => entry.outcome === outcome);
  const approved = of("approved");
  const rejected = of("rejected");
  const reinforced = of("reinforced");
  const superseded = of("superseded");
  const elsewhere = of("resolved elsewhere");

  const render = (cap: number) => {
    const parts = [
      ...(approved.length === 0
        ? []
        : [part(approved.length, "approved", truncate(approvedDetail(approved), cap))]),
      ...(rejected.length === 0
        ? []
        : [part(rejected.length, "rejected", truncate(rejectedDetail(rejected), cap))]),
      ...(reinforced.length === 0 ? [] : [`${reinforced.length} reinforced`]),
      ...(superseded.length === 0 ? [] : [`${superseded.length} superseded`]),
      ...(elsewhere.length === 0
        ? []
        : [part(elsewhere.length, "resolved elsewhere", truncate(headlineDetail(elsewhere), cap))]),
    ];

    return `Memory tray resolved: ${parts.join(", ")}.`;
  };

  for (const cap of DETAIL_CAPS) {
    const text = render(cap);
    if (text.length <= MAX_TEXT_LENGTH) return text;
  }

  return render(0);
}

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const batch = yield* Ref.make<Batch>(EMPTY_BATCH);
  const lastBatchId = yield* Ref.make(0);

  const nextBatchId = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return yield* Ref.modify(lastBatchId, (last) => {
      const id = Math.max(now, last + 1);
      return [String(id), id];
    });
  });

  const record = Effect.fn("MemoryNoticeService.record")(function* (entry: MemoryNoticeEntry) {
    const current = yield* Ref.get(batch);
    const id = current.id ?? (yield* nextBatchId);

    yield* Ref.update(batch, (latest) => ({
      id: latest.id ?? id,
      entries: [...latest.entries, entry],
    }));
  });

  const isOpen = Effect.fn("MemoryNoticeService.isOpen")(function* (threadId: ThreadId) {
    const shell = yield* projections.getThreadShell(threadId);

    if (shell === null) return false;

    return (
      shell.archivedAt === null && shell.settledAt === null && shell.settledOverride !== "settled"
    );
  });

  const notify = Effect.fn("MemoryNoticeService.notify")(function* (
    batchId: string,
    threadId: ThreadId,
    entries: ReadonlyArray<MemoryNoticeEntry>,
  ) {
    if (!(yield* isOpen(threadId))) return;

    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`server:memory-notice:${threadId}:${batchId}`),
      messageId: MessageId.make(`memory-notice:${threadId}:${batchId}`),
      threadId,
      text: composeNotice(entries),
      attachments: [],
      createdBy: "agent",
      creationSource: "server",
      memoryNotice: "tray-empty",
      dispatchMode: { type: "queue_after_active" },
    });
  });

  const notifyThread = Effect.fn("MemoryNoticeService.notifyThread")(function* (
    batchId: string,
    threadId: string,
    entries: ReadonlyArray<MemoryNoticeEntry>,
  ) {
    if (threadId.trim() === "") {
      yield* Effect.logWarning("memory.notice.blank-thread-id", { entries: entries.length });
      return;
    }

    yield* notify(batchId, ThreadId.make(threadId), entries);
  });

  const flush = Effect.fn("MemoryNoticeService.flush")(function* () {
    const taken = yield* Ref.getAndSet(batch, EMPTY_BATCH);
    if (taken.id === null) return;
    if (taken.entries.every((entry) => entry.outcome === "resolved elsewhere")) return;

    const byThread = Map.groupBy(taken.entries, (entry) => entry.threadId);
    const batchId = taken.id;

    yield* Effect.forEach(
      byThread,
      ([threadId, entries]) =>
        notifyThread(batchId, threadId, entries).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("memory.notice.dispatch-failed", { threadId, cause }),
          ),
        ),
      { discard: true },
    );
  });

  return MemoryNoticeService.of({ record, flush });
});

export const layer = Layer.effect(MemoryNoticeService, make);
