"use client";

import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { previewPdfAssetUrl } from "@t3tools/shared/preview";
import { PictureInPicture2, XIcon } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { BrowserSurfaceSlot } from "~/browser/BrowserSurfaceSlot";
import {
  resolveSavedFittedSourceContent,
  useBrowserSurfaceStore,
} from "~/browser/browserSurfaceStore";
import { useActiveBrowserRecordingTabIds } from "~/browser/browserRecording";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { useRendersServerTabNatively } from "~/browser/previewRuntime";
import { type ServerBrowserHandle, ServerBrowserSurface } from "~/browser/ServerBrowserSurface";
import {
  closeServerPictureInPicture,
  openServerPictureInPicture,
  serverPictureInPictureKey,
  supportsServerPictureInPicture,
  useServerPictureInPictureKey,
} from "~/browser/serverPictureInPicture";
import { useBrowserLayoutZoomFactor } from "~/browser/useBrowserLayoutZoomFactor";
import { Button } from "~/components/ui/button";
import { Dialog, DialogClose, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { observeResize } from "~/lib/observeResize";
import { useThreadPreviewState } from "~/previewStateStore";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";

import { composerFloatingLayerProps } from "../chat/composerEventScope";
import { AgentBrowserCursor } from "./AgentBrowserCursor";
import type { BrowserController } from "./agentBrowserCursorLogic";
import { previewBridge } from "./previewBridge";
import { selectThreadPreviewExpandedTabId, usePreviewExpandedStore } from "./previewExpandedStore";
import { showPreviewPopup } from "./showPreviewPopup";

const EXPANDED_WEBVIEW_Z_INDEX = 60;
const EXPANDED_CURSOR_Z_INDEX = EXPANDED_WEBVIEW_Z_INDEX + 1;
const MINI_PLAYER_PRIMARY_SELECTOR = "[data-preview-mini-player-primary]";

export function PreviewExpandedDialogHost(props: { readonly threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const expandedTabId = usePreviewExpandedStore((state) =>
    selectThreadPreviewExpandedTabId(state.byThreadKey, threadRef),
  );
  const [retainedTabId, setRetainedTabId] = useState(expandedTabId);
  if (expandedTabId !== null && expandedTabId !== retainedTabId) setRetainedTabId(expandedTabId);
  if (retainedTabId === null) return null;
  return (
    <PreviewExpandedDialog
      key={`${scopedThreadKey(threadRef)}:${retainedTabId}`}
      threadRef={threadRef}
      tabId={retainedTabId}
      open={expandedTabId === retainedTabId}
      onExited={() => setRetainedTabId(null)}
    />
  );
}

function PreviewExpandedDialog(props: {
  readonly threadRef: ScopedThreadRef;
  readonly tabId: string;
  readonly open: boolean;
  readonly onExited: () => void;
}) {
  const { threadRef, tabId, open, onExited } = props;
  const httpBaseUrl = useEnvironmentHttpBaseUrl(threadRef.environmentId);
  const previewState = useThreadPreviewState(threadRef);
  const snapshot = previewState.sessions[tabId] ?? null;
  const runtimeTabId = previewRuntimeTabId(threadRef, previewState.serverEpoch, tabId);
  const desktopOverlay = previewState.desktopByTabId[tabId] ?? null;
  const layoutZoomFactor = useBrowserLayoutZoomFactor(desktopOverlay?.zoomFactor ?? 1);
  const recordingTabIds = useActiveBrowserRecordingTabIds();
  const nativeServerTab = useRendersServerTabNatively(threadRef.environmentId, snapshot);
  const serverTab = snapshot?.runtime === "server" && !nativeServerTab;
  const serverPictureInPicture =
    useServerPictureInPictureKey() === serverPictureInPictureKey(threadRef.threadId, tabId);
  const serverSurfaceRef = useRef<ServerBrowserHandle | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [floatedSource] = useState(() => ({
    runtimeTabId,
    content: resolveSavedFittedSourceContent(useBrowserSurfaceStore.getState(), runtimeTabId),
  }));

  useLayoutEffect(() => {
    const { content, runtimeTabId: seededTabId } = floatedSource;
    if (!open || content === null) return;
    return () => useBrowserSurfaceStore.getState().seedFittedSourceContent(seededTabId, content);
  }, [floatedSource, open]);

  useEffect(
    () => () => {
      const { byThreadKey } = usePreviewExpandedStore.getState();
      if (selectThreadPreviewExpandedTabId(byThreadKey, threadRef) !== null) return;
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        document.querySelector<HTMLElement>(MINI_PLAYER_PRIMARY_SELECTOR)?.focus({
          preventScroll: true,
        });
      });
    },
    [threadRef],
  );

  const shrink = () => usePreviewExpandedStore.getState().collapse(threadRef);

  const toggleNativePictureInPicture = async () => {
    try {
      if (serverTab) {
        if (serverPictureInPicture) closeServerPictureInPicture();
        else
          await openServerPictureInPicture({
            ...threadRef,
            tabId,
            seed: serverSurfaceRef.current?.canvas() ?? null,
          });
      } else if (previewBridge) {
        const operation = desktopOverlay?.pictureInPicture
          ? previewBridge.pictureInPicture.close
          : previewBridge.pictureInPicture.open;
        await operation(runtimeTabId);
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: serverTab ? "Unable to pop out preview" : "Unable to update popped-out preview",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  };

  if (!snapshot) return null;

  const url = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
  const title = snapshot.navStatus._tag === "Idle" ? "" : snapshot.navStatus.title;
  const pdfUrl =
    snapshot.navStatus._tag === "Success"
      ? previewPdfAssetUrl(snapshot.navStatus.url, httpBaseUrl)
      : null;
  const poppedOut = serverTab ? serverPictureInPicture : Boolean(desktopOverlay?.pictureInPicture);
  const canPopOut = serverTab
    ? poppedOut || (pdfUrl === null && supportsServerPictureInPicture())
    : true;
  const controller: BrowserController = desktopOverlay?.controller ?? "none";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) shrink();
      }}
      onOpenChangeComplete={(settledOpen) => {
        if (settledOpen) setLayoutVersion((version) => version + 1);
        else onExited();
      }}
    >
      <DialogPopup
        {...composerFloatingLayerProps}
        ref={popupRef}
        variant="viewer"
        showCloseButton={false}
        bottomStickOnMobile={false}
        data-browser-modal=""
        initialFocus={popupRef}
        finalFocus={false}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 pr-2 pl-4">
          <DialogTitle className="sr-only">{title || url || "Browser preview"}</DialogTitle>
          <span aria-hidden className="min-w-0 flex-1 truncate text-sm">
            {title}
            {url ? (
              <span className="ml-2 font-mono text-muted-foreground text-xs">{url}</span>
            ) : null}
          </span>
          {canPopOut ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant={poppedOut ? "secondary" : "ghost"}
                    size="icon-sm"
                    aria-label={
                      poppedOut ? "Close popped-out preview" : "Pop preview into separate window"
                    }
                    disabled={!serverTab && !desktopOverlay?.hasWebContents}
                    onClick={toggleNativePictureInPicture}
                  />
                }
              >
                <PictureInPicture2 />
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                {poppedOut ? "Close separate window" : "Pop into separate window"}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          <DialogClose
            render={
              <Button size="icon-sm" variant="ghost" aria-label="Shrink to floating preview" />
            }
          >
            <XIcon />
          </DialogClose>
        </div>
        <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-hidden bg-muted">
          {!open ? null : serverTab ? (
            <ServerBrowserSurface
              ref={serverSurfaceRef}
              environmentId={threadRef.environmentId}
              threadId={threadRef.threadId}
              tabId={tabId}
              pdfUrl={pdfUrl}
              visible
              followSize={false}
              controlPosition="bottom"
              onPopup={(popupTabId) => showPreviewPopup(threadRef, popupTabId, "floating")}
              className="absolute inset-0 size-full"
            />
          ) : (
            <>
              <BrowserSurfaceSlot
                tabId={runtimeTabId}
                visible={Boolean(desktopOverlay?.hasWebContents)}
                zIndex={EXPANDED_WEBVIEW_Z_INDEX}
                layoutVersion={layoutVersion}
                className="absolute inset-0"
              />
              {!desktopOverlay?.hasWebContents ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                  Reconnecting preview…
                </div>
              ) : null}
              {desktopOverlay && !recordingTabIds.has(runtimeTabId) ? (
                <SlotAgentCursorLayer
                  anchorRef={bodyRef}
                  layoutVersion={layoutVersion}
                  tabId={runtimeTabId}
                  zoomFactor={layoutZoomFactor}
                  controller={controller}
                />
              ) : null}
            </>
          )}
        </div>
      </DialogPopup>
    </Dialog>
  );
}

interface AnchorRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function SlotAgentCursorLayer(props: {
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly layoutVersion: number;
  readonly tabId: string;
  readonly zoomFactor: number;
  readonly controller: BrowserController;
}) {
  const { anchorRef, layoutVersion, tabId, zoomFactor, controller } = props;
  const [rect, setRect] = useState<AnchorRect | null>(null);

  useLayoutEffect(() => {
    const element = anchorRef.current;
    if (!element) return;
    const update = () => {
      const next = element.getBoundingClientRect();
      setRect((current) =>
        current &&
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : { left: next.left, top: next.top, width: next.width, height: next.height },
      );
    };
    update();
    const stopObserving = observeResize(element, update);
    window.addEventListener("resize", update);
    return () => {
      stopObserving();
      window.removeEventListener("resize", update);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A layoutVersion bump re-measures the anchor once the open transition settles.
  }, [anchorRef, layoutVersion]);

  if (!rect) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed overflow-hidden"
      style={{ ...rect, zIndex: EXPANDED_CURSOR_Z_INDEX }}
    >
      <AgentBrowserCursor tabId={tabId} zoomFactor={zoomFactor} controller={controller} />
    </div>,
    document.body,
  );
}
