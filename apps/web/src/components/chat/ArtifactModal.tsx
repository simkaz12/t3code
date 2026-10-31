import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import type { RunId, ScopedThreadRef } from "@t3tools/contracts";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { XIcon } from "lucide-react";
import { Atom } from "effect/reactivity";
import { lazy, Suspense, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProject, useQuietThreadShell, useThreadCheckpointSummaries } from "~/state/entities";
import { formatWorkspaceRelativePath } from "~/filePathDisplay";

import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogPopup, DialogTitle } from "../ui/dialog";
import { Kbd } from "../ui/kbd";
import { FileSurfaceFailure, FileSurfaceLoading } from "../files/fileSurfaceChrome";
import { isMarkdownPreviewFile } from "../files/filePreviewMode";
import { composerFloatingLayerProps } from "./composerEventScope";
import {
  isArtifactModalReservedChord,
  resolveViewerKey,
  type ViewerKeyResult,
} from "./artifactModalKeys";
import {
  findArtifactSummary,
  resolveArtifactMode,
  type ArtifactMode,
  type ArtifactOpenHandler,
  type ArtifactTarget,
} from "./artifactModalMode";

const ArtifactFileView = lazy(() => import("./ArtifactFileView"));
const ArtifactDiffView = lazy(() => import("./ArtifactDiffView"));

const SCROLL_CONTAINER_SELECTOR =
  "[data-artifact-scroll], .file-preview-virtualizer, .diff-render-surface";
const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Shift", "Control", "Alt", "Meta"]);
const FALLBACK_LINE_HEIGHT_PX = 20;

interface ArtifactModalState {
  readonly threadKey: string;
  readonly target: ArtifactTarget;
  readonly view: ArtifactMode;
  readonly markdownRaw: boolean;
}

type ArtifactCodeViewHandle = CodeViewHandle<undefined, undefined>;

const artifactModalAtom = Atom.make<ArtifactModalState | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("chat:artifact-modal"),
);

export function openArtifactModal(threadKey: string, target: ArtifactTarget): void {
  appAtomRegistry.set(artifactModalAtom, { threadKey, target, view: "diff", markdownRaw: false });
}

const artifactOpeners = new Map<string, Map<string, ArtifactOpenHandler>>();

export function artifactOpener(
  threadKey: string,
  runId?: RunId | null | undefined,
): ArtifactOpenHandler {
  let byRun = artifactOpeners.get(threadKey);
  if (!byRun) {
    byRun = new Map();
    artifactOpeners.set(threadKey, byRun);
  }

  const runKey = runId ?? "";
  let handler = byRun.get(runKey);
  if (!handler) {
    handler = ({ path, line }) =>
      openArtifactModal(threadKey, { kind: "file", path, line, runId: runId ?? undefined });
    byRun.set(runKey, handler);
  }
  return handler;
}

function closeArtifactModal(): void {
  appAtomRegistry.set(artifactModalAtom, null);
}

function closeArtifactModalFor(threadKey: string): void {
  artifactOpeners.delete(threadKey);
  if (appAtomRegistry.get(artifactModalAtom)?.threadKey === threadKey) {
    closeArtifactModal();
  }
}

function updateArtifactModal(patch: Partial<Pick<ArtifactModalState, "view" | "markdownRaw">>) {
  const current = appAtomRegistry.get(artifactModalAtom);
  if (current) appAtomRegistry.set(artifactModalAtom, { ...current, ...patch });
}

function artifactModalKey(state: ArtifactModalState): string {
  const { target } = state;
  return target.kind === "attachment"
    ? `${state.threadKey}:attachment:${target.attachment.id}`
    : `${state.threadKey}:file:${target.path}:${target.line ?? ""}:${target.runId ?? ""}`;
}

function artifactTitle(target: ArtifactTarget, cwd: string | null): string {
  return target.kind === "attachment"
    ? target.attachment.name
    : formatWorkspaceRelativePath(target.path, cwd ?? undefined);
}

