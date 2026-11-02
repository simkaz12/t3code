import { EnvironmentId, type MemoryProposalTile } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  actionTargetKeys,
  approveAction,
  approveInput,
  approveLabel,
  canExpand,
  detailFields,
  diffRows,
  editsFromTile,
  escapeBlursList,
  expandTile,
  flashText,
  groupTiles,
  initialCursorState,
  isDestructiveTarget,
  newTileIds,
  orderedTiles,
  pendingCount,
  runTileAction,
  suggestionFor,
  targetSummary,
  tileDiff,
  tileGlyph,
  tileKey,
  tileProjectStyle,
  type TrayCursorAction,
  trayCursorReducer,
  type TrayCursorState,
  type TrayTile,
  wordDiff,
} from "./memoryTray.logic";

const environmentId = EnvironmentId.make("environment-1");

const tile = (id: string, overrides: Partial<TrayTile> = {}): TrayTile => ({
  id,
  environmentId,
  kind: "fact",
  origin: "agent",
  headline: `Headline ${id}`,
  claim: "claim",
  why: "why",
  rejected: null,
  scope: "oktra",
  topic: "oktra-be test harness",
  purpose: "pitfall",
  threadId: "thread-1",
  threadTitle: "Thread one",
  projectId: "project-1",
  branch: null,
  machine: "laptop",
  link: "t3-thread://v2/environment-1/thread-1",
  excerpt: "",
  flags: [],
  confidence: 0.9,
  neighbours: [],
  suggestion: null,
  target: null,
  checks: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  ...overrides,
});

describe("groupTiles", () => {
  it("groups by source thread and puts flagged and low-confidence tiles first", () => {
    const groups = groupTiles([
      tile("plain-old", { createdAt: "2026-11-01T08:00:00.000Z" }),
      tile("plain-new", { threadId: "thread-2", threadTitle: "Thread two" }),
      tile("flagged", { flags: ["kind differs"], createdAt: "2026-11-01T07:00:00.000Z" }),
      tile("unsure", { confidence: 0.4, createdAt: "2026-11-01T06:00:00.000Z" }),
    ]);

    expect(
      groups.map((group) => ({
        title: group.threadTitle,
        ids: group.tiles.map((entry) => entry.id),
      })),
    ).toEqual([
      { title: "Thread one", ids: ["flagged", "unsure", "plain-old"] },
      { title: "Thread two", ids: ["plain-new"] },
    ]);
  });

  it("keeps threads of different environments apart", () => {
    const groups = groupTiles([
      tile("a"),
      tile("b", { environmentId: EnvironmentId.make("environment-2") }),
    ]);

    expect(groups).toHaveLength(2);
  });
});

describe("badge and notifications", () => {
  it("counts pending tiles", () => {
    expect(pendingCount([tile("a"), tile("b")])).toBe(2);
    expect(pendingCount([])).toBe(0);
  });

  it("reports only tiles that arrived after the first snapshot", () => {
    expect(newTileIds(null, [tile("a")])).toEqual([]);
    expect(newTileIds(new Set(["a"]), [tile("a"), tile("b")])).toEqual(["b"]);
  });
});

describe("tile actions", () => {
  const neighbour = {
    id: "record-1",
    source: "v2",
    headline: "Existing",
    similarity: 0.9,
    relation: null,
  } as const;

  it("follows the server suggestion: reinforce, supersede with its reason class, or none", () => {
    const reinforce = {
      action: "reinforce",
      recordId: "record-1",
      source: "v2",
      reasonClass: null,
    } as const;
    const supersede = {
      action: "supersede",
      recordId: "record-1",
      source: "v2",
      reasonClass: "correction",
    } as const;

    expect(
      suggestionFor(tile("a", { neighbours: [neighbour], suggestion: reinforce })),
    ).toMatchObject({ kind: "reinforce", neighbour: { id: "record-1" }, reasonClass: null });
    expect(
      suggestionFor(tile("a", { neighbours: [neighbour], suggestion: supersede })),
    ).toMatchObject({
      kind: "supersede",
      neighbour: { id: "record-1" },
      reasonClass: "correction",
    });
    expect(suggestionFor(tile("a", { neighbours: [neighbour] }))).toBe(null);
    expect(suggestionFor(tile("a", { suggestion: reinforce }))).toBe(null);
  });

  it("cannot expand a tile with no source project", () => {
    expect(canExpand(tile("a"))).toBe(true);
    expect(canExpand(tile("a", { projectId: "" }))).toBe(false);
  });

  it("approves as proposed without edits", () => {
    expect(approveInput(tile("a"))).toEqual({ proposalId: "a" });
  });

  it("sends only the edited fields and the superseded record with its reason", () => {
    const source = tile("a");
    const edits = { ...editsFromTile(source), headline: "  Better headline ", why: "new why" };

    expect(
      approveInput(source, {
        edits,
        supersede: { recordId: "record-1", reason: "correction" },
      }),
    ).toEqual({
      proposalId: "a",
      edits: { headline: "Better headline", fields: { why: "new why" } },
      supersedes: ["record-1"],
      reason: "correction",
    });
  });
});

