import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { Ref } from "react";

import { useRenderedAppearance } from "~/hooks/useTheme";
import { useClientSettings } from "~/hooks/useSettings";
import { useCheckpointDiff } from "~/lib/checkpointDiffState";
import {
  buildFileDiffContentVersion,
  buildFileDiffIdentityKey,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";

import { DiffPanelLoadingState } from "../DiffPanelShell";
import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";

function normalizeDiffPath(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path;
}

function ArtifactDiffMessage(props: { readonly children: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
      <p>{props.children}</p>
    </div>
  );
}

export default function ArtifactDiffView(props: {
  readonly threadRef: ScopedThreadRef;
  readonly summary: ThreadCheckpointSummary;
  readonly path: string;
  readonly codeViewRef: Ref<CodeViewHandle<undefined, undefined>>;
}) {
  const { threadRef, summary } = props;
  const resolvedTheme = useRenderedAppearance();
  const settings = useClientSettings((current) => ({
    diffIgnoreWhitespace: current.diffIgnoreWhitespace,
    wordWrap: current.wordWrap,
  }));
  const checkpointDiff = useCheckpointDiff(
    {
      environmentId: threadRef.environmentId,
      threadId: threadRef.threadId,
      fromTurnCount: Math.max(0, summary.checkpointTurnCount - 1),
      toTurnCount: summary.checkpointTurnCount,
      ignoreWhitespace: settings.diffIgnoreWhitespace,
      cacheScope: `turn:${summary.runId}`,
    },
    { enabled: true },
  );
  const renderablePatch = getRenderablePatch(
    checkpointDiff.data?.diff,
    `artifact-modal:${resolvedTheme}`,
    { compactPartialHunkOffsets: false },
  );

  if (!renderablePatch) {
    if (checkpointDiff.error) {
      return <p className="px-3 py-2 text-2xs text-error/80">{checkpointDiff.error}</p>;
    }
    if (checkpointDiff.isPending && checkpointDiff.data === null) {
      return <DiffPanelLoadingState label="Loading checkpoint diff..." />;
    }
    return <ArtifactDiffMessage>No patch available for this selection.</ArtifactDiffMessage>;
  }

  if (renderablePatch.kind === "raw") {
    return <ArtifactDiffMessage>{renderablePatch.reason}</ArtifactDiffMessage>;
  }

  const path = normalizeDiffPath(props.path);
  const fileDiff = renderablePatch.files.find(
    (candidate) => normalizeDiffPath(resolveFileDiffPath(candidate)) === path,
  );
  if (!fileDiff) {
    return <ArtifactDiffMessage>No changes to this file in this turn.</ArtifactDiffMessage>;
  }

  const fileKey = buildFileDiffIdentityKey(fileDiff);
  return (
    <StyledDiffCodeView
      key={`${summary.runId}:${fileKey}:${resolvedTheme}`}
      viewerRef={props.codeViewRef}
      className="h-full min-h-0 overflow-auto"
      items={[
        {
          id: fileKey,
          type: "diff",
          fileDiff,
          version: buildFileDiffContentVersion(fileDiff),
        },
      ]}
      options={{
        diffStyle: "split",
        lineDiffType: "none",
        overflow: settings.wordWrap ? "wrap" : "scroll",
        theme: resolveDiffThemeName(resolvedTheme),
        preferredHighlighter: PREFERRED_HIGHLIGHTER,
        themeType: resolvedTheme,
        stickyHeaders: true,
      }}
    />
  );
}