function isTypingKeyOrigin(origin: EventTarget | undefined): boolean {
  if (!(origin instanceof Element)) return false;
  if (origin.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) {
    return true;
  }
  return origin.closest("[data-diffs-search]") !== null;
}

function findScrollContainer(popup: HTMLElement): HTMLElement | null {
  const marked = popup.querySelector<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
  if (marked) return marked;

  for (const element of popup.querySelectorAll<HTMLElement>("*")) {
    if (element.scrollHeight <= element.clientHeight + 1) continue;

    const overflowY = getComputedStyle(element).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return element;
  }
  return null;
}

function scrollViewer(container: HTMLElement, hit: ViewerKeyResult): void {
  const direction = hit.dir ?? 1;
  const lineHeight =
    Number.parseFloat(getComputedStyle(container).lineHeight) || FALLBACK_LINE_HEIGHT_PX;

  switch (hit.action) {
    case "scrollLine":
      container.scrollBy({ top: direction * lineHeight, behavior: "instant" });
      return;
    case "scrollHalfPage":
      container.scrollBy({ top: (direction * container.clientHeight) / 2, behavior: "instant" });
      return;
    case "scrollTop":
      container.scrollTo({ top: 0, behavior: "instant" });
      return;
    case "scrollBottom":
      container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
      return;
    default:
      return;
  }
}

interface ArtifactWorkspace {
  readonly root: string | null;
  readonly draft: boolean;
  readonly mutationId: string | null;
}

function ArtifactBody(props: {
  readonly state: ArtifactModalState;
  readonly threadRef: ScopedThreadRef | null;
  readonly cwd: string | null;
  readonly draft: boolean;
  readonly workspaceMutationId: string | null;
  readonly view: ArtifactMode;
  readonly codeViewRef: RefObject<ArtifactCodeViewHandle | null>;
  readonly summaries: ReadonlyArray<ThreadCheckpointSummary>;
}) {
  const { state, threadRef, cwd, view } = props;
  const { target } = state;
  if (threadRef === null) {
    return <FileSurfaceFailure message="The thread for this artifact is unavailable." />;
  }

  const summary = view === "diff" ? findArtifactSummary(target, props.summaries) : undefined;
  if (target.kind === "file" && summary) {
    return (
      <ArtifactDiffView
        threadRef={threadRef}
        summary={summary}
        path={target.path}
        codeViewRef={props.codeViewRef}
      />
    );
  }

  return (
    <ArtifactFileView
      threadRef={threadRef}
      cwd={cwd}
      draft={props.draft}
      workspaceMutationId={props.workspaceMutationId}
      target={target}
      markdownRaw={state.markdownRaw}
      onOpenArtifact={(next) => openArtifactModal(state.threadKey, { kind: "file", ...next })}
    />
  );
}