describe("runTileAction", () => {
  const commands = () => ({
    approve: vi.fn(async () => "approved"),
    reject: vi.fn(async () => "rejected"),
    reinforce: vi.fn(async () => "reinforced"),
  });

  it("sends each action to its command with the right body", async () => {
    const calls = commands();
    const source = tile("a");

    await runTileAction(source, { type: "approve" }, calls);
    await runTileAction(
      source,
      { type: "supersede", recordId: "record-1", reason: "changed" },
      calls,
    );
    await runTileAction(source, { type: "reject", reason: "duplicate" }, calls);
    await runTileAction(source, { type: "reinforce", recordId: "record-2" }, calls);

    expect(calls.approve.mock.calls).toEqual([
      [{ environmentId, input: { proposalId: "a" } }],
      [
        {
          environmentId,
          input: { proposalId: "a", supersedes: ["record-1"], reason: "changed" },
        },
      ],
    ]);
    expect(calls.reject.mock.calls).toEqual([
      [{ environmentId, input: { proposalId: "a", reason: "duplicate" } }],
    ]);
    expect(calls.reinforce.mock.calls).toEqual([
      [{ environmentId, input: { proposalId: "a", recordId: "record-2" } }],
    ]);
  });
});

describe("expandTile", () => {
  it("creates one thread in the source project seeded with the proposal, flags, neighbours and link", async () => {
    const newThread = vi.fn(async () => ({ threadId: "thread-new" }));
    const source = tile("a", {
      flags: ["restates a record"],
      neighbours: [
        {
          id: "record-1",
          source: "v2",
          headline: "Existing",
          similarity: 0.93,
          relation: "restatement",
        },
      ],
    });

    await expandTile(source, newThread);

    expect(newThread).toHaveBeenCalledTimes(1);
    const [project, options] = newThread.mock.calls[0] as unknown as [
      { environmentId: string; projectId: string },
      { prompt: string },
    ];
    expect(project).toEqual({ environmentId, projectId: "project-1" });
    expect(options.prompt).toContain('"headline": "Headline a"');
    expect(options.prompt).toContain("restates a record");
    expect(options.prompt).toContain("- [v2] Existing (record-1), restatement");
    expect(options.prompt).toContain(source.link);
  });
});

