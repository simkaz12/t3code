import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
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
import * as MemoryNoticeService from "./MemoryNoticeService.ts";
import * as MemoryProposalPoller from "./MemoryProposalPoller.ts";

const proposal = (id: string, overrides: Partial<MemoryProposal> = {}): MemoryProposal => ({
  id,
  status: "pending",
  kind: "fact",
  headline: `headline ${id}`,
  fields: { claim: "claim", why: "", rejected: null },
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
  take: () => Effect.die("not used"),
  release: () => Effect.die("not used"),
  getSettings: () => Effect.succeed({ cleanerConfidenceFloor: 0.7 }),
  updateSettings: (patch) => Effect.succeed(patch),
  ...overrides,
});

interface NoticeProbe {
  readonly entries: Ref.Ref<ReadonlyArray<MemoryNoticeService.MemoryNoticeEntry>>;
  readonly flushes: Ref.Ref<number>;
  readonly service: MemoryNoticeService.MemoryNoticeService["Service"];
}

const makeNoticeProbe = (
  beforeRecord: (entry: MemoryNoticeService.MemoryNoticeEntry) => Effect.Effect<void> = () =>
    Effect.void,
) =>
  Effect.gen(function* () {
    const entries = yield* Ref.make<ReadonlyArray<MemoryNoticeService.MemoryNoticeEntry>>([]);
    const flushes = yield* Ref.make(0);
    const service = MemoryNoticeService.MemoryNoticeService.of({
      record: (entry) =>
        beforeRecord(entry).pipe(
          Effect.andThen(Ref.update(entries, (current) => [...current, entry])),
        ),
      flush: () => Ref.update(flushes, (count) => count + 1),
    });

    return { entries, flushes, service } satisfies NoticeProbe;
  });

const withPoller = <A, E>(
  client: MemoryClientShape,
  body: (
    poller: MemoryProposalPoller.MemoryProposalPoller["Service"],
    probe: NoticeProbe,
  ) => Effect.Effect<A, E, Scope.Scope>,
  beforeRecord?: (entry: MemoryNoticeService.MemoryNoticeEntry) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const probe = yield* makeNoticeProbe(beforeRecord);
    const poller = yield* MemoryProposalPoller.make.pipe(
      Effect.provideService(MemoryNoticeService.MemoryNoticeService, probe.service),
    );

    return yield* body(poller, probe);
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
      why: null,
      rejected: null,
      branch: null,
      excerpt: "user: hi",
      audience: null,
      reader: null,
      stage: "",
      defectStatus: null,
      takenBy: null,
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
        const error = yield* poller.reject({ proposalId: "p1", reason: "stale" }).pipe(Effect.flip);

        assert.equal(error._tag, "MemoryProposalError");
        assert.include(error.detail, "404");
      }),
  ),
);

it.effect("delegates settings reads and writes to the client", () =>
  Effect.gen(function* () {
    const updates = yield* Queue.unbounded<unknown>();

    yield* withPoller(
      fakeClient({
        updateSettings: (patch) => Queue.offer(updates, patch).pipe(Effect.as(patch)),
      }),
      (poller) =>
        Effect.gen(function* () {
          assert.deepEqual(yield* poller.getSettings(), { cleanerConfidenceFloor: 0.7 });
          assert.deepEqual(yield* poller.updateSettings({ cleanerConfidenceFloor: 0.8 }), {
            cleanerConfidenceFloor: 0.8,
          });
          assert.deepEqual(yield* Queue.take(updates), { cleanerConfidenceFloor: 0.8 });
        }),
    );
  }),
);

it.effect("turns a refused settings write into a proposal error", () =>
  withPoller(
    fakeClient({
      updateSettings: () =>
        Effect.fail(new MemoryClientError({ reason: "rejected", status: 400, detail: "bad" })),
    }),
    (poller) =>
      Effect.gen(function* () {
        const error = yield* poller.updateSettings({ cleanerConfidenceFloor: 2 }).pipe(Effect.flip);

        assert.equal(error._tag, "MemoryProposalError");
        assert.include(error.detail, "400");
      }),
  ),
);

