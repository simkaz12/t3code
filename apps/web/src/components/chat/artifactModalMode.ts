import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import type { MessageId, RunId } from "@t3tools/contracts";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";

import type { ChatFileAttachment } from "~/types";

export type ArtifactTarget =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly line?: number | undefined;
      readonly runId?: RunId | undefined;
    }
  | { readonly kind: "attachment"; readonly attachment: ChatFileAttachment }
  | { readonly kind: "turn"; readonly runId: RunId };

export type ArtifactOpenHandler = (target: {
  readonly path: string;
  readonly line?: number | undefined;
}) => void;

export type ArtifactMode = "diff" | "file";

function normalizeChangedPath(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path;
}

export function findArtifactSummary(
  target: ArtifactTarget,
  summaries: ReadonlyArray<ThreadCheckpointSummary>,
): ThreadCheckpointSummary | undefined {
  if (target.kind !== "file" || target.runId === undefined) return undefined;
  if (isWorkspaceImagePreviewPath(target.path.replace(/\/+$/, "") || target.path)) return undefined;

  const summary = summaries.find((candidate) => candidate.runId === target.runId);
  if (!summary) return undefined;

  const path = normalizeChangedPath(target.path);
  return summary.files.some((file) => normalizeChangedPath(file.path) === path)
    ? summary
    : undefined;
}

export function resolveArtifactMode(
  target: ArtifactTarget,
  summaries: ReadonlyArray<ThreadCheckpointSummary>,
): ArtifactMode {
  return findArtifactSummary(target, summaries) ? "diff" : "file";
}

export function findAssistantTurnSummary(
  summaries: ReadonlyArray<ThreadCheckpointSummary>,
  messageId: MessageId,
): ThreadCheckpointSummary | undefined {
  return summaries.find(
    (summary) => summary.assistantMessageId === messageId && summary.files.length > 0,
  );
}

export function findTurnSummary(
  target: ArtifactTarget,
  summaries: ReadonlyArray<ThreadCheckpointSummary>,
): ThreadCheckpointSummary | undefined {
  if (target.kind !== "turn") return undefined;
  return summaries.find((summary) => summary.runId === target.runId);
}

export function resolveTurnFilePath(
  summary: ThreadCheckpointSummary | undefined,
  selectedPath: string | null,
): string | null {
  if (!summary || summary.files.length === 0) return null;
  const selected = summary.files.find((file) => file.path === selectedPath);
  return (selected ?? summary.files[0]!).path;
}

export function countHiddenTurnFiles(summary: ThreadCheckpointSummary): number {
  return Math.max(0, (summary.filesTotal?.count ?? summary.files.length) - summary.files.length);
}

export function stepTurnFilePath(
  summary: ThreadCheckpointSummary,
  currentPath: string | null,
  dir: 1 | -1,
): string | null {
  const index = summary.files.findIndex((file) => file.path === currentPath);
  const next = summary.files[Math.min(summary.files.length - 1, Math.max(0, index + dir))];
  return next?.path ?? null;
}
