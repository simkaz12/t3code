import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  type EnvironmentId,
  type MemoryApproveInput,
  type MemoryAudience,
  type MemoryProposalNeighbour,
  type MemoryProposalTile,
  type MemoryReinforceInput,
  type MemoryRejectInput,
  type MemorySupersedeReason,
  ProjectId,
  type ProjectIconColor,
  type ScopedProjectRef,
} from "@t3tools/contracts";

import { deriveProjectIdentity } from "../../projectIdentity";

const LOW_CONFIDENCE = 0.6;

export interface TrayTile extends MemoryProposalTile {
  readonly environmentId: EnvironmentId;
}

export const TRAY_AUDIENCES: ReadonlyArray<MemoryAudience> = [
  "decider",
  "builder",
  "reviewer",
  "navigator",
];

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
  readonly rejected: string;
  readonly scope: string;
  readonly purpose: string;
  readonly topic: string;
  readonly audience: string;
  readonly where: string;
  readonly trigger: string;
  readonly leftBecause: string;
  readonly fixHint: string;
  readonly impact: string;
}

const isLowConfidence = (tile: Pick<MemoryProposalTile, "confidence">) =>
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
  const byThread = new Map<
    string,
    { threadId: string; threadTitle: string; tiles: Array<TrayTile> }
  >();
  const ordered = tiles.toSorted(compareTiles);
  for (const tile of ordered) {
    const threadId = `${tile.environmentId}:${tile.threadId}`;
    const group = byThread.get(threadId);
    if (group === undefined) {
      byThread.set(threadId, {
        threadId,
        threadTitle: tile.threadTitle,
        tiles: [tile],
      });
    } else {
      group.tiles.push(tile);
    }
  }

  return Array.from(byThread.values());
}

export const pendingCount = (tiles: ReadonlyArray<MemoryProposalTile>) => tiles.length;

export function rejectReason(draft: string): string | null {
  const reason = draft.trim();

  return reason === "" ? null : reason;
}

export function suggestionFor(tile: MemoryProposalTile): TileSuggestion | null {
  const { suggestion } = tile;
  if (suggestion === null) return null;

  const neighbour = tile.neighbours.find((candidate) => candidate.id === suggestion.recordId);
  if (neighbour === undefined) return null;

  return { kind: suggestion.action, neighbour, reasonClass: suggestion.reasonClass };
}

const TARGET_LABELS = {
  retire: "Retire",
  supersede: "Supersede",
  merge: "Merge",
  promote: "Promote",
  close: "Close",
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
  close: "Closes",
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
    case "close":
      return "Approving marks this defect closed. The excerpt is the proof.";
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

export function closeLine(tile: Pick<MemoryProposalTile, "target">): string | null {
  if (tile.target?.action !== "close") return null;

  const record = targetSummary(tile)?.record;

  return record === undefined || record === null ? null : record.text;
}

export function editsFromTile(tile: MemoryProposalTile): TileEdits {
  return {
    headline: tile.headline,
    claim: tile.claim,
    rejected: tile.rejected ?? "",
    scope: tile.scope,
    purpose: tile.purpose ?? "",
    topic: tile.topic ?? "",
    audience: tile.audience ?? "",
    where: tile.where ?? "",
    trigger: tile.trigger ?? "",
    leftBecause: tile.leftBecause ?? "",
    fixHint: tile.fixHint ?? "",
    impact: tile.impact ?? "",
  };
}

const isAudience = (value: string): value is MemoryAudience =>
  TRAY_AUDIENCES.some((audience) => audience === value);

const audienceEdit = (changed: boolean, audience: string) => {
  if (!changed) return {};
  if (audience === "") return { audience: null };

  return isAudience(audience) ? { audience } : {};
};

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
    ...(changed("rejected") ? { rejected: edits!.rejected.trim() } : {}),
    ...(changed("where") ? { where: edits!.where.trim() } : {}),
    ...(changed("trigger") ? { trigger: edits!.trigger.trim() } : {}),
    ...(changed("leftBecause") ? { leftBecause: edits!.leftBecause.trim() } : {}),
    ...(changed("fixHint") ? { fixHint: edits!.fixHint.trim() } : {}),
    ...(changed("impact") ? { impact: edits!.impact.trim() } : {}),
  };
  const audience = edits?.audience.trim() ?? "";
  const editBody = {
    ...(changed("headline") ? { headline: edits!.headline.trim() } : {}),
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
    ...(changed("scope") ? { scope: edits!.scope.trim() } : {}),
    ...(changed("purpose") ? { purpose: edits!.purpose.trim() } : {}),
    ...(changed("topic") ? { topic: edits!.topic.trim() } : {}),
    ...audienceEdit(changed("audience"), audience),
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
    rejected: tile.rejected,
    scope: tile.scope,
    topic: tile.topic,
    purpose: tile.purpose,
    audience: tile.audience,
    reader: tile.reader,
    stage: tile.stage,
    where: tile.where,
    trigger: tile.trigger,
    leftBecause: tile.leftBecause,
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
  | { readonly type: "reject"; readonly reason: string }
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
        input: { proposalId: tile.id, reason: action.reason },
      });
    case "reinforce":
      return commands.reinforce({
        environmentId,
        input: { proposalId: tile.id, recordId: action.recordId },
      });
  }
}

