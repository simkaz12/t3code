import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useLayoutEffect, useState } from "react";

import { usePreviewPanelInlineSize } from "../../hooks/usePreviewPanelInlineSize";
import { useStableCallback } from "../../hooks/useStableCallback";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import type { useThreadTerminalActions } from "../terminal/useThreadTerminalActions";
import { useSidebar } from "../ui/sidebar";

type TerminalActions = ReturnType<typeof useThreadTerminalActions>;

type QuickTerminalLayout = {
  readonly threadRef: ScopedThreadRef;
  readonly sidebarOpen: boolean;
  readonly panelOpen: boolean;
  readonly surfaceId: string | null;
  readonly maximized: boolean;
  readonly width: number;
  readonly terminalId: string;
  readonly setSidebarOpen: (open: boolean) => void;
  readonly setWidth: (width: number) => void;
};

export function createQuickTerminalSplit(onActiveChange: (threadKey: string | null) => void) {
  const terminalIds = new Map<string, string>();
  let layout: QuickTerminalLayout | null = null;

  const restore = () => {
    if (!layout) return false;
    const previous = layout;
    layout = null;
    const store = useRightPanelStore.getState();
    if (previous.surfaceId !== null) {
      store.activateSurface(previous.threadRef, previous.surfaceId);
    }
    store.setMaximized(previous.threadRef, previous.maximized);
    if (previous.panelOpen) store.show(previous.threadRef);
    else store.close(previous.threadRef);
    previous.setSidebarOpen(previous.sidebarOpen);
    previous.setWidth(previous.width);
    onActiveChange(null);
    return true;
  };

  return {
    restore,
    toggle(input: {
      readonly threadRef: ScopedThreadRef | null;
      readonly enabled: boolean;
      readonly sidebarOpen: boolean;
      readonly width: number;
      readonly setSidebarOpen: (open: boolean) => void;
      readonly setWidth: (width: number) => void;
      readonly launchTerminal: TerminalActions["launchTerminal"];
      readonly focusTerminal: () => void;
      readonly focusComposer: () => void;
    }) {
      const { threadRef } = input;
      if (layout) {
        restore();
        input.focusComposer();
        return true;
      }
      if (!input.enabled || !threadRef) return false;
      const threadKey = scopedThreadKey(threadRef);
      const store = useRightPanelStore.getState();
      const panel = selectThreadRightPanelState(store.byThreadKey, threadRef);
      let terminalId = terminalIds.get(threadKey);
      const existing = panel.surfaces.find(
        (surface) => surface.kind === "terminal" && surface.terminalIds.includes(terminalId ?? ""),
      );
      if (!existing) {
        const launched = input.launchTerminal({
          place: (id) => useRightPanelStore.getState().openTerminal(threadRef, id),
        });
        if (!launched) return false;
        terminalId = launched.terminalId;
        terminalIds.set(threadKey, terminalId);
        void launched.result;
      } else if (terminalId !== undefined) {
        store.activateTerminal(threadRef, existing.id, terminalId);
        store.show(threadRef);
      }
      if (terminalId === undefined) return false;
      layout = {
        threadRef,
        sidebarOpen: input.sidebarOpen,
        panelOpen: panel.isOpen,
        surfaceId: panel.activeSurfaceId,
        maximized: panel.maximized === true,
        width: input.width,
        terminalId,
        setSidebarOpen: input.setSidebarOpen,
        setWidth: input.setWidth,
      };
      store.setMaximized(threadRef, false);
      input.setSidebarOpen(false);
      onActiveChange(threadKey);
      input.focusTerminal();
      return true;
    },
    reconcile(threadRef: ScopedThreadRef | null, enabled: boolean) {
      if (!layout) return;
      const panel = selectThreadRightPanelState(
        useRightPanelStore.getState().byThreadKey,
        layout.threadRef,
      );
      const selected = panel.surfaces.find((surface) => surface.id === panel.activeSurfaceId);
      if (
        !enabled ||
        !threadRef ||
        scopedThreadKey(threadRef) !== scopedThreadKey(layout.threadRef) ||
        !panel.isOpen ||
        selected?.kind !== "terminal" ||
        !selected.terminalIds.includes(layout.terminalId)
      ) {
        restore();
      }
    },
  };
}

export function useQuickTerminalSplit(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly enabled: boolean;
  readonly container: HTMLElement | null;
  readonly panelState: unknown;
  readonly terminalActions: TerminalActions;
  readonly focusTerminal: () => void;
  readonly focusComposer: () => void;
}) {
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const threadKey = input.threadRef ? scopedThreadKey(input.threadRef) : null;
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null);
  const [controller] = useState(() => createQuickTerminalSplit(setActiveThreadKey));
  const inlineSize = usePreviewPanelInlineSize(undefined, {
    container: input.container,
    widthStorageKey: `t3code:preview-panel-width:${threadKey}`,
    widthFraction: activeThreadKey !== null && activeThreadKey === threadKey ? 0.5 : undefined,
  });

  useLayoutEffect(() => {
    controller.reconcile(input.threadRef, input.enabled);
  }, [controller, input.threadRef, input.enabled, input.panelState]);
  useLayoutEffect(
    () => () => {
      controller.restore();
    },
    [controller],
  );

  const toggle = useStableCallback(() =>
    controller.toggle({
      threadRef: input.threadRef,
      enabled: input.enabled,
      sidebarOpen,
      width: inlineSize.width,
      setSidebarOpen,
      setWidth: inlineSize.setWidth,
      launchTerminal: input.terminalActions.launchTerminal,
      focusTerminal: input.focusTerminal,
      focusComposer: input.focusComposer,
    }),
  );

  return { inlineSize, toggle };
}
