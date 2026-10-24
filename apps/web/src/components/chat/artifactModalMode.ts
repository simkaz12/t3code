import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import type { RunId } from "@t3tools/contracts";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";

import type { ChatFileAttachment } from "~/types";

export type ArtifactTarget =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly line?: number | undefined;
      readonly runId?: RunId | undefined;
    }
  | { readonly kind: "attachment"; readonly attachment: ChatFileAttachment };

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