it.effect("maps audience, reader, stage and the defect fields onto the tile", () =>
  Effect.sync(() => {
    const tile = MemoryProposalPoller.toTile(
      proposal("d1", {
        kind: "defect",
        audience: "navigator",
        reader: "trap",
        defectStatus: "taken",
        takenBy: {
          threadId: "thread-2",
          link: "t3-thread://v2/env/thread-2",
          at: "2026-11-02T09:00:00.000Z",
        },
        provenance: {
          threadId: "thread-1",
          threadTitle: "Fix tinker",
          projectId: "project-1",
          branch: "",
          machine: "laptop",
          link: "t3-thread://v2/env/thread-1",
          excerpt: "user: hi",
          stage: "recon",
        },
        fields: {
          claim: "Submit does nothing",
          why: "",
          rejected: null,
          where: "src/form.ts",
          trigger: "empty field",
          leftBecause: "out of scope",
          fixHint: "validate first",
        },
      }),
    );

    assert.deepInclude(tile, {
      kind: "defect",
      audience: "navigator",
      reader: "trap",
      stage: "recon",
      where: "src/form.ts",
      trigger: "empty field",
      leftBecause: "out of scope",
      fixHint: "validate first",
      impact: null,
      defectStatus: "taken",
    });
    assert.deepEqual(tile.takenBy, {
      threadId: "thread-2",
      link: "t3-thread://v2/env/thread-2",
      at: "2026-11-02T09:00:00.000Z",
    });
  }),
);

it.effect("keeps a legacy why, drops an unknown audience and carries a close target", () =>
  Effect.sync(() => {
    const tile = MemoryProposalPoller.toTile(
      proposal("c1", {
        audience: "janitor",
        fields: { claim: "claim", why: "an old reason", rejected: null },
        target: { recordId: "d9", source: "v2", action: "close", reason: "open 90d" },
      }),
    );

    assert.equal(tile.why, "an old reason");
    assert.isNull(tile.audience);
    assert.equal(tile.target?.action, "close");
  }),
);

it.effect("records each owner outcome and flushes once when the last tile leaves", () =>
  Effect.gen(function* () {
    const client = fakeClient({
      pending: () =>
        Effect.succeed([proposal("p1"), proposal("p2"), proposal("p3"), proposal("p4")]),
    });

    yield* withPoller(client, (poller, probe) =>
      Effect.gen(function* () {
        const snapshots = yield* collectIds(poller);
        assert.deepEqual(yield* Queue.take(snapshots), []);
        assert.deepEqual(yield* Queue.take(snapshots), ["p1", "p2", "p3", "p4"]);

        yield* poller.approve({ proposalId: "p1" });
        yield* poller.approve({
          proposalId: "p2",
          edits: { headline: "Edited" },
        });
        yield* poller.approve({ proposalId: "p3", supersedes: ["r1"], reason: "changed" });
        assert.equal(yield* Ref.get(probe.flushes), 0);

        yield* poller.reject({ proposalId: "p4", reason: "derivable from the tree" });

        assert.deepEqual(yield* Ref.get(probe.entries), [
          { threadId: "thread-1", headline: "headline p1", outcome: "approved", edited: false },
          { threadId: "thread-1", headline: "headline p2", outcome: "approved", edited: true },
          { threadId: "thread-1", headline: "headline p3", outcome: "superseded", edited: false },
          {
            threadId: "thread-1",
            headline: "headline p4",
            outcome: "rejected",
            reason: "derivable from the tree",
            edited: false,
          },
        ]);
        assert.equal(yield* Ref.get(probe.flushes), 1);
      }),
    );
  }),
);