export const tileKey = (tile: Pick<TrayTile, "environmentId" | "id">) =>
  `${tile.environmentId}:${tile.id}`;

export const orderedTiles = (tiles: ReadonlyArray<TrayTile>): ReadonlyArray<TrayTile> =>
  groupTiles(tiles).flatMap((group) => group.tiles);

export function tileGlyph(tile: Pick<MemoryProposalTile, "kind" | "suggestion" | "target">) {
  if (tile.suggestion?.action === "reinforce") return "≡";
  if (tile.suggestion?.action === "supersede") return "↻";
  if (tile.target !== null && tile.target.action !== "promote") return "↻";

  if (tile.kind === "defect") return "!";

  return tile.kind === "decision" ? "◆" : "·";
}

export interface TileProjectStyle {
  readonly monogram: string;
  readonly color: string;
}

const NEUTRAL_PROJECT_STYLE: TileProjectStyle = {
  monogram: "··",
  color: "var(--muted-foreground)",
};

export function tileProjectStyle(
  project: Pick<EnvironmentProject, "title" | "projectIcon"> | null,
): TileProjectStyle {
  if (project === null) return NEUTRAL_PROJECT_STYLE;

  const derived = deriveProjectIdentity(project.title);
  const icon = project.projectIcon;
  const color: ProjectIconColor =
    icon?.kind === "monogram" || icon?.kind === "lucide" ? icon.color : derived.color;

  return {
    monogram: icon?.kind === "monogram" ? icon.text : derived.monogram,
    color: `var(--color-${color}-400)`,
  };
}

const SHORT_UNCHANGED_RUN = 4;

export type DiffSegment =
  | { readonly kind: "same"; readonly words: ReadonlyArray<string> }
  | {
      readonly kind: "change";
      readonly removed: ReadonlyArray<string>;
      readonly added: ReadonlyArray<string>;
    };

type MutableChange = { kind: "change"; removed: Array<string>; added: Array<string> };
type MutableSegment = { kind: "same"; words: Array<string> } | MutableChange;

const splitWords = (text: string) => text.split(/\s+/).filter((word) => word !== "");

function lcsTable(a: ReadonlyArray<string>, b: ReadonlyArray<string>): Array<Array<number>> {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  return table;
}

function rawDiffSegments(a: ReadonlyArray<string>, b: ReadonlyArray<string>) {
  const table = lcsTable(a, b);
  const segments: Array<MutableSegment> = [];
  const keep = (word: string) => {
    const last = segments.at(-1);
    if (last?.kind === "same") last.words.push(word);
    else segments.push({ kind: "same", words: [word] });
  };
  const change = (): MutableChange => {
    const last = segments.at(-1);
    if (last?.kind === "change") return last;

    const created: MutableChange = { kind: "change", removed: [], added: [] };
    segments.push(created);
    return created;
  };

  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      keep(a[i]!);
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && table[i + 1]![j]! >= table[i]![j + 1]!)) {
      change().removed.push(a[i++]!);
    } else {
      change().added.push(b[j++]!);
    }
  }

  return segments;
}

export function wordDiff(oldText: string, newText: string): ReadonlyArray<DiffSegment> {
  const merged: Array<MutableSegment> = [];
  for (const segment of rawDiffSegments(splitWords(oldText), splitWords(newText))) {
    const run = merged.at(-1);
    const before = merged.at(-2);
    const absorbs =
      segment.kind === "change" &&
      run?.kind === "same" &&
      run.words.length < SHORT_UNCHANGED_RUN &&
      before?.kind === "change";

    if (absorbs) {
      merged.pop();
      before.removed.push(...run.words, ...segment.removed);
      before.added.push(...run.words, ...segment.added);
    } else {
      merged.push(segment);
    }
  }

  return merged;
}

export interface DiffRows {
  readonly removed: string;
  readonly added: string;
}

