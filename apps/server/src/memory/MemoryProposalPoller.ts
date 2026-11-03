import {
  type MemoryApproveInput,
  MemoryProposalError,
  type MemoryProposalsSnapshot,
  type MemoryProposalTile,
  type MemoryRejectInput,
  type MemoryServerSettings,
  type MemoryUpdateSettingsInput,
  type MemoryReinforceInput,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { FetchHttpClient } from "effect/http";

import * as Scheduler from "../scheduling/Scheduler.ts";
import * as MemoryNoticeService from "./MemoryNoticeService.ts";
import {
  flagLabels,
  layer as memoryClientLayer,
  type MemoryApproveBody,
  MemoryClient,
  MemoryClientError,
  type MemoryProposal,
} from "../mcp/toolkits/memory/client.ts";

const POLL_INTERVAL_MS = 15_000;

const EMPTY_SNAPSHOT: MemoryProposalsSnapshot = {
  configured: false,
  error: null,
  proposals: [],
};

export class MemoryProposalPoller extends Context.Service<
  MemoryProposalPoller,
  {
    readonly stream: Stream.Stream<MemoryProposalsSnapshot>;
    readonly approve: (input: MemoryApproveInput) => Effect.Effect<void, MemoryProposalError>;
    readonly reject: (input: MemoryRejectInput) => Effect.Effect<void, MemoryProposalError>;
    readonly reinforce: (input: MemoryReinforceInput) => Effect.Effect<void, MemoryProposalError>;
    readonly getSettings: () => Effect.Effect<MemoryServerSettings, MemoryProposalError>;
    readonly updateSettings: (
      input: MemoryUpdateSettingsInput,
    ) => Effect.Effect<MemoryServerSettings, MemoryProposalError>;
  }
>()("t3/memory/MemoryProposalPoller") {}

export const unavailable: MemoryProposalPoller["Service"] = {
  stream: Stream.make(EMPTY_SNAPSHOT),
  approve: () =>
    Effect.fail(new MemoryProposalError({ detail: "Memory proposals are unavailable." })),
  reject: () =>
    Effect.fail(new MemoryProposalError({ detail: "Memory proposals are unavailable." })),
  reinforce: () =>
    Effect.fail(new MemoryProposalError({ detail: "Memory proposals are unavailable." })),
  getSettings: () =>
    Effect.fail(new MemoryProposalError({ detail: "Memory proposals are unavailable." })),
  updateSettings: () =>
    Effect.fail(new MemoryProposalError({ detail: "Memory proposals are unavailable." })),
};

const lowestConfidence = (proposal: MemoryProposal): number | null => {
  const fromAnswers = Object.values(proposal.checks.answers ?? {}).flatMap((answer) => {
    if (typeof answer !== "object" || answer === null) return [];
    const { confidence } = answer as { readonly confidence?: unknown };
    return typeof confidence === "number" ? [confidence] : [];
  });
  const fromRelations = proposal.neighbours.flatMap(({ relation }) =>
    relation === null ? [] : [relation.confidence],
  );
  const all = [...fromAnswers, ...fromRelations];

  return all.length === 0 ? null : Math.min(...all);
};

const tileTarget = (target: MemoryProposal["target"]): MemoryProposalTile["target"] =>
  target === null
    ? null
    : {
        ...target,
        recordHeadline: target.recordHeadline ?? null,
        replacementHeadline: target.replacementHeadline ?? null,
      };

const AUDIENCES: ReadonlyArray<string> = ["decider", "builder", "reviewer", "navigator"];

const tileAudience = (audience: string | null | undefined): MemoryProposalTile["audience"] =>
  audience !== null && audience !== undefined && AUDIENCES.includes(audience)
    ? (audience as MemoryProposalTile["audience"])
    : null;

export function toTile(proposal: MemoryProposal): MemoryProposalTile {
  const { provenance, fields } = proposal;

  return {
    id: proposal.id,
    kind: proposal.kind,
    origin: proposal.origin,
    headline: proposal.headline,
    claim: fields.claim,
    why: fields.why === "" ? null : fields.why,
    rejected: fields.rejected,
    scope: proposal.scope,
    topic: proposal.topic,
    purpose: proposal.purpose,
    audience: tileAudience(proposal.audience),
    reader: proposal.reader ?? null,
    section: proposal.section ?? "real",
    stage: provenance.stage ?? "",
    where: fields.where ?? null,
    trigger: fields.trigger ?? null,
    leftBecause: fields.leftBecause ?? null,
    fixHint: fields.fixHint ?? null,
    impact: fields.impact ?? null,
    defectStatus: proposal.defectStatus ?? null,
    takenBy: proposal.takenBy ?? null,
    threadId: provenance.threadId,
    threadTitle: provenance.threadTitle,
    projectId: provenance.projectId,
    branch: provenance.branch === "" ? null : provenance.branch,
    machine: provenance.machine,
    link: provenance.link,
    excerpt: provenance.excerpt,
    flags: flagLabels(proposal.flags),
    confidence: lowestConfidence(proposal),
    neighbours: proposal.neighbours.map(({ id, source, headline, similarity, relation }) => ({
      id,
      source,
      headline,
      similarity,
      relation: relation?.pick ?? null,
    })),
    suggestion: proposal.suggestion,
    target: tileTarget(proposal.target),
    checks: proposal.checks,
    createdAt: proposal.createdAt,
  };
}

const approveBody = (input: MemoryApproveInput): MemoryApproveBody => ({
  ...(input.edits === undefined
    ? {}
    : {
        edits: {
          ...(input.edits.headline === undefined ? {} : { headline: input.edits.headline }),
          ...(input.edits.fields === undefined ? {} : { fields: input.edits.fields }),
          ...(input.edits.audience === undefined ? {} : { audience: input.edits.audience }),
          ...(input.edits.scope === undefined ? {} : { scope: input.edits.scope }),
          ...(input.edits.purpose === undefined ? {} : { purpose: input.edits.purpose }),
          ...(input.edits.topic === undefined ? {} : { topic: input.edits.topic }),
        },
      }),
  ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
  ...(input.reason === undefined ? {} : { reason: input.reason }),
});

const approveOutcome = (input: MemoryApproveInput): MemoryNoticeService.MemoryNoticeOutcome =>
  input.supersedes !== undefined && input.supersedes.length > 0 ? "superseded" : "approved";

const noticeEntry = (
  tile: MemoryProposalTile,
  outcome: MemoryNoticeService.MemoryNoticeOutcome,
  details: { readonly reason?: string | undefined; readonly edited?: boolean } = {},
): MemoryNoticeService.MemoryNoticeEntry => ({
  threadId: tile.threadId,
  headline: tile.headline,
  outcome,
  ...(details.reason === undefined ? {} : { reason: details.reason }),
  edited: details.edited ?? false,
});

const proposalError = (error: MemoryClientError) =>
  new MemoryProposalError({ detail: error.message });

export const make = Effect.gen(function* () {
  const client = yield* MemoryClient;
  const notice = yield* MemoryNoticeService.MemoryNoticeService;
  const scheduler = yield* Scheduler.Scheduler;
  const state = yield* SubscriptionRef.make(EMPTY_SNAPSHOT);
  const lastPollAt = yield* Ref.make<number | null>(null);
  const inFlight = yield* Ref.make<ReadonlySet<string>>(new Set());
  const settledSincePoll = yield* Ref.make<ReadonlySet<string>>(new Set());

  const publish = Effect.fn("MemoryProposalPoller.publish")(function* (
    next: MemoryProposalsSnapshot,
  ) {
    return yield* SubscriptionRef.modifySomeEffect(state, (current) =>
      Ref.get(settledSincePoll).pipe(
        Effect.map((settled) => {
          const published: MemoryProposalsSnapshot = {
            ...next,
            proposals: next.proposals.filter((tile) => !settled.has(tile.id)),
          };

          return [
            published,
            Equal.equals(current, published) ? Option.none() : Option.some(published),
          ] as const;
        }),
      ),
    );
  });

  const recordVanished = Effect.fn("MemoryProposalPoller.recordVanished")(function* (
    before: ReadonlyArray<MemoryProposalTile>,
    after: ReadonlyArray<MemoryProposalTile>,
  ) {
    const remaining = new Set(after.map((tile) => tile.id));
    const acting = yield* Ref.get(inFlight);
    const settled = yield* Ref.get(settledSincePoll);
    const vanished = before.filter(
      (tile) => !remaining.has(tile.id) && !acting.has(tile.id) && !settled.has(tile.id),
    );

    yield* Effect.forEach(
      vanished,
      (tile) => notice.record(noticeEntry(tile, "resolved elsewhere")),
      {
        discard: true,
      },
    );
  });

  const poll = Effect.fn("MemoryProposalPoller.poll")(function* () {
    yield* Ref.set(settledSincePoll, new Set());
    const outcome = yield* client.pending().pipe(Effect.result);
    const current = yield* SubscriptionRef.get(state);

    if (outcome._tag === "Success") {
      const proposals = outcome.success.map(toTile);
      yield* recordVanished(current.proposals, proposals);

      const published = yield* publish({ configured: true, error: null, proposals });
      const acting = yield* Ref.get(inFlight);
      if (published.proposals.length === 0 && acting.size === 0) yield* notice.flush();
      return;
    }
    if (outcome.failure.reason === "not-configured") {
      yield* publish(EMPTY_SNAPSHOT);
      return;
    }
    yield* publish({ ...current, configured: true, error: outcome.failure.message });
  });

  const pollWhenDue = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const last = yield* Ref.get(lastPollAt);
    if (last !== null && now - last < POLL_INTERVAL_MS) return;

    yield* Ref.set(lastPollAt, now);
    yield* poll();
  });

  yield* scheduler.register("memory-proposals", pollWhenDue);

  const enterFlight = (proposalId: string) =>
    Ref.modify(inFlight, (acting) =>
      acting.has(proposalId)
        ? ([false, acting] as const)
        : ([true, new Set(acting).add(proposalId)] as const),
    ).pipe(
      Effect.flatMap((entered) =>
        entered
          ? Effect.void
          : Effect.fail(
              new MemoryProposalError({
                detail: "That proposal already has an action in progress.",
              }),
            ),
      ),
    );

  const leaveFlight = (proposalId: string) =>
    Ref.modify(inFlight, (acting) => {
      const remaining = new Set(acting);
      remaining.delete(proposalId);
      return [remaining.size === 0, remaining] as const;
    });

  const flushWhenLastSettles = Effect.fn("MemoryProposalPoller.flushWhenLastSettles")(function* (
    proposalId: string,
  ) {
    const last = yield* leaveFlight(proposalId);
    const current = yield* SubscriptionRef.get(state);

    if (last && current.configured && current.proposals.length === 0) yield* notice.flush();
  });

  const resolveTile = Effect.fn("MemoryProposalPoller.resolveTile")(function* (
    tile: MemoryProposalTile | undefined,
    proposalId: string,
    outcome: MemoryNoticeService.MemoryNoticeOutcome,
    details: { readonly reason?: string | undefined; readonly edited?: boolean } = {},
  ) {
    if (tile !== undefined) yield* notice.record(noticeEntry(tile, outcome, details));

    yield* Ref.update(settledSincePoll, (settled) => new Set(settled).add(proposalId));
    yield* SubscriptionRef.update(state, (current) => ({
      ...current,
      proposals: current.proposals.filter((candidate) => candidate.id !== proposalId),
    }));
  });

  const recordAbandoned = Effect.fn("MemoryProposalPoller.recordAbandoned")(function* (
    tile: MemoryProposalTile | undefined,
  ) {
    const current = yield* SubscriptionRef.get(state);
    if (
      tile === undefined ||
      !current.configured ||
      current.proposals.some((candidate) => candidate.id === tile.id)
    ) {
      return;
    }

    yield* notice.record(noticeEntry(tile, "resolved elsewhere"));
  });

  const settleOwnerAction = Effect.fn("MemoryProposalPoller.settleOwnerAction")(function* (
    proposalId: string,
    call: Effect.Effect<unknown, MemoryClientError>,
    outcome: MemoryNoticeService.MemoryNoticeOutcome,
    details: { readonly reason?: string | undefined; readonly edited?: boolean } = {},
  ) {
    yield* Effect.acquireUseRelease(
      enterFlight(proposalId),
      () =>
        Effect.gen(function* () {
          const before = yield* SubscriptionRef.get(state);
          const tile = before.proposals.find((candidate) => candidate.id === proposalId);

          yield* call.pipe(
            Effect.tapError(() => recordAbandoned(tile)),
            Effect.onInterrupt(() => recordAbandoned(tile)),
            Effect.mapError(proposalError),
          );
          yield* resolveTile(tile, proposalId, outcome, details);
        }),
      () => flushWhenLastSettles(proposalId),
    );
  });

  return MemoryProposalPoller.of({
    stream: SubscriptionRef.changes(state),
    approve: Effect.fn("MemoryProposalPoller.approve")(function* (input) {
      yield* settleOwnerAction(
        input.proposalId,
        client.approve(input.proposalId, approveBody(input)),
        approveOutcome(input),
        { edited: input.edits !== undefined },
      );
    }),
    reject: Effect.fn("MemoryProposalPoller.reject")(function* (input) {
      yield* settleOwnerAction(
        input.proposalId,
        client.reject(input.proposalId, input.reason),
        "rejected",
        { reason: input.reason },
      );
    }),
    reinforce: Effect.fn("MemoryProposalPoller.reinforce")(function* (input) {
      yield* settleOwnerAction(
        input.proposalId,
        client.reinforce(input.proposalId, input.recordId),
        "reinforced",
      );
    }),
    getSettings: Effect.fn("MemoryProposalPoller.getSettings")(function* () {
      return yield* client.getSettings().pipe(Effect.mapError(proposalError));
    }),
    updateSettings: Effect.fn("MemoryProposalPoller.updateSettings")(function* (input) {
      return yield* client.updateSettings(input).pipe(Effect.mapError(proposalError));
    }),
  });
});

export const layer = Layer.effect(MemoryProposalPoller, make).pipe(
  Layer.provide(MemoryNoticeService.layer),
  Layer.provide(Scheduler.layer),
  Layer.provide(memoryClientLayer),
  Layer.provide(FetchHttpClient.layer),
);
