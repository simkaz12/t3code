import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  MemoryClient,
  MemoryClientError,
  type MemoryClientShape,
  type MemoryProposal,
} from "../mcp/toolkits/memory/client.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as MemoryProposalPoller from "./MemoryProposalPoller.ts";

const proposal = (id: string, overrides: Partial<MemoryProposal> = {}): MemoryProposal => ({
  id,
  status: "pending",
  kind: "fact",
  headline: `headline ${id}`,
  fields: { claim: "claim", why: "why", rejected: null },
  scope: "oktra",
  provenance: {
    threadId: "thread-1",
    threadTitle: "Fix tinker",
    projectId: "project-1",
    branch: "",
    machine: "laptop",
    link: "t3-thread://v2/env/thread-1",
    excerpt: "user: hi",
  },
  origin: "agent",
  target: null,
  purpose: null,
  topic: null,
  checks: { status: "ok" },
  flags: [],
  neighbours: [],
  suggestion: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  resolvedAt: null,
  ...overrides,
});

const fakeClient = (overrides: Partial<MemoryClientShape>): MemoryClientShape => ({
  propose: () => Effect.die("not used"),
  recall: () => Effect.die("not used"),
  get: () => Effect.die("not used"),
  pending: () => Effect.succeed([]),
  approve: () => Effect.succeed({}),
  reject: () => Effect.void,
  reinforce: () => Effect.void,
  ...overrides,
});

const withPoller = <A, E>(
  client: MemoryClientShape,
  body: (
    poller: MemoryProposalPoller.MemoryProposalPoller["Service"],
  ) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.gen(function* () {
    const poller = yield* MemoryProposalPoller.make;

    return yield* body(poller);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(Layer.succeed(MemoryClient, MemoryClient.of(client)), Scheduler.layer),
    ),
  );

const collectIds = (poller: MemoryProposalPoller.MemoryProposalPoller["Service"]) =>
  Effect.gen(function* () {
    const snapshots = yield* Queue.unbounded<ReadonlyArray<string>>();
    yield* poller.stream.pipe(
      Stream.runForEach((snapshot) =>
        Queue.offer(
          snapshots,
          snapshot.proposals.map((tile) => tile.id),
        ),
      ),
      Effect.forkScoped,
    );

    return snapshots;
  });

it.effect("flattens a proposal into a tile with its labels, flags and lowest confidence", () =>
  Effect.sync(() => {
    const tile = MemoryProposalPoller.toTile(
      proposal("p1", {
        purpose: "pitfall",
        topic: "oktra-be test harness",
        flags: ["kind_differs", "restatement:r1"],
        checks: {
          status: "ok",
          answers: {
            topic: { choice: "oktra-be test harness", confidence: 0.9, probabilities: {} },
            purpose: { choice: "pitfall", confidence: 0.4, probabilities: {} },
            headline_faithful: { noul: 0.8 },
          },
        },
        neighbours: [
          {
            id: "r1",
            source: "v2",
            headline: "Existing",
            similarity: 0.91,
            relation: {
              pick: "restatement",
              confidence: 0.7,
              probabilities: { restatement: 0.7 },
              reasonClass: null,
            },
          },
        ],
        suggestion: { action: "reinforce", recordId: "r1", source: "v2", reasonClass: null },
        target: { recordId: "r9", source: "legacy", action: "promote", reason: "returned 3 times" },
      }),
    );

    assert.deepInclude(tile, {
      id: "p1",
      topic: "oktra-be test harness",
      purpose: "pitfall",
      confidence: 0.4,
      flags: ["kind differs from declared", "restates an existing record"],
      why: "why",
      rejected: null,
      branch: null,
      excerpt: "user: hi",
    });
    assert.deepEqual(tile.neighbours, [
      { id: "r1", source: "v2", headline: "Existing", similarity: 0.91, relation: "restatement" },
    ]);
    assert.deepEqual(tile.suggestion, {
      action: "reinforce",
      recordId: "r1",
      source: "v2",
      reasonClass: null,
    });
    assert.deepEqual(tile.target, {
      recordId: "r9",
      source: "legacy",
      action: "promote",
      recordHeadline: null,
      replacementHeadline: null,
      reason: "returned 3 times",
    });
  }),
);

it.effect("carries both target headlines through to the tile", () =>
  Effect.sync(() => {
    const tile = MemoryProposalPoller.toTile(
      proposal("p2", {
        origin: "cleaner",
        target: {
          recordId: "r1",
          source: "v2",
          action: "merge",
          replacementId: "r2",
          recordHeadline: "Older note",
          replacementHeadline: "Keeper note",
        },
      }),
    );

    assert.deepEqual(tile.target, {
      recordId: "r1",
      source: "v2",
      action: "merge",
      replacementId: "r2",
      recordHeadline: "Older note",
      replacementHeadline: "Keeper note",
    });
  }),
);

it.effect("polls at start and every 15 seconds, publishing only when the pending set changes", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    const polled = yield* Queue.unbounded<number>();
    const client = fakeClient({
      pending: () =>
        Ref.updateAndGet(calls, (count) => count + 1).pipe(
          Effect.tap((count) => Queue.offer(polled, count)),
          Effect.map((count) => (count < 3 ? [proposal("p1")] : [proposal("p1"), proposal("p2")])),
        ),
    });

    yield* withPoller(client, (poller) =>
      Effect.gen(function* () {
        const snapshots = yield* collectIds(poller);
        assert.deepEqual(yield* Queue.take(snapshots), []);
        assert.equal(yield* Queue.take(polled), 1);
        assert.deepEqual(yield* Queue.take(snapshots), ["p1"]);

        yield* TestClock.adjust("10 seconds");
        yield* TestClock.adjust("5 seconds");
        assert.equal(yield* Queue.take(polled), 2);
        assert.equal(yield* Ref.get(calls), 2);

        yield* TestClock.adjust("15 seconds");
        assert.equal(yield* Queue.take(polled), 3);
        assert.deepEqual(yield* Queue.take(snapshots), ["p1", "p2"]);
        assert.equal(yield* Queue.size(snapshots), 0);
      }),
    );
  }),
);

