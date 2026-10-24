import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";

import ChatMarkdown from "~/components/ChatMarkdown";
import { Spinner } from "~/components/ui/spinner";
import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { useFilesystemReadAccess } from "~/state/filesystem";
import type { ChatFileAttachment } from "~/types";

import { AttachmentFilePreview } from "../files/AttachmentFilePreview";
import { projectFileCacheKey } from "../files/fileContentRevision";
import { filePreviewReadErrorMessage, isMarkdownPreviewFile } from "../files/filePreviewMode";
import {
  FileSurfaceFailure,
  FileSurfaceLoading,
  FileSurfaceNotice,
} from "../files/fileSurfaceChrome";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import ReadOnlySourcePreview from "../files/ReadOnlySourcePreview";
import { useFileLineReveal } from "../files/useFileLineReveal";
import { WorkspaceImagePreview } from "../files/WorkspaceImagePreview";
import type { ArtifactOpenHandler } from "./artifactModalMode";

function ArtifactAttachmentView(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly attachment: ChatFileAttachment;
}) {
  const { attachment } = props;
  return (
    <AttachmentFilePreview
      key={`${props.environmentId}:${attachment.id}`}
      name={attachment.name}
      mimeType={attachment.mimeType}
      sizeBytes={attachment.sizeBytes}
      asset={{ environmentId: props.environmentId, attachmentId: attachment.id }}
      htmlRender={attachment.htmlRender === true}
      threadRef={props.threadRef}
    />
  );
}

function markdownImageBaseDir(relativePath: string, cwd: string): string {
  const lastSeparator = Math.max(relativePath.lastIndexOf("/"), relativePath.lastIndexOf("\\"));
  return lastSeparator >= 0
    ? resolvePathLinkTarget(relativePath.slice(0, lastSeparator), cwd)
    : cwd;
}

function ArtifactWorkspaceFileView(props: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string;
  readonly draft: boolean;
  readonly workspaceMutationId: string | null;
  readonly path: string;
  readonly line: number | undefined;
  readonly markdownRaw: boolean;
  readonly onOpenArtifact: ArtifactOpenHandler;
}) {
  const { threadRef, cwd } = props;
  const environmentId = threadRef.environmentId;
  const relativePath = props.path.replace(/\/+$/, "") || props.path;
  const isImage = isWorkspaceImagePreviewPath(relativePath);
  const fileAccess = useFilesystemReadAccess(environmentId);
  const file = useProjectFileQuery(environmentId, cwd, relativePath, !isImage);
  const onFilePostRender = useFileLineReveal(relativePath, props.line ?? null, 1);
  useWorkspaceMutationRefresh({
    enabled: !isImage,
    mutationId: props.workspaceMutationId,
    refresh: file.refresh,
    resourceKey: `file:${environmentId}:${cwd}:${relativePath}`,
  });

  if (!fileAccess.canReadFiles) {
    if (fileAccess.isPending) return <FileSurfaceLoading />;
    return (
      <FileSurfaceFailure message={fileAccess.error ?? "This connection cannot read host files."} />
    );
  }

  if (isImage) {
    return (
      <WorkspaceImagePreview
        key={relativePath}
        environmentId={environmentId}
        threadRef={threadRef}
        draft={props.draft}
        absolutePath={resolvePathLinkTarget(relativePath, cwd)}
        workspaceRoot={cwd}
        alt={relativePath}
        workspaceMutationId={props.workspaceMutationId}
      />
    );
  }

  if (file.error && file.data === null) {
    const attemptedPath = file.readError?.resolvedPath ?? file.readError?.operationPath;
    return (
      <div
        role="alert"
        className="scrollbar-gutter-both flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto px-6 text-center text-xs leading-relaxed"
      >
        <p className="text-destructive">
          {file.readError ? filePreviewReadErrorMessage(file.readError) : file.error}
        </p>
        {attemptedPath ? (
          <p className="text-muted-foreground">
            Attempted path
            <code className="block font-mono break-all text-foreground select-all">
              {attemptedPath}
            </code>
          </p>
        ) : null}
      </div>
    );
  }

  if (file.data === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        <Spinner size="lg" />
      </div>
    );
  }

  const truncatedNotice = file.data.truncated ? (
    <FileSurfaceNotice>
      Preview limited to the first 1 MB of a {file.data.byteLength.toLocaleString()} byte file.
    </FileSurfaceNotice>
  ) : null;

  if (isMarkdownPreviewFile(relativePath) && !props.markdownRaw) {
    return (
      <>
        {truncatedNotice}
        <div data-artifact-scroll className="scrollbar-gutter-both min-h-0 flex-1 overflow-auto">
          <ChatMarkdown
            text={file.data.contents}
            cwd={cwd}
            imageBaseDir={markdownImageBaseDir(relativePath, cwd)}
            threadRef={threadRef}
            workspaceMutationId={props.workspaceMutationId}
            onOpenArtifact={props.onOpenArtifact}
            className="mx-auto max-w-4xl px-6 py-5"
          />
        </div>
      </>
    );
  }

  return (
    <>
      {truncatedNotice}
      <ReadOnlySourcePreview
        name={relativePath}
        text={file.data.contents}
        cacheKey={projectFileCacheKey(cwd, relativePath, file.data.contents)}
        onPostRender={onFilePostRender}
      />
    </>
  );
}

export default function ArtifactFileView(props: {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | null;
  readonly draft: boolean;
  readonly workspaceMutationId: string | null;
  readonly target:
    | { readonly kind: "file"; readonly path: string; readonly line?: number | undefined }
    | { readonly kind: "attachment"; readonly attachment: ChatFileAttachment };
  readonly markdownRaw: boolean;
  readonly onOpenArtifact: ArtifactOpenHandler;
}) {
  const { target } = props;
  if (target.kind === "attachment") {
    return (
      <ArtifactAttachmentView
        environmentId={props.threadRef.environmentId}
        threadRef={props.threadRef}
        attachment={target.attachment}
      />
    );
  }

  if (props.cwd === null) {
    return <FileSurfaceFailure message="The thread workspace is unavailable." />;
  }

  return (
    <ArtifactWorkspaceFileView
      key={target.path}
      threadRef={props.threadRef}
      cwd={props.cwd}
      draft={props.draft}
      workspaceMutationId={props.workspaceMutationId}
      path={target.path}
      line={target.line}
      markdownRaw={props.markdownRaw}
      onOpenArtifact={props.onOpenArtifact}
    />
  );
}
