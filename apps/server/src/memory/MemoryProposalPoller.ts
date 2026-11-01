import {
  type MemoryApproveInput,
  MemoryProposalError,
  type MemoryProposalsSnapshot,
  type MemoryProposalTile,
  type MemoryRejectInput,
  type MemoryReinforceInput,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { FetchHttpClient } from "effect/http";

import * as Scheduler from "../scheduling/Scheduler.ts";
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

export function toTile(proposal: MemoryProposal): MemoryProposalTile {
  const { provenance, fields } = proposal;

  return {
    id: proposal.id,
    kind: proposal.kind,
    origin: proposal.origin,
    headline: proposal.headline,
    claim: fields.claim,
    why: fields.why,
    rejected: fields.rejected,
    scope: proposal.scope,
    topic: proposal.topic,
    purpose: proposal.purpose,
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
          ...(input.edits.scope === undefined ? {} : { scope: input.edits.scope }),
          ...(input.edits.purpose === undefined ? {} : { purpose: input.edits.purpose }),
          ...(input.edits.topic === undefined ? {} : { topic: input.edits.topic }),
        },
      }),
  ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
  ...(input.reason === undefined ? {} : { reason: input.reason }),
});

const proposalError = (error: MemoryClientError) =>
  new MemoryProposalError({ detail: error.message });

export const make = Effect.gen(function* () {
  const client = yield* MemoryClient;
  const scheduler = yield* Scheduler.Scheduler;
  const state = yield* SubscriptionRef.make(EMPTY_SNAPSHOT);
  const lastPollAt = yield* Ref.make<number | null>(null);

  const publish = Effect.fn("MemoryProposalPoller.publish")(function* (
    next: MemoryProposalsSnapshot,
  ) {
    const current = yield* SubscriptionRef.get(state);
    if (Equal.equals(current, next)) return;

    yield* SubscriptionRef.set(state, next);
  });

  const poll = Effect.fn("MemoryProposalPoller.poll")(function* () {
    const outcome = yield* client.pending().pipe(Effect.result);
    const current = yield* SubscriptionRef.get(state);

    if (outcome._tag === "Success") {
      yield* publish({
        configured: true,
        error: null,
        proposals: outcome.success.map(toTile),
      });
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

  const dropTile = (proposalId: string) =>
    SubscriptionRef.update(state, (current) => ({
      ...current,
      proposals: current.proposals.filter((tile) => tile.id !== proposalId),
    }));

  return MemoryProposalPoller.of({
    stream: SubscriptionRef.changes(state),
    approve: Effect.fn("MemoryProposalPoller.approve")(function* (input) {
      yield* client
        .approve(input.proposalId, approveBody(input))
        .pipe(Effect.mapError(proposalError));
      yield* dropTile(input.proposalId);
    }),
    reject: Effect.fn("MemoryProposalPoller.reject")(function* (input) {
      yield* client.reject(input.proposalId, input.reason).pipe(Effect.mapError(proposalError));
      yield* dropTile(input.proposalId);
    }),
    reinforce: Effect.fn("MemoryProposalPoller.reinforce")(function* (input) {
      yield* client
        .reinforce(input.proposalId, input.recordId)
        .pipe(Effect.mapError(proposalError));
      yield* dropTile(input.proposalId);
    }),
  });
});

export const layer = Layer.effect(MemoryProposalPoller, make).pipe(
  Layer.provide(Scheduler.layer),
  Layer.provide(memoryClientLayer),
  Layer.provide(FetchHttpClient.layer),
);