it.effect("reports an unconfigured server as empty and an unreachable one as an error", () =>
  Effect.gen(function* () {
    const failure = yield* Ref.make<MemoryClientError>(
      new MemoryClientError({ reason: "not-configured" }),
    );
    const client = fakeClient({
      pending: () => Ref.get(failure).pipe(Effect.flatMap((error) => Effect.fail(error))),
    });

    yield* withPoller(client, (poller) =>
      Effect.gen(function* () {
        const seen = yield* Queue.unbounded<{ configured: boolean; error: string | null }>();
        yield* poller.stream.pipe(
          Stream.runForEach(({ configured, error }) => Queue.offer(seen, { configured, error })),
          Effect.forkScoped,
        );

        assert.deepEqual(yield* Queue.take(seen), { configured: false, error: null });

        yield* Ref.set(failure, new MemoryClientError({ reason: "unreachable", detail: "down" }));
        yield* TestClock.adjust("15 seconds");
        const unreachable = yield* Queue.take(seen);
        assert.isTrue(unreachable.configured);
        assert.include(unreachable.error, "down");
      }),
    );
  }),
);

it.effect("sends an approval with its edits and drops the tile", () =>
  Effect.gen(function* () {
    const approvals = yield* Queue.unbounded<{ id: string; body: unknown }>();
    const client = fakeClient({
      pending: () => Effect.succeed([proposal("p1"), proposal("p2")]),
      approve: (id, body) => Queue.offer(approvals, { id, body }).pipe(Effect.as({})),
    });

    yield* withPoller(client, (poller) =>
      Effect.gen(function* () {
        const snapshots = yield* collectIds(poller);
        assert.deepEqual(yield* Queue.take(snapshots), []);
        assert.deepEqual(yield* Queue.take(snapshots), ["p1", "p2"]);

        yield* poller.approve({
          proposalId: "p1",
          edits: { headline: "Edited", scope: "oktra-be" },
          supersedes: ["r1"],
          reason: "changed",
        });

        assert.deepEqual(yield* Queue.take(approvals), {
          id: "p1",
          body: {
            edits: { headline: "Edited", scope: "oktra-be" },
            supersedes: ["r1"],
            reason: "changed",
          },
        });
        assert.deepEqual(yield* Queue.take(snapshots), ["p2"]);
      }),
    );
  }),
);

it.effect("turns a refused action into a proposal error and keeps the tile", () =>
  withPoller(
    fakeClient({
      pending: () => Effect.succeed([proposal("p1")]),
      reject: () => Effect.fail(new MemoryClientError({ reason: "rejected", status: 404 })),
    }),
    (poller) =>
      Effect.gen(function* () {
        const error = yield* poller.reject({ proposalId: "p1" }).pipe(Effect.flip);

        assert.equal(error._tag, "MemoryProposalError");
        assert.include(error.detail, "404");
      }),
  ),
);