it.effect("records a reinforced tile and ignores an action on a tile it never showed", () =>
  withPoller(
    fakeClient({ pending: () => Effect.succeed([proposal("p1"), proposal("p2")]) }),
    (poller, probe) =>
      Effect.gen(function* () {
        const snapshots = yield* collectIds(poller);
        yield* Queue.take(snapshots);
        yield* Queue.take(snapshots);

        yield* poller.reinforce({ proposalId: "p1", recordId: "r1" });
        yield* poller.reject({ proposalId: "missing", reason: "gone" });

        assert.deepEqual(yield* Ref.get(probe.entries), [
          { threadId: "thread-1", headline: "headline p1", outcome: "reinforced", edited: false },
        ]);
        assert.equal(yield* Ref.get(probe.flushes), 0);
      }),
  ),
);

it.effect("records tiles that vanish between polls as resolved elsewhere and flushes at zero", () =>
  Effect.gen(function* () {
    const pending = yield* Ref.make([proposal("p1"), proposal("p2")]);

    yield* withPoller(fakeClient({ pending: () => Ref.get(pending) }), (poller, probe) =>
      Effect.gen(function* () {
        const snapshots = yield* collectIds(poller);
        yield* Queue.take(snapshots);
        assert.deepEqual(yield* Queue.take(snapshots), ["p1", "p2"]);

        yield* Ref.set(pending, [proposal("p2")]);
        yield* TestClock.adjust("15 seconds");
        assert.deepEqual(yield* Queue.take(snapshots), ["p2"]);
        assert.equal(yield* Ref.get(probe.flushes), 0);

        yield* Ref.set(pending, []);
        yield* TestClock.adjust("15 seconds");
        assert.deepEqual(yield* Queue.take(snapshots), []);

        assert.deepEqual(
          (yield* Ref.get(probe.entries)).map(({ headline, outcome }) => [headline, outcome]),
          [
            ["headline p1", "resolved elsewhere"],
            ["headline p2", "resolved elsewhere"],
          ],
        );
        assert.equal(yield* Ref.get(probe.flushes), 1);
      }),
    );
  }),
);

it.effect("keeps the owner outcome and flushes when a poll lands during the approve call", () =>
  Effect.gen(function* () {
    const pending = yield* Ref.make([proposal("p1")]);
    const started = yield* Deferred.make<void>();
    const gate = yield* Deferred.make<void>();
    const client = fakeClient({
      pending: () => Ref.get(pending),
      approve: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(gate)),
          Effect.as({}),
        ),
    });

    yield* withPoller(client, (poller, probe) =>
      Effect.gen(function* () {
        const snapshots = yield* collectIds(poller);
        yield* Queue.take(snapshots);
        assert.deepEqual(yield* Queue.take(snapshots), ["p1"]);

        const approving = yield* poller
          .approve({ proposalId: "p1", edits: { headline: "Edited" } })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(started);

        yield* Ref.set(pending, []);
        yield* TestClock.adjust("15 seconds");
        assert.deepEqual(yield* Queue.take(snapshots), []);
        assert.deepEqual(yield* Ref.get(probe.entries), []);
        assert.equal(yield* Ref.get(probe.flushes), 0);

        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(approving);

        assert.deepEqual(yield* Ref.get(probe.entries), [
          { threadId: "thread-1", headline: "headline p1", outcome: "approved", edited: true },
        ]);
        assert.equal(yield* Ref.get(probe.flushes), 1);
      }),
    );
  }),
);

