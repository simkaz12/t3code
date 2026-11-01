import { EnvironmentId, type MemoryProposalTile } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  approveInput,
  approveLabel,
  canExpand,
  editsFromTile,
  expandTile,
  groupTiles,
  isDestructiveTarget,
  newTileIds,
  pendingCount,
  runTileAction,
  suggestionFor,
  targetSummary,
  type TrayTile,
  trayNotices,
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

describe("trayNotices", () => {
  const fact = (headline: string) => ({ kind: "fact", headline }) as const;
  const decision = (headline: string) => ({ kind: "decision", headline }) as const;

  it("raises one notice per tile up to three, decisions high and facts low", () => {
    expect(trayNotices([fact("f"), decision("d")])).toEqual([
      expect.objectContaining({ title: "Memory proposed", priority: "low", description: "f" }),
      expect.objectContaining({
        title: "Decision proposed",
        priority: "high",
        timeout: 0,
        description: "d",
      }),
    ]);
  });

  it("batches facts into one low-priority notice when more than three arrive", () => {
    expect(trayNotices([fact("a"), fact("b"), fact("c"), fact("d")])).toEqual([
      expect.objectContaining({ title: "4 memory proposals", priority: "low" }),
    ]);
  });

  it("still raises the prominent notice for a decision inside a large batch", () => {
    const notices = trayNotices([fact("a"), fact("b"), fact("c"), decision("pick sqlite")]);

    expect(notices).toEqual([
      expect.objectContaining({
        title: "Decision proposed",
        description: "pick sqlite",
        priority: "high",
        timeout: 0,
      }),
      expect.objectContaining({ title: "3 memory proposals", priority: "low" }),
    ]);
  });

  it("batches decisions into one prominent notice when more than three arrive", () => {
    expect(
      trayNotices([decision("a"), decision("b"), decision("c"), decision("d"), fact("e")]),
    ).toEqual([
      expect.objectContaining({ title: "4 decisions proposed", priority: "high", timeout: 0 }),
      expect.objectContaining({ title: "1 memory proposal", priority: "low" }),
    ]);
  });
});
