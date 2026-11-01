import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  type MemoryApproveInput,
  type MemoryProposalNeighbour,
  type MemoryProposalTile,
  type MemoryReinforceInput,
  type MemoryRejectInput,
  type MemorySupersedeReason,
  ProjectId,
  type ScopedProjectRef,
} from "@t3tools/contracts";

const LOW_CONFIDENCE = 0.6;

export interface TrayTile extends MemoryProposalTile {
  readonly environmentId: EnvironmentId;
}

export interface TileGroup {
  readonly threadId: string;
  readonly threadTitle: string;
  readonly tiles: ReadonlyArray<TrayTile>;
}

export interface TileSuggestion {
  readonly kind: "reinforce" | "supersede";
  readonly neighbour: MemoryProposalNeighbour;
  readonly reasonClass: MemorySupersedeReason | null;
}

export interface TileEdits {
  readonly headline: string;
  readonly claim: string;
  readonly why: string;
  readonly rejected: string;
  readonly scope: string;
  readonly purpose: string;
  readonly topic: string;
}

export const isLowConfidence = (tile: Pick<MemoryProposalTile, "confidence">) =>
  tile.confidence !== null && tile.confidence < LOW_CONFIDENCE;

const needsAttention = (tile: MemoryProposalTile) => tile.flags.length > 0 || isLowConfidence(tile);

function compareTiles(a: MemoryProposalTile, b: MemoryProposalTile): number {
  const attention = Number(needsAttention(b)) - Number(needsAttention(a));
  if (attention !== 0) return attention;

  const flags = b.flags.length - a.flags.length;
  if (flags !== 0) return flags;

  if (a.confidence !== b.confidence) {
    if (a.confidence === null) return 1;
    if (b.confidence === null) return -1;
    return a.confidence - b.confidence;
  }

  return b.createdAt.localeCompare(a.createdAt);
}

export function groupTiles(tiles: ReadonlyArray<TrayTile>): ReadonlyArray<TileGroup> {
  const byThread = new Map<string, { threadTitle: string; tiles: Array<TrayTile> }>();
  for (const tile of tiles.toSorted(compareTiles)) {
    const key = `${tile.environmentId}:${tile.threadId}`;
    const group = byThread.get(key);
    if (group === undefined) byThread.set(key, { threadTitle: tile.threadTitle, tiles: [tile] });
    else group.tiles.push(tile);
  }

  return Array.from(byThread, ([key, group]) => ({ threadId: key, ...group }));
}

export const pendingCount = (tiles: ReadonlyArray<unknown>) => tiles.length;

export function newTileIds(
  seen: ReadonlySet<string> | null,
  tiles: ReadonlyArray<Pick<MemoryProposalTile, "id">>,
): ReadonlyArray<string> {
  if (seen === null) return [];

  return tiles.filter((tile) => !seen.has(tile.id)).map((tile) => tile.id);
}

export function suggestionFor(tile: MemoryProposalTile): TileSuggestion | null {
  const { suggestion } = tile;
  if (suggestion === null) return null;

  const neighbour = tile.neighbours.find((candidate) => candidate.id === suggestion.recordId);
  if (neighbour === undefined) return null;

  return { kind: suggestion.action, neighbour, reasonClass: suggestion.reasonClass };
}

const MAX_INDIVIDUAL_NOTICES = 3;

export interface TrayNotice {
  readonly type: "info" | "warning";
  readonly title: string;
  readonly description?: string;
  readonly timeout: number;
  readonly priority: "low" | "high";
}

const decisionNotice = (headline: string): TrayNotice => ({
  type: "warning",
  title: "Decision proposed",
  description: headline,
  timeout: 0,
  priority: "high",
});

const factNotice = (headline: string): TrayNotice => ({
  type: "info",
  title: "Memory proposed",
  description: headline,
  timeout: 5_000,
  priority: "low",
});