export function diffRows(segments: ReadonlyArray<DiffSegment>): DiffRows {
  const changes = segments.filter((segment) => segment.kind === "change");

  return {
    removed: changes
      .map((segment) => segment.removed.join(" "))
      .filter((chunk) => chunk !== "")
      .join(" … "),
    added: changes
      .map((segment) => segment.added.join(" "))
      .filter((chunk) => chunk !== "")
      .join(" … "),
  };
}

function supersededHeadline(
  tile: Pick<MemoryProposalTile, "neighbours" | "suggestion" | "target">,
): string | null {
  const suggestion = tile.suggestion;
  if (suggestion?.action === "supersede") {
    const neighbour = tile.neighbours.find((candidate) => candidate.id === suggestion.recordId);
    if (neighbour !== undefined) return neighbour.headline;
  }

  const headline = tile.target?.recordHeadline;
  return headline === null || headline === undefined || headline.trim() === "" ? null : headline;
}

export function tileDiff(
  tile: Pick<MemoryProposalTile, "headline" | "neighbours" | "suggestion" | "target">,
): ReadonlyArray<DiffSegment> | null {
  const previous = supersededHeadline(tile);
  if (previous === null) return null;

  const segments = wordDiff(previous, tile.headline);
  return segments.some((segment) => segment.kind === "change") ? segments : null;
}

export const TILE_BUTTONS = ["approve", "reject", "details"] as const;
export type TileButton = (typeof TILE_BUTTONS)[number];

export function approveAction(tile: MemoryProposalTile, edits?: TileEdits): TileAction {
  const suggestion = suggestionFor(tile);
  const extra = edits === undefined ? {} : { edits };
  if (suggestion?.kind === "supersede") {
    return {
      type: "supersede",
      recordId: suggestion.neighbour.id,
      reason: suggestion.reasonClass ?? "changed",
      ...extra,
    };
  }

  return { type: "approve", ...extra };
}

export interface TrayCursorState {
  readonly keys: ReadonlyArray<string>;
  readonly cursor: number;
  readonly button: number | null;
  readonly marks: ReadonlySet<string>;
}

export type TrayCursorAction =
  | { readonly type: "sync"; readonly keys: ReadonlyArray<string> }
  | { readonly type: "move"; readonly delta: number }
  | { readonly type: "select"; readonly key: string }
  | { readonly type: "moveButton"; readonly delta: 1 | -1 }
  | { readonly type: "clearButton" }
  | { readonly type: "toggleMark"; readonly key?: string }
  | { readonly type: "escape" };

export const initialCursorState: TrayCursorState = {
  keys: [],
  cursor: 0,
  button: null,
  marks: new Set(),
};

function syncKeys(state: TrayCursorState, keys: ReadonlyArray<string>): TrayCursorState {
  const surviving = new Set(keys);
  const cursorKey = state.keys[state.cursor];
  const keptIndex = cursorKey === undefined ? -1 : keys.indexOf(cursorKey);
  const removedBefore = state.keys
    .slice(0, state.cursor)
    .filter((key) => !surviving.has(key)).length;
  const cursor =
    keptIndex >= 0
      ? keptIndex
      : Math.max(0, Math.min(keys.length - 1, state.cursor - removedBefore));

  return {
    keys,
    cursor,
    button: keptIndex >= 0 ? state.button : null,
    marks: new Set([...state.marks].filter((key) => surviving.has(key))),
  };
}

export function trayCursorReducer(
  state: TrayCursorState,
  action: TrayCursorAction,
): TrayCursorState {
  const last = state.keys.length - 1;
  switch (action.type) {
    case "sync":
      return syncKeys(state, action.keys);
    case "move":
      return last < 0
        ? state
        : {
            ...state,
            cursor: Math.max(0, Math.min(last, state.cursor + action.delta)),
            button: null,
          };
    case "select": {
      const cursor = state.keys.indexOf(action.key);
      return cursor < 0 || cursor === state.cursor ? state : { ...state, cursor, button: null };
    }
    case "moveButton": {
      if (last < 0) return state;

      const start = state.button ?? (action.delta > 0 ? -1 : TILE_BUTTONS.length);
      const button = (start + action.delta + TILE_BUTTONS.length) % TILE_BUTTONS.length;
      return { ...state, button };
    }
    case "clearButton":
      return state.button === null ? state : { ...state, button: null };
    case "toggleMark": {
      const key = action.key ?? state.keys[state.cursor];
      if (key === undefined) return state;

      const marks = new Set(state.marks);
      if (marks.has(key)) marks.delete(key);
      else marks.add(key);
      return { ...state, marks };
    }
    case "escape":
      if (state.button !== null) return { ...state, button: null };
      return state.marks.size > 0 ? { ...state, marks: new Set() } : state;
  }
}