function ArtifactModal(props: {
  readonly state: ArtifactModalState;
  readonly workspace: ArtifactWorkspace;
}) {
  const { state, workspace } = props;
  const { target, markdownRaw } = state;
  const threadRef = parseScopedThreadKey(state.threadKey);
  const shell = useQuietThreadShell(threadRef);
  const project = useProject(
    shell ? { environmentId: shell.environmentId, projectId: shell.projectId } : null,
  );
  const summaries = useThreadCheckpointSummaries(threadRef);
  const cwd = shell?.worktreePath ?? project?.workspaceRoot ?? workspace.root;
  const mode = resolveArtifactMode(target, summaries);
  const view = mode === "diff" ? state.view : "file";
  const isMarkdown =
    target.kind === "file" && view === "file" && isMarkdownPreviewFile(target.path);

  const popupRef = useRef<HTMLDivElement>(null);
  const codeViewRef = useRef<ArtifactCodeViewHandle | null>(null);
  const keyHistoryRef = useRef<{ lastKey: string | null; lastKeyAt: number }>({
    lastKey: null,
    lastKeyAt: 0,
  });

  const openerRef = useRef<Element | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- remembers the focused DOM element on open and restores focus to it on unmount
  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  const title = artifactTitle(target, cwd);
  const toggleFullFile = () => updateArtifactModal({ view: view === "diff" ? "file" : "diff" });
  const toggleRaw = () => updateArtifactModal({ markdownRaw: !markdownRaw });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const native = event.nativeEvent;
    if (event.defaultPrevented || native.isComposing || MODIFIER_KEYS.has(event.key)) return;
    if (isTypingKeyOrigin(native.composedPath()[0])) return;

    if (isArtifactModalReservedChord(event, navigator.platform)) event.stopPropagation();

    const now = performance.now();
    const hit = resolveViewerKey(event, {
      ...keyHistoryRef.current,
      now,
      isMarkdown,
      diffAvailable: mode === "diff",
      hasCodeView: view === "diff",
    });
    if (!hit) {
      keyHistoryRef.current = { lastKey: event.key, lastKeyAt: now };
      return;
    }

    keyHistoryRef.current = hit.nextState;
    event.preventDefault();
    event.stopPropagation();

    if (hit.action === "toggleRaw") return toggleRaw();
    if (hit.action === "toggleFullFile") return toggleFullFile();
    if (hit.action === "openFind") return codeViewRef.current?.getInstance()?.openSearch();

    const popup = popupRef.current;
    const container = popup ? findScrollContainer(popup) : null;
    if (container) scrollViewer(container, hit);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeArtifactModal();
      }}
    >
      <DialogPopup
        {...composerFloatingLayerProps}
        ref={popupRef}
        variant="viewer"
        showCloseButton={false}
        bottomStickOnMobile={false}
        data-artifact-modal=""
        initialFocus={popupRef}
        onKeyDown={onKeyDown}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 pr-2 pl-4">
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <span aria-hidden className="min-w-0 flex-1 truncate font-mono text-sm">
            {title}
          </span>
          {isMarkdown ? (
            <Button
              type="button"
              size="compact"
              variant="outline"
              aria-pressed={markdownRaw}
              onClick={toggleRaw}
            >
              {markdownRaw ? "Rendered" : "Raw"}
              <Kbd>r</Kbd>
            </Button>
          ) : null}
          {mode === "diff" ? (
            <Button
              type="button"
              size="compact"
              variant="outline"
              aria-pressed={view === "file"}
              onClick={toggleFullFile}
            >
              {view === "diff" ? "Full file" : "Diff"}
              <Kbd>f</Kbd>
            </Button>
          ) : null}
          <DialogClose render={<Button size="icon-sm" variant="ghost" aria-label="Close" />}>
            <XIcon />
          </DialogClose>
        </div>
        <div className="flex min-h-0 flex-1 select-text flex-col overflow-hidden">
          <Suspense fallback={<FileSurfaceLoading />}>
            <ArtifactBody
              state={state}
              threadRef={threadRef}
              cwd={cwd}
              draft={workspace.draft}
              workspaceMutationId={workspace.mutationId}
              view={view}
              codeViewRef={codeViewRef}
              summaries={summaries}
            />
          </Suspense>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

export function ArtifactModalHost(props: {
  readonly threadKey: string;
  readonly workspaceRoot: string | null;
  readonly draft: boolean;
  readonly workspaceMutationId: string | null;
}) {
  const { threadKey } = props;
  const state = useAtomValue(artifactModalAtom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closes this thread's artifact modal in the external atom when the host unmounts or the thread changes
  useEffect(() => () => closeArtifactModalFor(threadKey), [threadKey]);

  if (state === null || state.threadKey !== threadKey) return null;
  return (
    <ArtifactModal
      key={artifactModalKey(state)}
      state={state}
      workspace={{
        root: props.workspaceRoot,
        draft: props.draft,
        mutationId: props.workspaceMutationId,
      }}
    />
  );
}