describe("targeted tiles", () => {
  const targeted = (
    action: "retire" | "supersede" | "merge" | "promote",
    overrides: Partial<NonNullable<MemoryProposalTile["target"]>> = {},
  ) =>
    tile("t", {
      origin: action === "promote" ? "promotion" : "cleaner",
      headline: "Old tinker note",
      target: {
        recordId: "record-9",
        source: action === "promote" ? "legacy" : "v2",
        action,
        replacementId: "record-keeper",
        recordHeadline: "Old tinker note",
        replacementHeadline: "Keeper note",
        reason: "stale",
        ...overrides,
      },
    });

  it("labels the approve button by what it does", () => {
    expect(approveLabel(tile("a"))).toBe("Approve");
    expect(approveLabel(targeted("retire"))).toBe("Retire");
    expect(approveLabel(targeted("merge"))).toBe("Merge");
    expect(approveLabel(targeted("supersede"))).toBe("Supersede");
    expect(approveLabel(targeted("promote"))).toBe("Promote");
  });

  it("treats every target but promote as destructive", () => {
    expect(isDestructiveTarget(tile("a"))).toBe(false);
    expect(isDestructiveTarget(targeted("promote"))).toBe(false);
    expect(isDestructiveTarget(targeted("retire"))).toBe(true);
    expect(isDestructiveTarget(targeted("merge"))).toBe(true);
    expect(isDestructiveTarget(targeted("supersede"))).toBe(true);
  });

  it("summarises the affected record and the replacement by headline", () => {
    expect(targetSummary(tile("a"))).toBe(null);
    expect(targetSummary(targeted("retire"))).toEqual({
      label: "Retire",
      sentence: "Approving retires this record.",
      record: { label: "Retires", text: "Old tinker note", id: "record-9" },
      keeper: null,
      reason: "stale",
    });
    expect(targetSummary(targeted("promote"))?.record).toEqual({
      label: "Promotes",
      text: "Old tinker note",
      id: "record-9",
    });
  });

  it("shows the keeper on merge and supersede only", () => {
    const keeper = { label: "Keeps", text: "Keeper note", id: "record-keeper" };

    expect(targetSummary(targeted("merge"))?.keeper).toEqual(keeper);
    expect(targetSummary(targeted("supersede"))?.keeper).toEqual(keeper);
    expect(targetSummary(targeted("supersede"))?.record?.label).toBe("Supersedes");
    expect(targetSummary(targeted("retire"))?.keeper).toBe(null);
    expect(targetSummary(targeted("promote"))?.keeper).toBe(null);
  });

  it("falls back to an unknown record naming the id when a headline is null", () => {
    const summary = targetSummary(
      targeted("merge", { recordHeadline: null, replacementHeadline: null }),
    );

    expect(summary?.record).toEqual({
      label: "Retires",
      text: "unknown record (record-9)",
      id: null,
    });
    expect(summary?.keeper).toEqual({
      label: "Keeps",
      text: "unknown record (record-keeper)",
      id: null,
    });
  });

  it("omits a line whose id is empty, null or missing, never rendering a bare keeps", () => {
    for (const replacementId of ["", "  ", null, undefined]) {
      const summary = targetSummary(targeted("merge", { replacementId }));

      expect(summary?.keeper).toBe(null);
      expect(summary?.sentence).toBe("Approving retires this record.");
    }

    expect(targetSummary(targeted("supersede", { replacementId: "" }))?.sentence).toBe(
      "Approving marks this record superseded by a new record.",
    );
    expect(targetSummary(targeted("retire", { recordId: "" }))?.record).toBe(null);
  });
});

describe("wordDiff", () => {
  const words = (text: string) => text.split(" ");

  it("returns one unchanged segment for identical texts", () => {
    const segments = wordDiff("keep  this\nline", "keep this line");

    expect(segments).toEqual([{ kind: "same", words: words("keep this line") }]);
    expect(diffRows(segments)).toEqual({ removed: "", added: "" });
  });

  it("marks a prefix-only change as an addition ahead of the unchanged rest", () => {
    const segments = wordDiff(
      "alpha beta gamma delta epsilon",
      "zeta alpha beta gamma delta epsilon",
    );

    expect(segments).toEqual([
      { kind: "change", removed: [], added: ["zeta"] },
      { kind: "same", words: words("alpha beta gamma delta epsilon") },
    ]);
    expect(diffRows(segments)).toEqual({ removed: "", added: "zeta" });
  });

  it("absorbs a short unchanged run between two changes into the change", () => {
    const segments = wordDiff(
      "the cache is warm and the queue is empty now",
      "a cache was cold and a queue was full now",
    );

    expect(segments).toEqual([
      {
        kind: "change",
        removed: words("the cache is warm and the queue is empty"),
        added: words("a cache was cold and a queue was full"),
      },
      { kind: "same", words: ["now"] },
    ]);
  });

  it("keeps an unchanged run of four words or more as its own segment", () => {
    const segments = wordDiff(
      "old start one two three four old end",
      "new start one two three four new end",
    );

    expect(segments.map((segment) => segment.kind)).toEqual(["change", "same", "change", "same"]);
    expect(diffRows(segments)).toEqual({ removed: "old … old", added: "new … new" });
  });

  it("collapses a whole rewrite into a single change", () => {
    expect(wordDiff("one two three", "four five six")).toEqual([
      { kind: "change", removed: words("one two three"), added: words("four five six") },
    ]);
  });
});

