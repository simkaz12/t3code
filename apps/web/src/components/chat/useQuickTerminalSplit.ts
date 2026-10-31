import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useLayoutEffect, useState } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import {
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "../../rightPanelStore";
import type { useThreadTerminalActions } from "../terminal/useThreadTerminalActions";
import { useSidebar } from "../ui/sidebar";

type TerminalActions = ReturnType<typeof useThreadTerminalActions>;

const terminalIds = new Map<string, string>();
const pendingLaunches = new Map<string, Promise<unknown>>();

type QuickTerminalLayout = {
  readonly threadRef: ScopedThreadRef;
  readonly sidebarOpen: boolean;
  readonly panelOpen: boolean;
  readonly surfaceId: string | null;
  readonly maximized: boolean;
  readonly terminalId: string;
  readonly setSidebarOpen: (open: boolean) => void;
};

type QuickTerminalOpenInput = {
  readonly threadRef: ScopedThreadRef | null;
  readonly enabled: boolean;
  readonly sidebarOpen: boolean;
  readonly setSidebarOpen: (open: boolean) => void;
  readonly launchTerminal: TerminalActions["launchTerminal"];
  readonly focusTerminal: () => void;
};

type QuickTerminalToggleInput = QuickTerminalOpenInput & {
  readonly focusComposer: () => void;
};

type QuickTerminalOpenResult = {
  readonly terminalId: string;
  readonly result: Promise<unknown> | null;
};

export function createQuickTerminalSplit(onActiveChange: (threadKey: string | null) => void) {
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
    onActiveChange(null);
    return true;
  };

  const ensureOpen = (input: QuickTerminalOpenInput): QuickTerminalOpenResult | null => {
    const { threadRef } = input;
    if (layout) {
      input.focusTerminal();
      return {
        terminalId: layout.terminalId,
        result: pendingLaunches.get(layout.terminalId) ?? null,
      };
    }
    if (!input.enabled || !threadRef) return null;
    const threadKey = scopedThreadKey(threadRef);
    const store = useRightPanelStore.getState();
    const panel = selectThreadRightPanelState(store.byThreadKey, threadRef);
    let terminalId = terminalIds.get(threadKey);
    let result: Promise<unknown> | null = null;
    const existing = panel.surfaces.find(
      (surface) => surface.kind === "terminal" && surface.terminalIds.includes(terminalId ?? ""),
    );
    if (!existing) {
      const launched = input.launchTerminal({
        place: (id) => useRightPanelStore.getState().openTerminal(threadRef, id),
      });
      if (!launched) return null;
      terminalId = launched.terminalId;
      terminalIds.set(threadKey, terminalId);
      const launchedId = terminalId;
      const clearPending = () => {
        if (pendingLaunches.get(launchedId) === launched.result) pendingLaunches.delete(launchedId);
      };
      pendingLaunches.set(launchedId, launched.result);
      void launched.result.then(clearPending, clearPending);
      result = launched.result;
    } else if (terminalId !== undefined) {
      store.activateTerminal(threadRef, existing.id, terminalId);
      store.show(threadRef);
      result = pendingLaunches.get(terminalId) ?? null;
    }
    if (terminalId === undefined) return null;
    layout = {
      threadRef,
      sidebarOpen: input.sidebarOpen,
      panelOpen: panel.isOpen,
      surfaceId: panel.activeSurfaceId,
      maximized: panel.maximized === true,
      terminalId,
      setSidebarOpen: input.setSidebarOpen,
    };
    store.setMaximized(threadRef, false);
    input.setSidebarOpen(false);
    onActiveChange(threadKey);
    input.focusTerminal();
    return { terminalId, result };
  };

  return {
    restore,
    ensureOpen,
    toggle(input: QuickTerminalToggleInput) {
      if (layout) {
        restore();
        input.focusComposer();
        return true;
      }
      return ensureOpen(input) !== null;
    },
    reconcile(
      threadRef: ScopedThreadRef | null,
      enabled: boolean,
      currentPanel?: ThreadRightPanelState,
    ) {
      if (!layout) return;
      const sameThread =
        threadRef !== null && scopedThreadKey(threadRef) === scopedThreadKey(layout.threadRef);
      const panel =
        sameThread && currentPanel
          ? currentPanel
          : selectThreadRightPanelState(
              useRightPanelStore.getState().byThreadKey,
              layout.threadRef,
            );
      const selected = panel.surfaces.find((surface) => surface.id === panel.activeSurfaceId);
      if (
        !enabled ||
        !sameThread ||
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
  readonly panelState: ThreadRightPanelState;
  readonly terminalActions: TerminalActions;
  readonly focusTerminal: () => void;
  readonly focusComposer: () => void;
}) {
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const threadKey = input.threadRef ? scopedThreadKey(input.threadRef) : null;
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null);
  const [controller] = useState(() => createQuickTerminalSplit(setActiveThreadKey));
  const widthFraction = activeThreadKey !== null && activeThreadKey === threadKey ? 0.5 : undefined;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores the right panel and sidebar through the imperative split controller when the thread or panel no longer matches the open split
  useLayoutEffect(() => {
    controller.reconcile(input.threadRef, input.enabled, input.panelState);
  }, [controller, input.threadRef, input.enabled, input.panelState]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores the right panel and sidebar through the imperative split controller on unmount
  useLayoutEffect(
    () => () => {
      controller.restore();
    },
    [controller],
  );

  const openInput = () => ({
    threadRef: input.threadRef,
    enabled: input.enabled,
    sidebarOpen,
    setSidebarOpen,
    launchTerminal: input.terminalActions.launchTerminal,
    focusTerminal: input.focusTerminal,
  });
  const toggle = useStableCallback(() =>
    controller.toggle({ ...openInput(), focusComposer: input.focusComposer }),
  );
  const ensureOpen = useStableCallback(() => controller.ensureOpen(openInput()));

  return { widthFraction, toggle, ensureOpen };
}