it.effect("keeps the rejection reason when a poll lands during the reject call", () =>
  Effect.gen(function* () {
    const pending = yield* Ref.make([proposal("p1"), proposal("p2")]);
    const started = yield* Deferred.make<void>();
    const gate = yield* Deferred.make<void>();
    const client = fakeClient({
      pending: () => Ref.get(pending),
      reject: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate))),
    });

    yield* withPoller(client, (poller, probe) =>
      Effect.gen(function* () {
        const snapshots = yield* collectIds(poller);
        yield* Queue.take(snapshots);
        assert.deepEqual(yield* Queue.take(snapshots), ["p1", "p2"]);

        const rejecting = yield* poller
          .reject({ proposalId: "p1", reason: "derivable" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(started);

        yield* Ref.set(pending, [proposal("p2")]);
        yield* TestClock.adjust("15 seconds");
        assert.deepEqual(yield* Queue.take(snapshots), ["p2"]);
        assert.deepEqual(yield* Ref.get(probe.entries), []);

        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(rejecting);

        assert.deepEqual(yield* Ref.get(probe.entries), [
          {
            threadId: "thread-1",
            headline: "headline p1",
            outcome: "rejected",
            reason: "derivable",
            edited: false,
          },
        ]);
        assert.equal(yield* Ref.get(probe.flushes), 0);
      }),
    );
  }),
);

it.effect(
  "records a tile as resolved elsewhere when its action fails after a poll removed it",
  () =>
    Effect.gen(function* () {
      const pending = yield* Ref.make([proposal("p1")]);
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const client = fakeClient({
        pending: () => Ref.get(pending),
        reinforce: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(gate)),
            Effect.andThen(Effect.fail(new MemoryClientError({ reason: "rejected" }))),
          ),
      });

      yield* withPoller(client, (poller, probe) =>
        Effect.gen(function* () {
          const snapshots = yield* collectIds(poller);
          yield* Queue.take(snapshots);
          assert.deepEqual(yield* Queue.take(snapshots), ["p1"]);

          const reinforcing = yield* poller
            .reinforce({ proposalId: "p1", recordId: "r1" })
            .pipe(Effect.result, Effect.forkScoped);
          yield* Deferred.await(started);

          yield* Ref.set(pending, []);
          yield* TestClock.adjust("15 seconds");
          assert.deepEqual(yield* Queue.take(snapshots), []);
          assert.equal(yield* Ref.get(probe.flushes), 0);

          yield* Deferred.succeed(gate, undefined);
          assert.equal((yield* Fiber.join(reinforcing))._tag, "Failure");

          assert.deepEqual(
            (yield* Ref.get(probe.entries)).map(({ headline, outcome }) => [headline, outcome]),
            [["headline p1", "resolved elsewhere"]],
          );
          assert.equal(yield* Ref.get(probe.flushes), 1);
        }),
      );
    }),
);

it.effect("does not flush when an unconfigured server empties the tray", () =>
  Effect.gen(function* () {
    const failure = yield* Ref.make(false);

    yield* withPoller(
      fakeClient({
        pending: () =>
          Ref.get(failure).pipe(
            Effect.flatMap((failed) =>
              failed
                ? Effect.fail(new MemoryClientError({ reason: "not-configured" }))
                : Effect.succeed([proposal("p1")]),
            ),
          ),
      }),
      (poller, probe) =>
        Effect.gen(function* () {
          const snapshots = yield* collectIds(poller);
          yield* Queue.take(snapshots);
          assert.deepEqual(yield* Queue.take(snapshots), ["p1"]);

          yield* Ref.set(failure, true);
          yield* TestClock.adjust("15 seconds");
          assert.deepEqual(yield* Queue.take(snapshots), []);

          assert.deepEqual(yield* Ref.get(probe.entries), []);
          assert.equal(yield* Ref.get(probe.flushes), 0);
        }),
    );
  }),
);