describe("tileDiff", () => {
  const neighbour = {
    id: "record-1",
    source: "v2",
    headline: "Deploys wait for the drain",
    similarity: 0.9,
    relation: null,
  } as const;
  const supersede = {
    action: "supersede",
    recordId: "record-1",
    source: "v2",
    reasonClass: "changed",
  } as const;

  it("diffs the superseded neighbour headline against the tile headline", () => {
    const diff = tileDiff(
      tile("a", {
        headline: "Deploys skip the drain",
        neighbours: [neighbour],
        suggestion: supersede,
      }),
    );

    expect(diff).not.toBeNull();
    expect(diffRows(diff!)).toEqual({ removed: "wait for", added: "skip" });
  });

  it("falls back to the target record headline and ignores plain tiles", () => {
    const targeted = tile("t", {
      headline: "Keeper note",
      target: {
        recordId: "record-9",
        source: "v2",
        action: "merge",
        recordHeadline: "Old note",
        replacementHeadline: "Keeper note",
      },
    });

    expect(diffRows(tileDiff(targeted)!)).toEqual({ removed: "Old", added: "Keeper" });
    expect(tileDiff(tile("a"))).toBeNull();
  });

  it("returns null when the old and new headlines match", () => {
    expect(
      tileDiff(
        tile("a", {
          headline: neighbour.headline,
          neighbours: [neighbour],
          suggestion: supersede,
        }),
      ),
    ).toBeNull();
  });
});

describe("tile presentation", () => {
  it("picks one glyph by suggestion, target and kind", () => {
    const suggestion = (action: "reinforce" | "supersede") =>
      ({ action, recordId: "r", source: "v2", reasonClass: null }) as const;
    const target = (action: "retire" | "supersede" | "merge" | "promote") =>
      ({
        recordId: "r",
        source: "v2",
        action,
        recordHeadline: null,
        replacementHeadline: null,
      }) as const;

    expect(tileGlyph(tile("a"))).toBe("·");
    expect(tileGlyph(tile("a", { kind: "decision" }))).toBe("◆");
    expect(tileGlyph(tile("a", { suggestion: suggestion("supersede") }))).toBe("↻");
    expect(tileGlyph(tile("a", { suggestion: suggestion("reinforce"), kind: "decision" }))).toBe(
      "≡",
    );
    expect(tileGlyph(tile("a", { target: target("retire") }))).toBe("↻");
    expect(tileGlyph(tile("a", { target: target("merge") }))).toBe("↻");
    expect(tileGlyph(tile("a", { target: target("supersede") }))).toBe("↻");
    expect(tileGlyph(tile("a", { target: target("promote") }))).toBe("·");
  });

  it("derives the project chip from the icon override or the project title", () => {
    expect(tileProjectStyle(null)).toEqual({ monogram: "··", color: "var(--muted-foreground)" });
    expect(tileProjectStyle({ title: "t3code", projectIcon: null })).toEqual({
      monogram: expect.any(String),
      color: expect.stringMatching(/^var\(--color-[a-z]+-400\)$/),
    });
    expect(
      tileProjectStyle({
        title: "t3code",
        projectIcon: { kind: "monogram", text: "XY", color: "rose" },
      }),
    ).toEqual({ monogram: "XY", color: "var(--color-rose-400)" });
    expect(
      tileProjectStyle({
        title: "t3code",
        projectIcon: { kind: "lucide", name: "rocket", color: "teal" },
      }).color,
    ).toBe("var(--color-teal-400)");
  });

  it("lists only the detail fields that have a value", () => {
    const fields = detailFields(
      tile("a", {
        why: "",
        branch: "main",
        flags: ["kind differs", "loose headline"],
        neighbours: [
          { id: "n1", source: "v2", headline: "Near one", similarity: 0.931, relation: "restates" },
          { id: "n2", source: "v2", headline: "Near two", similarity: 0.5, relation: null },
        ],
      }),
    );

    expect(fields.map((field) => field.label)).toEqual([
      "Headline",
      "Claim",
      "Thread",
      "Branch",
      "Origin",
      "Purpose",
      "Scope",
      "Topic",
      "Confidence",
      "Jev flags",
      "Neighbours",
    ]);
    expect(fields.find((field) => field.label === "Jev flags")?.lines).toEqual([
      "kind differs, loose headline",
    ]);
    expect(fields.find((field) => field.label === "Neighbours")?.lines).toEqual([
      "Near one · 0.93 · restates",
      "Near two · 0.50",
    ]);
  });

  it("describes a target in the detail fields", () => {
    const fields = detailFields(
      tile("t", {
        target: {
          recordId: "record-9",
          source: "v2",
          action: "retire",
          recordHeadline: "Old note",
          replacementHeadline: null,
          reason: "stale",
        },
      }),
    );

    expect(fields.find((field) => field.label === "Target")?.lines).toEqual([
      "Retires: Old note",
      "Approving retires this record.",
      "Reason: stale",
    ]);
  });
});