export function trayNotices(
  arrived: ReadonlyArray<Pick<MemoryProposalTile, "kind" | "headline">>,
): ReadonlyArray<TrayNotice> {
  if (arrived.length <= MAX_INDIVIDUAL_NOTICES) {
    return arrived.map((tile) =>
      tile.kind === "decision" ? decisionNotice(tile.headline) : factNotice(tile.headline),
    );
  }

  const facts = arrived.filter((tile) => tile.kind === "fact");
  const decisions = arrived.filter((tile) => tile.kind === "decision");
  const factBatch: ReadonlyArray<TrayNotice> =
    facts.length === 0
      ? []
      : [
          {
            type: "info",
            title: `${facts.length} memory ${facts.length === 1 ? "proposal" : "proposals"}`,
            timeout: 5_000,
            priority: "low",
          },
        ];
  const decisionBatch: ReadonlyArray<TrayNotice> =
    decisions.length > MAX_INDIVIDUAL_NOTICES
      ? [
          {
            type: "warning",
            title: `${decisions.length} decisions proposed`,
            timeout: 0,
            priority: "high",
          },
        ]
      : decisions.map((tile) => decisionNotice(tile.headline));

  return [...decisionBatch, ...factBatch];
}

const TARGET_LABELS = {
  retire: "Retire",
  supersede: "Supersede",
  merge: "Merge",
  promote: "Promote",
} as const;

export const approveLabel = (tile: Pick<MemoryProposalTile, "target">) =>
  tile.target === null ? "Approve" : TARGET_LABELS[tile.target.action];

export const isDestructiveTarget = (tile: Pick<MemoryProposalTile, "target">) =>
  tile.target !== null && tile.target.action !== "promote";

export interface TileTargetLine {
  readonly label: string;
  readonly text: string;
  readonly id: string | null;
}

export interface TileTargetSummary {
  readonly label: string;
  readonly sentence: string;
  readonly record: TileTargetLine | null;
  readonly keeper: TileTargetLine | null;
  readonly reason: string | null;
}

const RECORD_LINE_LABELS = {
  retire: "Retires",
  supersede: "Supersedes",
  merge: "Retires",
  promote: "Promotes",
} as const;

function targetLine(
  label: string,
  id: string | null | undefined,
  headline: string | null | undefined,
): TileTargetLine | null {
  if (id === null || id === undefined || id.trim() === "") return null;
  if (headline === null || headline === undefined || headline.trim() === "") {
    return { label, text: `unknown record (${id})`, id: null };
  }

  return { label, text: headline, id };
}

function targetSentence(action: keyof typeof TARGET_LABELS, hasKeeper: boolean): string {
  switch (action) {
    case "retire":
      return "Approving retires this record.";
    case "merge":
      return hasKeeper
        ? "Approving retires this record and keeps the record shown."
        : "Approving retires this record.";
    case "supersede":
      return hasKeeper
        ? "Approving marks this record superseded by the record shown."
        : "Approving marks this record superseded by a new record.";
    case "promote":
      return "Approving promotes this legacy record into the current store.";
  }
}

export function targetSummary(tile: Pick<MemoryProposalTile, "target">): TileTargetSummary | null {
  const { target } = tile;
  if (target === null) return null;

  const keeper =
    target.action === "merge" || target.action === "supersede"
      ? targetLine("Keeps", target.replacementId, target.replacementHeadline)
      : null;

  return {
    label: TARGET_LABELS[target.action],
    sentence: targetSentence(target.action, keeper !== null),
    record: targetLine(RECORD_LINE_LABELS[target.action], target.recordId, target.recordHeadline),
    keeper,
    reason: target.reason ?? null,
  };
}

export const canExpand = (tile: Pick<MemoryProposalTile, "projectId">) => tile.projectId !== "";

export function editsFromTile(tile: MemoryProposalTile): TileEdits {
  return {
    headline: tile.headline,
    claim: tile.claim,
    why: tile.why,
    rejected: tile.rejected ?? "",
    scope: tile.scope,
    purpose: tile.purpose ?? "",
    topic: tile.topic ?? "",
  };
}