it.effect(
  "flushes once, with both entries, when the last of two concurrent approvals settles",
  () =>
    Effect.gen(function* () {
      const pending = yield* Ref.make([proposal("p1"), proposal("p2")]);
      const started = yield* Queue.unbounded<string>();
      const gateOne = yield* Deferred.make<void>();
      const gateTwo = yield* Deferred.make<void>();
      const client = fakeClient({
        pending: () => Ref.get(pending),
        approve: (id) =>
          Queue.offer(started, id).pipe(
            Effect.andThen(Deferred.await(id === "p1" ? gateOne : gateTwo)),
            Effect.as({}),
          ),
      });

      yield* withPoller(client, (poller, probe) =>
        Effect.gen(function* () {
          const snapshots = yield* collectIds(poller);
          yield* Queue.take(snapshots);
          assert.deepEqual(yield* Queue.take(snapshots), ["p1", "p2"]);

          const approvingOne = yield* poller.approve({ proposalId: "p1" }).pipe(Effect.forkScoped);
          const approvingTwo = yield* poller.approve({ proposalId: "p2" }).pipe(Effect.forkScoped);
          yield* Queue.take(started);
          yield* Queue.take(started);

          yield* Ref.set(pending, []);
          yield* TestClock.adjust("15 seconds");
          assert.deepEqual(yield* Queue.take(snapshots), []);
          assert.equal(yield* Ref.get(probe.flushes), 0);

          yield* Deferred.succeed(gateOne, undefined);
          yield* Fiber.join(approvingOne);
          assert.equal(yield* Ref.get(probe.flushes), 0);

          yield* Deferred.succeed(gateTwo, undefined);
          yield* Fiber.join(approvingTwo);

          assert.deepEqual(
            (yield* Ref.get(probe.entries)).map(({ headline, outcome }) => [headline, outcome]),
            [
              ["headline p1", "approved"],
              ["headline p2", "approved"],
            ],
          );
          assert.equal(yield* Ref.get(probe.flushes), 1);
        }),
      );
    }),
);

it.effect(
  "flushes once when the last of two concurrent actions fails after a poll emptied the tray",
  () =>
    Effect.gen(function* () {
      const pending = yield* Ref.make([proposal("p1"), proposal("p2")]);
      const started = yield* Queue.unbounded<string>();
      const gateOne = yield* Deferred.make<void>();
      const gateTwo = yield* Deferred.make<void>();
      const client = fakeClient({
        pending: () => Ref.get(pending),
        approve: (id) =>
          Queue.offer(started, id).pipe(Effect.andThen(Deferred.await(gateOne)), Effect.as({})),
        reject: (id) =>
          Queue.offer(started, id).pipe(
            Effect.andThen(Deferred.await(gateTwo)),
            Effect.andThen(Effect.fail(new MemoryClientError({ reason: "rejected" }))),
          ),
      });

      yield* withPoller(client, (poller, probe) =>
        Effect.gen(function* () {
          const snapshots = yield* collectIds(poller);
          yield* Queue.take(snapshots);
          assert.deepEqual(yield* Queue.take(snapshots), ["p1", "p2"]);

          const approving = yield* poller.approve({ proposalId: "p1" }).pipe(Effect.forkScoped);
          const rejecting = yield* poller
            .reject({ proposalId: "p2", reason: "stale" })
            .pipe(Effect.result, Effect.forkScoped);
          yield* Queue.take(started);
          yield* Queue.take(started);

          yield* Ref.set(pending, []);
          yield* TestClock.adjust("15 seconds");
          assert.deepEqual(yield* Queue.take(snapshots), []);

          yield* Deferred.succeed(gateTwo, undefined);
          assert.equal((yield* Fiber.join(rejecting))._tag, "Failure");
          assert.equal(yield* Ref.get(probe.flushes), 0);

          yield* Deferred.succeed(gateOne, undefined);
          yield* Fiber.join(approving);

          assert.deepEqual(
            (yield* Ref.get(probe.entries)).map(({ headline, outcome }) => [headline, outcome]),
            [
              ["headline p2", "resolved elsewhere"],
              ["headline p1", "approved"],
            ],
          );
          assert.equal(yield* Ref.get(probe.flushes), 1);
        }),
      );
    }),
);