describe("approveAction and flashText", () => {
  const neighbour = {
    id: "record-1",
    source: "v2",
    headline: "Existing",
    similarity: 0.9,
    relation: null,
  } as const;

  it("supersedes when the tile carries a supersede suggestion and approves otherwise", () => {
    const superseding = tile("a", {
      neighbours: [neighbour],
      suggestion: { action: "supersede", recordId: "record-1", source: "v2", reasonClass: null },
    });
    const reinforcing = tile("b", {
      neighbours: [neighbour],
      suggestion: { action: "reinforce", recordId: "record-1", source: "v2", reasonClass: null },
    });
    const edits = { ...editsFromTile(superseding), claim: "new claim" };

    expect(approveAction(superseding)).toEqual({
      type: "supersede",
      recordId: "record-1",
      reason: "changed",
    });
    expect(approveAction(superseding, edits)).toMatchObject({ type: "supersede", edits });
    expect(approveAction(reinforcing)).toEqual({ type: "approve" });
    expect(approveAction(tile("c"))).toEqual({ type: "approve" });
  });

  it("sends the edited claim as a field edit", () => {
    const source = tile("a");
    const action = approveAction(source, { ...editsFromTile(source), claim: "better claim" });

    expect(action.type === "approve" && action.edits !== undefined).toBe(true);
    expect(approveInput(source, action.type === "approve" ? { edits: action.edits! } : {})).toEqual(
      {
        proposalId: "a",
        edits: { fields: { claim: "better claim" } },
      },
    );
  });

  it("counts finished actions into the footer flash", () => {
    const superseding = { type: "supersede", recordId: "r", reason: "changed" } as const;
    const saved = { type: "approve", edits: editsFromTile(tile("a")) } as const;

    expect(flashText([{ type: "approve" }, { type: "approve" }, superseding])).toBe(
      "Approved 2, Superseded 1",
    );
    expect(flashText([{ type: "reject" }, { type: "reject" }, { type: "reject" }])).toBe(
      "Rejected 3",
    );
    expect(flashText([{ type: "reinforce", recordId: "r" }])).toBe("Reinforced");
    expect(flashText([saved])).toBe("Saved");
    expect(flashText([])).toBe("");
  });
});