export function approveInput(
  tile: MemoryProposalTile,
  options: {
    readonly edits?: TileEdits;
    readonly supersede?: { readonly recordId: string; readonly reason: MemorySupersedeReason };
  } = {},
): MemoryApproveInput {
  const original = editsFromTile(tile);
  const edits = options.edits;
  const changed = (field: keyof TileEdits) =>
    edits !== undefined && edits[field].trim() !== original[field];
  const fields = {
    ...(changed("claim") ? { claim: edits!.claim.trim() } : {}),
    ...(changed("why") ? { why: edits!.why.trim() } : {}),
    ...(changed("rejected") ? { rejected: edits!.rejected.trim() } : {}),
  };
  const editBody = {
    ...(changed("headline") ? { headline: edits!.headline.trim() } : {}),
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
    ...(changed("scope") ? { scope: edits!.scope.trim() } : {}),
    ...(changed("purpose") ? { purpose: edits!.purpose.trim() } : {}),
    ...(changed("topic") ? { topic: edits!.topic.trim() } : {}),
  };

  return {
    proposalId: tile.id,
    ...(Object.keys(editBody).length > 0 ? { edits: editBody } : {}),
    ...(options.supersede === undefined
      ? {}
      : { supersedes: [options.supersede.recordId], reason: options.supersede.reason }),
  };
}

function expandSeed(tile: MemoryProposalTile): string {
  const proposal = {
    id: tile.id,
    kind: tile.kind,
    origin: tile.origin,
    headline: tile.headline,
    claim: tile.claim,
    why: tile.why,
    rejected: tile.rejected,
    scope: tile.scope,
    topic: tile.topic,
    purpose: tile.purpose,
    target: tile.target,
  };

  return [
    `Review this memory proposal (${tile.id}) with me.`,
    "",
    "Proposal:",
    "```json",
    JSON.stringify(proposal, null, 2),
    "```",
    "",
    `Flags: ${tile.flags.length === 0 ? "none" : tile.flags.join("; ")}`,
    "",
    "Nearest records:",
    ...(tile.neighbours.length === 0
      ? ["none"]
      : tile.neighbours.map(
          (neighbour) =>
            `- [${neighbour.source}] ${neighbour.headline} (${neighbour.id})${neighbour.relation ? `, ${neighbour.relation}` : ""}`,
        )),
    "",
    `Source thread: ${tile.link}`,
    `Read it with t3_thread_read before you answer. Use memory_recall for related records.`,
  ].join("\n");
}

export async function expandTile<Result>(
  tile: TrayTile,
  newThread: (project: ScopedProjectRef, options: { readonly prompt: string }) => Promise<Result>,
): Promise<Result> {
  return newThread(scopeProjectRef(tile.environmentId, ProjectId.make(tile.projectId)), {
    prompt: expandSeed(tile),
  });
}

export type TileAction =
  | { readonly type: "approve"; readonly edits?: TileEdits }
  | {
      readonly type: "supersede";
      readonly recordId: string;
      readonly reason: MemorySupersedeReason;
      readonly edits?: TileEdits;
    }
  | { readonly type: "reject"; readonly reason?: string }
  | { readonly type: "reinforce"; readonly recordId: string };

export interface TileCommands<Result> {
  readonly approve: (request: {
    readonly environmentId: EnvironmentId;
    readonly input: MemoryApproveInput;
  }) => Promise<Result>;
  readonly reject: (request: {
    readonly environmentId: EnvironmentId;
    readonly input: MemoryRejectInput;
  }) => Promise<Result>;
  readonly reinforce: (request: {
    readonly environmentId: EnvironmentId;
    readonly input: MemoryReinforceInput;
  }) => Promise<Result>;
}

export function runTileAction<Result>(
  tile: TrayTile,
  action: TileAction,
  commands: TileCommands<Result>,
): Promise<Result> {
  const { environmentId } = tile;
  switch (action.type) {
    case "approve":
      return commands.approve({
        environmentId,
        input: approveInput(tile, action.edits === undefined ? {} : { edits: action.edits }),
      });
    case "supersede":
      return commands.approve({
        environmentId,
        input: approveInput(tile, {
          ...(action.edits === undefined ? {} : { edits: action.edits }),
          supersede: { recordId: action.recordId, reason: action.reason },
        }),
      });
    case "reject":
      return commands.reject({
        environmentId,
        input: {
          proposalId: tile.id,
          ...(action.reason === undefined ? {} : { reason: action.reason }),
        },
      });
    case "reinforce":
      return commands.reinforce({
        environmentId,
        input: { proposalId: tile.id, recordId: action.recordId },
      });
  }
}