export const escapeBlursList = (state: TrayCursorState) =>
  state.button === null && state.marks.size === 0;

export function actionTargetKeys(state: TrayCursorState): ReadonlyArray<string> {
  if (state.marks.size > 0) return state.keys.filter((key) => state.marks.has(key));

  const key = state.keys[state.cursor];
  return key === undefined ? [] : [key];
}

export function flashText(actions: ReadonlyArray<TileAction>): string {
  const counts = { approved: 0, superseded: 0, rejected: 0, reinforced: 0, saved: 0 };
  for (const action of actions) {
    if (action.type === "reject") counts.rejected++;
    else if (action.type === "reinforce") counts.reinforced++;
    else if (action.edits !== undefined) counts.saved++;
    else if (action.type === "supersede") counts.superseded++;
    else counts.approved++;
  }

  return [
    counts.approved > 0 ? `Approved ${counts.approved}` : null,
    counts.superseded > 0 ? `Superseded ${counts.superseded}` : null,
    counts.rejected > 0 ? `Rejected ${counts.rejected}` : null,
    counts.reinforced > 0 ? "Reinforced" : null,
    counts.saved > 0 ? "Saved" : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
}

export interface DetailField {
  readonly label: string;
  readonly lines: ReadonlyArray<string>;
  readonly editable?: "audience";
}

function targetLines(tile: Pick<MemoryProposalTile, "target">): ReadonlyArray<string> {
  const summary = targetSummary(tile);
  if (summary === null) return [];

  return [
    summary.record === null ? null : `${summary.record.label}: ${summary.record.text}`,
    summary.keeper === null ? null : `${summary.keeper.label}: ${summary.keeper.text}`,
    summary.sentence,
    summary.reason === null ? null : `Reason: ${summary.reason}`,
  ].filter((line) => line !== null);
}

function takenByLines(tile: Pick<MemoryProposalTile, "takenBy">): ReadonlyArray<string> {
  const { takenBy } = tile;
  if (takenBy === null) return [];

  return [`Thread ${takenBy.threadId} at ${takenBy.at}`, takenBy.link];
}

export function detailFields(tile: MemoryProposalTile): ReadonlyArray<DetailField> {
  const fields: ReadonlyArray<DetailField> = [
    { label: "Headline", lines: [tile.headline] },
    { label: "Claim", lines: [tile.claim] },
    { label: "Where", lines: [tile.where ?? ""] },
    { label: "Trigger", lines: [tile.trigger ?? ""] },
    { label: "Left because", lines: [tile.leftBecause ?? ""] },
    { label: "Fix hint", lines: [tile.fixHint ?? ""] },
    { label: "Impact", lines: [tile.impact ?? ""] },
    { label: "Status", lines: [tile.kind === "defect" ? (tile.defectStatus ?? "") : ""] },
    { label: "Taken by", lines: takenByLines(tile) },
    { label: "Rejected", lines: [tile.rejected ?? ""] },
    { label: "Audience", lines: [tile.audience ?? "none"], editable: "audience" },
    { label: "Reader", lines: [tile.reader ?? ""] },
    { label: "Stage", lines: [tile.stage] },
    { label: "Why (legacy)", lines: [tile.why ?? ""] },
    { label: "Thread", lines: [tile.threadTitle] },
    { label: "Branch", lines: [tile.branch ?? ""] },
    { label: "Origin", lines: [tile.origin] },
    { label: "Purpose", lines: [tile.purpose ?? ""] },
    { label: "Scope", lines: [tile.scope] },
    { label: "Topic", lines: [tile.topic ?? ""] },
    {
      label: "Confidence",
      lines: [tile.confidence === null ? "" : tile.confidence.toFixed(2)],
    },
    { label: "Jev flags", lines: [tile.flags.join(", ")] },
    {
      label: "Neighbours",
      lines: tile.neighbours.map((neighbour) =>
        [neighbour.headline, neighbour.similarity.toFixed(2), neighbour.relation ?? ""]
          .filter((part) => part !== "")
          .join(" · "),
      ),
    },
    { label: "Target", lines: targetLines(tile) },
  ];

  return fields
    .map((field) => ({ ...field, lines: field.lines.filter((line) => line.trim() !== "") }))
    .filter((field) => field.lines.length > 0);
}

export interface CollapsedLine {
  readonly glyph: string;
  readonly label: string;
  readonly headline: string;
}

export function collapsedLine(
  tile: Pick<MemoryProposalTile, "headline" | "kind" | "suggestion" | "target">,
): CollapsedLine {
  return {
    glyph: tileGlyph(tile),
    label: approveLabel(tile),
    headline: tile.headline,
  };
}