it.effect("drops a tile settled while a slower poll was outstanding and records it once", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    const polled = yield* Queue.unbounded<number>();
    const gate = yield* Deferred.make<void>();
    const client = fakeClient({
      pending: () =>
        Ref.updateAndGet(calls, (count) => count + 1).pipe(
          Effect.tap((count) => Queue.offer(polled, count)),
          Effect.flatMap((count) => {
            if (count === 1) return Effect.succeed([proposal("p1")]);
            if (count === 2) return Deferred.await(gate).pipe(Effect.as([proposal("p1")]));
            return Effect.succeed([]);
          }),
        ),
    });

    yield* withPoller(client, (poller, probe) =>
      Effect.gen(function* () {
        const snapshots = yield* collectIds(poller);
        yield* Queue.take(snapshots);
        assert.equal(yield* Queue.take(polled), 1);
        assert.deepEqual(yield* Queue.take(snapshots), ["p1"]);

        yield* TestClock.adjust("15 seconds");
        assert.equal(yield* Queue.take(polled), 2);

        yield* poller.approve({ proposalId: "p1" });
        assert.deepEqual(yield* Queue.take(snapshots), []);

        yield* Deferred.succeed(gate, undefined);
        yield* TestClock.adjust("15 seconds");
        assert.equal(yield* Queue.take(polled), 3);
        yield* TestClock.adjust("15 seconds");
        assert.equal(yield* Queue.take(polled), 4);

        assert.equal(yield* Queue.size(snapshots), 0);
        assert.deepEqual(yield* Ref.get(probe.entries), [
          { threadId: "thread-1", headline: "headline p1", outcome: "approved", edited: false },
        ]);
        assert.isAtLeast(yield* Ref.get(probe.flushes), 1);
      }),
    );
  }),
);

it.effect("rejects a second concurrent action on one tile and records it once", () =>
  Effect.gen(function* () {
    const pending = yield* Ref.make([proposal("p1"), proposal("p2")]);
    const started = yield* Queue.unbounded<string>();
    const calls = yield* Ref.make(0);
    const gateOne = yield* Deferred.make<void>();
    const gateTwo = yield* Deferred.make<void>();
    const client = fakeClient({
      pending: () => Ref.get(pending),
      approve: (id) =>
        Ref.updateAndGet(calls, (count) => count + 1).pipe(
          Effect.tap(() => Queue.offer(started, id)),
          Effect.flatMap((count) =>
            count === 1
              ? Deferred.await(gateOne).pipe(Effect.as({}))
              : Deferred.await(gateTwo).pipe(
                  Effect.andThen(Effect.fail(new MemoryClientError({ reason: "rejected" }))),
                ),
          ),
        ),
    });

    yield* withPoller(client, (poller, probe) =>
      Effect.gen(function* () {
        const snapshots = yield* collectIds(poller);
        yield* Queue.take(snapshots);
        assert.deepEqual(yield* Queue.take(snapshots), ["p1", "p2"]);

        const first = yield* poller.approve({ proposalId: "p1" }).pipe(Effect.forkScoped);
        yield* Queue.take(started);
        const second = yield* poller
          .approve({ proposalId: "p1" })
          .pipe(Effect.result, Effect.forkScoped({ startImmediately: true }));

        yield* Deferred.succeed(gateOne, undefined);
        yield* Fiber.join(first);
        yield* Deferred.succeed(gateTwo, undefined);
        assert.equal((yield* Fiber.join(second))._tag, "Failure");

        assert.equal(yield* Ref.get(calls), 1);
        assert.deepEqual(yield* Ref.get(probe.entries), [
          { threadId: "thread-1", headline: "headline p1", outcome: "approved", edited: false },
        ]);
        assert.equal(yield* Ref.get(probe.flushes), 0);
      }),
    );
  }),
);