describe("trayCursorReducer", () => {
  const run = (state: TrayCursorState, ...actions: ReadonlyArray<TrayCursorAction>) =>
    actions.reduce(trayCursorReducer, state);
  const synced = (keys: ReadonlyArray<string>) =>
    trayCursorReducer(initialCursorState, { type: "sync", keys });

  it("moves the cursor within bounds and resets the button cursor", () => {
    const start = run(synced(["a", "b", "c"]), { type: "moveButton", delta: 1 });

    expect(start.button).toBe(0);
    expect(run(start, { type: "move", delta: 1 })).toMatchObject({ cursor: 1, button: null });
    expect(run(start, { type: "move", delta: -1 })).toMatchObject({ cursor: 0, button: null });
    expect(run(synced(["a", "b", "c"]), { type: "move", delta: 9 }).cursor).toBe(2);
    expect(trayCursorReducer(synced([]), { type: "move", delta: 1 }).cursor).toBe(0);
  });

  it("cycles the button cursor none, approve, reject, details and wraps both ways", () => {
    const state = synced(["a"]);
    const right = (count: number) =>
      run(
        state,
        ...Array.from({ length: count }, () => ({ type: "moveButton", delta: 1 }) as const),
      );
    const left = (count: number) =>
      run(
        state,
        ...Array.from({ length: count }, () => ({ type: "moveButton", delta: -1 }) as const),
      );

    expect([1, 2, 3, 4].map((count) => right(count).button)).toEqual([0, 1, 2, 0]);
    expect([1, 2, 3, 4].map((count) => left(count).button)).toEqual([2, 1, 0, 2]);
    expect(trayCursorReducer(synced([]), { type: "moveButton", delta: 1 }).button).toBeNull();
  });

  it("toggles marks on the cursor tile or a named tile", () => {
    const marked = run(
      synced(["a", "b"]),
      { type: "toggleMark" },
      { type: "toggleMark", key: "b" },
    );

    expect([...marked.marks]).toEqual(["a", "b"]);
    expect([...run(marked, { type: "toggleMark" }).marks]).toEqual(["b"]);
    expect(trayCursorReducer(synced([]), { type: "toggleMark" }).marks.size).toBe(0);
  });

  it("escapes the button cursor first, then the marks, then blurs the list", () => {
    const state = run(synced(["a", "b"]), { type: "toggleMark" }, { type: "moveButton", delta: 1 });

    expect(escapeBlursList(state)).toBe(false);
    const withoutButton = run(state, { type: "escape" });
    expect(withoutButton.button).toBeNull();
    expect(withoutButton.marks.size).toBe(1);
    expect(escapeBlursList(withoutButton)).toBe(false);
    const cleared = run(withoutButton, { type: "escape" });
    expect(cleared.marks.size).toBe(0);
    expect(escapeBlursList(cleared)).toBe(true);
  });

  it("selects a tile by key and clears the button cursor", () => {
    const state = run(
      synced(["a", "b"]),
      { type: "moveButton", delta: 1 },
      { type: "select", key: "b" },
    );

    expect(state).toMatchObject({ cursor: 1, button: null });
    expect(run(state, { type: "select", key: "gone" })).toBe(state);
    expect(run(state, { type: "clearButton" })).toBe(state);
  });

  it("acts on the marked tiles in list order, else on the cursor tile", () => {
    const state = synced(["a", "b", "c"]);

    expect(actionTargetKeys(state)).toEqual(["a"]);
    expect(
      actionTargetKeys(
        run(state, { type: "toggleMark", key: "c" }, { type: "toggleMark", key: "b" }),
      ),
    ).toEqual(["b", "c"]);
    expect(actionTargetKeys(synced([]))).toEqual([]);
  });

  it("keeps the cursor on its tile when others come and go, and drops stale marks", () => {
    const state = run(
      synced(["a", "b", "c", "d"]),
      { type: "move", delta: 2 },
      { type: "toggleMark", key: "a" },
      { type: "toggleMark", key: "d" },
    );

    const arrived = run(state, { type: "sync", keys: ["x", "a", "b", "c", "d"] });
    expect(arrived.cursor).toBe(3);

    const removedBefore = run(state, { type: "sync", keys: ["b", "c", "d"] });
    expect(removedBefore.cursor).toBe(1);
    expect([...removedBefore.marks]).toEqual(["d"]);
  });

  it("moves to the tile that takes the removed cursor tile's place", () => {
    const state = run(
      synced(["a", "b", "c"]),
      { type: "move", delta: 1 },
      { type: "moveButton", delta: 1 },
    );

    const next = run(state, { type: "sync", keys: ["a", "c"] });
    expect(next).toMatchObject({ cursor: 1, button: null });
    expect(run(next, { type: "sync", keys: ["a"] }).cursor).toBe(0);
    expect(run(next, { type: "sync", keys: [] }).cursor).toBe(0);
  });
});

describe("tile order", () => {
  it("flattens the thread groups in order and keys tiles by environment", () => {
    const flat = orderedTiles([
      tile("plain", { threadId: "thread-2" }),
      tile("flagged", { flags: ["kind differs"] }),
      tile("other", { threadId: "thread-2" }),
    ]);

    expect(flat.map((entry) => entry.id)).toEqual(["flagged", "plain", "other"]);
    expect(tileKey(tile("a"))).toBe("environment-1:a");
  });
});