it.effect("flushes the batch when the last action in flight is interrupted after a zero poll", () =>
  Effect.gen(function* () {
    const pending = yield* Ref.make([proposal("p1"), proposal("p2")]);
    const started = yield* Queue.unbounded<string>();
    const client = fakeClient({
      pending: () => Ref.get(pending),
      approve: (id) =>
        id === "p1"
          ? Effect.succeed({})
          : Queue.offer(started, id).pipe(Effect.andThen(Effect.never)),
    });

    yield* withPoller(client, (poller, probe) =>
      Effect.gen(function* () {
        const snapshots = yield* collectIds(poller);
        yield* Queue.take(snapshots);
        assert.deepEqual(yield* Queue.take(snapshots), ["p1", "p2"]);

        const stuck = yield* poller.approve({ proposalId: "p2" }).pipe(Effect.forkScoped);
        yield* Queue.take(started);
        yield* poller.approve({ proposalId: "p1" });
        assert.deepEqual(yield* Queue.take(snapshots), ["p2"]);

        yield* Ref.set(pending, []);
        yield* TestClock.adjust("15 seconds");
        assert.deepEqual(yield* Queue.take(snapshots), []);
        assert.equal(yield* Ref.get(probe.flushes), 0);

        yield* Fiber.interrupt(stuck);

        assert.deepEqual(yield* Ref.get(probe.entries), [
          { threadId: "thread-1", headline: "headline p1", outcome: "approved", edited: false },
          {
            threadId: "thread-1",
            headline: "headline p2",
            outcome: "resolved elsewhere",
            edited: false,
          },
        ]);
        assert.equal(yield* Ref.get(probe.flushes), 1);
      }),
    );
  }),
);

it.effect("flushes the stranded batch on the first empty poll after configuration recovers", () =>
  Effect.gen(function* () {
    const mode = yield* Ref.make<"listing" | "unconfigured" | "empty">("listing");
    const client = fakeClient({
      pending: () =>
        Ref.get(mode).pipe(
          Effect.flatMap((current) =>
            current === "unconfigured"
              ? Effect.fail(new MemoryClientError({ reason: "not-configured" }))
              : Effect.succeed(current === "listing" ? [proposal("p1"), proposal("p2")] : []),
          ),
        ),
    });

    yield* withPoller(client, (poller, probe) =>
      Effect.gen(function* () {
        const snapshots = yield* collectIds(poller);
        yield* Queue.take(snapshots);
        assert.deepEqual(yield* Queue.take(snapshots), ["p1", "p2"]);

        yield* poller.approve({ proposalId: "p1" });
        assert.deepEqual(yield* Queue.take(snapshots), ["p2"]);
        assert.equal(yield* Ref.get(probe.flushes), 0);

        yield* Ref.set(mode, "unconfigured");
        yield* TestClock.adjust("15 seconds");
        assert.deepEqual(yield* Queue.take(snapshots), []);
        assert.equal(yield* Ref.get(probe.flushes), 0);

        yield* Ref.set(mode, "empty");
        yield* TestClock.adjust("15 seconds");
        assert.deepEqual(yield* Queue.take(snapshots), []);

        assert.deepEqual(yield* Ref.get(probe.entries), [
          { threadId: "thread-1", headline: "headline p1", outcome: "approved", edited: false },
        ]);
        assert.equal(yield* Ref.get(probe.flushes), 1);
      }),
    );
  }),
);

const unconfiguredWhileInFlight = (ending: "fails" | "is interrupted") =>
  Effect.gen(function* () {
    const mode = yield* Ref.make<"listing" | "unconfigured" | "empty">("listing");
    const started = yield* Queue.unbounded<string>();
    const gate = yield* Deferred.make<void>();
    const client = fakeClient({
      pending: () =>
        Ref.get(mode).pipe(
          Effect.flatMap((current) =>
            current === "unconfigured"
              ? Effect.fail(new MemoryClientError({ reason: "not-configured" }))
              : Effect.succeed(current === "listing" ? [proposal("p1"), proposal("p2")] : []),
          ),
        ),
      approve: (id) =>
        id === "p1"
          ? Effect.succeed({})
          : Queue.offer(started, id).pipe(
              Effect.andThen(
                ending === "fails"
                  ? Deferred.await(gate).pipe(
                      Effect.andThen(
                        Effect.fail(new MemoryClientError({ reason: "not-configured" })),
                      ),
                    )
                  : Effect.never,
              ),
            ),
    });

    yield* withPoller(client, (poller, probe) =>
      Effect.gen(function* () {
        const snapshots = yield* collectIds(poller);
        yield* Queue.take(snapshots);
        assert.deepEqual(yield* Queue.take(snapshots), ["p1", "p2"]);

        const stuck = yield* poller.approve({ proposalId: "p2" }).pipe(Effect.forkScoped);
        yield* Queue.take(started);
        yield* poller.approve({ proposalId: "p1" });
        assert.deepEqual(yield* Queue.take(snapshots), ["p2"]);

        yield* Ref.set(mode, "unconfigured");
        yield* TestClock.adjust("15 seconds");
        assert.deepEqual(yield* Queue.take(snapshots), []);

        if (ending === "fails") {
          yield* Deferred.succeed(gate, undefined);
          assert.equal((yield* Fiber.await(stuck))._tag, "Failure");
        } else {
          yield* Fiber.interrupt(stuck);
        }

        assert.deepEqual(yield* Ref.get(probe.entries), [
          { threadId: "thread-1", headline: "headline p1", outcome: "approved", edited: false },
        ]);
        assert.equal(yield* Ref.get(probe.flushes), 0);

        yield* Ref.set(mode, "empty");
        yield* TestClock.adjust("15 seconds");
        assert.deepEqual(yield* Queue.take(snapshots), []);

        assert.deepEqual(yield* Ref.get(probe.entries), [
          { threadId: "thread-1", headline: "headline p1", outcome: "approved", edited: false },
        ]);
        assert.equal(yield* Ref.get(probe.flushes), 1);
      }),
    );
  });

it.effect(
  "keeps the batch open when the last action fails while an unconfigured server emptied the tray",
  () => unconfiguredWhileInFlight("fails"),
);

it.effect(
  "keeps the batch open when the last action is interrupted while an unconfigured server emptied the tray",
  () => unconfiguredWhileInFlight("is interrupted"),
);

it.effect(
  "does not restore a tile that settles while the poll is still recording vanished tiles",
  () =>
    Effect.gen(function* () {
      const pending = yield* Ref.make([proposal("p1"), proposal("p2")]);
      const reached = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const client = fakeClient({ pending: () => Ref.get(pending) });

      yield* withPoller(
        client,
        (poller, probe) =>
          Effect.gen(function* () {
            const snapshots = yield* collectIds(poller);
            yield* Queue.take(snapshots);
            assert.deepEqual(yield* Queue.take(snapshots), ["p1", "p2"]);

            yield* Ref.set(pending, [proposal("p1")]);
            yield* TestClock.adjust("15 seconds");
            yield* Deferred.await(reached);

            yield* poller.approve({ proposalId: "p1" });
            assert.deepEqual(yield* Queue.take(snapshots), ["p2"]);

            yield* Deferred.succeed(gate, undefined);
            assert.deepEqual(yield* Queue.take(snapshots), []);

            assert.deepEqual(
              (yield* Ref.get(probe.entries)).map(({ headline, outcome }) => [headline, outcome]),
              [
                ["headline p1", "approved"],
                ["headline p2", "resolved elsewhere"],
              ],
            );
            assert.equal(yield* Queue.size(snapshots), 0);
            assert.equal(yield* Ref.get(probe.flushes), 1);
          }),
        (entry) =>
          entry.outcome === "resolved elsewhere"
            ? Deferred.succeed(reached, undefined).pipe(Effect.andThen(Deferred.await(gate)))
            : Effect.void,
      );
    }),
);
