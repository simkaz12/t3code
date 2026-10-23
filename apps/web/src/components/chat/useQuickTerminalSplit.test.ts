import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import { createQuickTerminalSplit } from "./useQuickTerminalSplit";

type ToggleInput = Parameters<ReturnType<typeof createQuickTerminalSplit>["toggle"]>[0];

const threadRef = scopeThreadRef(EnvironmentId.make("quick-env"), ThreadId.make("quick-thread"));
const otherThreadRef = scopeThreadRef(
  EnvironmentId.make("quick-env"),
  ThreadId.make("other-thread"),
);
const remoteThreadRef = scopeThreadRef(EnvironmentId.make("remote-env"), threadRef.threadId);

function panel(ref = threadRef) {
  return selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);
}

function setup(sidebarOpen = true, controller = createQuickTerminalSplit(vi.fn())) {
  const setSidebarOpen = vi.fn((open: boolean) => {
    sidebarOpen = open;
  });
  const setWidth = vi.fn();
  const launchTerminal = vi.fn((input: Parameters<ToggleInput["launchTerminal"]>[0]) => {
    const terminalId = `quick-${launchTerminal.mock.calls.length}`;
    input.place(terminalId);
    return { terminalId, result: new Promise<never>(() => undefined) };
  });
  const focusTerminal = vi.fn();
  const focusComposer = vi.fn();
  const input = (overrides: Partial<ToggleInput> = {}): ToggleInput => ({
    threadRef,
    enabled: true,
    sidebarOpen,
    width: 620,
    setSidebarOpen,
    setWidth,
    launchTerminal,
    focusTerminal,
    focusComposer,
    ...overrides,
  });
  return {
    controller,
    input,
    setSidebarOpen,
    setWidth,
    launchTerminal,
    focusTerminal,
    focusComposer,
  };
}

beforeEach(() => {
  useRightPanelStore.setState({
    byThreadKey: {},
    userActionRevisionByThreadKey: {},
    closeRevisionByThreadKey: {},
  });
});

describe("quick terminal split", () => {
  it.each([true, false])(
    "restores an initially %s sidebar and the previous panel",
    (sidebarOpen) => {
      const store = useRightPanelStore.getState();
      store.openFile(threadRef, "src/app.ts");
      store.setMaximized(threadRef, true);
      const activeChange = vi.fn();
      const test = setup(sidebarOpen, createQuickTerminalSplit(activeChange));

      expect(test.controller.toggle(test.input())).toBe(true);

      expect(test.setSidebarOpen).toHaveBeenLastCalledWith(false);
      expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: "terminal:quick-1" });
      expect(panel().maximized).toBeUndefined();
      expect(activeChange).toHaveBeenLastCalledWith(scopedThreadKey(threadRef));
      expect(test.focusTerminal).toHaveBeenCalledOnce();

      expect(test.controller.toggle(test.input())).toBe(true);

      expect(test.setSidebarOpen).toHaveBeenLastCalledWith(sidebarOpen);
      expect(test.setWidth).toHaveBeenLastCalledWith(620);
      expect(panel()).toMatchObject({
        isOpen: true,
        activeSurfaceId: "file:src/app.ts",
        maximized: true,
      });
      expect(panel().surfaces).toHaveLength(2);
      expect(activeChange).toHaveBeenLastCalledWith(null);
      expect(test.focusComposer).toHaveBeenCalledOnce();
    },
  );

  it("restores a hidden panel without removing its terminal, then reuses the shell", () => {
    const store = useRightPanelStore.getState();
    store.open(threadRef, "files");
    store.close(threadRef);
    const test = setup();

    test.controller.toggle(test.input());
    test.controller.toggle(test.input());
    expect(panel()).toMatchObject({ isOpen: false, activeSurfaceId: "files" });

    test.controller.toggle(test.input());
    expect(test.launchTerminal).toHaveBeenCalledOnce();
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: "terminal:quick-1" });
    expect(panel().surfaces).toHaveLength(2);
    expect(test.focusTerminal).toHaveBeenCalledTimes(2);
  });

  it("retains the shell when leaving and remounting the chat view", () => {
    const test = setup();
    test.controller.toggle(test.input());
    test.controller.restore();

    const remounted = createQuickTerminalSplit(vi.fn());
    remounted.toggle(test.input());

    expect(test.launchTerminal).toHaveBeenCalledOnce();
    expect(panel().surfaces).toHaveLength(1);
    expect(panel().activeSurfaceId).toBe("terminal:quick-1");
  });

  it("restores the old thread layout and keeps distinct terminals per environment and thread", () => {
    const store = useRightPanelStore.getState();
    store.open(threadRef, "files");
    store.open(otherThreadRef, "diff");
    const test = setup();

    test.controller.toggle(test.input());
    test.controller.reconcile(otherThreadRef, true);
    expect(panel()).toMatchObject({ isOpen: true, activeSurfaceId: "files" });
    expect(test.setSidebarOpen).toHaveBeenLastCalledWith(true);
    expect(panel(otherThreadRef).activeSurfaceId).toBe("diff");

    test.controller.toggle(test.input({ threadRef: otherThreadRef }));
    test.controller.reconcile(remoteThreadRef, true);
    test.controller.toggle(test.input({ threadRef: remoteThreadRef }));
    test.controller.reconcile(threadRef, true);
    test.controller.toggle(test.input());

    expect(test.launchTerminal).toHaveBeenCalledTimes(3);
    expect(panel().activeSurfaceId).toBe("terminal:quick-1");
    expect(panel(otherThreadRef).activeSurfaceId).toBe("diff");
    expect(panel(remoteThreadRef).surfaces).toMatchObject([{ terminalIds: ["quick-3"] }]);
  });

  it("recreates a manually deleted quick terminal", () => {
    const test = setup();
    test.controller.toggle(test.input());
    useRightPanelStore.getState().closeSurface(threadRef, "terminal:quick-1");
    test.controller.reconcile(threadRef, true);
    expect(test.setSidebarOpen).toHaveBeenLastCalledWith(true);

    test.controller.toggle(test.input());

    expect(test.launchTerminal).toHaveBeenCalledTimes(2);
    expect(panel().surfaces).toMatchObject([{ terminalIds: ["quick-2"] }]);
  });

  it.each(["hidden", "different surface", "disabled", "no thread"])(
    "restores temporary layout when %s invalidates the split",
    (reason) => {
      const store = useRightPanelStore.getState();
      store.open(threadRef, "files");
      const test = setup();
      test.controller.toggle(test.input());
      if (reason === "hidden") store.close(threadRef);
      if (reason === "different surface") store.open(threadRef, "diff");

      test.controller.reconcile(reason === "no thread" ? null : threadRef, reason !== "disabled");

      expect(test.setSidebarOpen).toHaveBeenLastCalledWith(true);
      expect(test.setWidth).toHaveBeenLastCalledWith(620);
      expect(panel().activeSurfaceId).toBe("files");
      expect(panel().surfaces.some((surface) => surface.id === "terminal:quick-1")).toBe(true);
      expect(test.controller.restore()).toBe(false);
    },
  );

  it("safely ignores unsupported views and failed launches", () => {
    const test = setup();
    expect(test.controller.toggle(test.input({ enabled: false }))).toBe(false);
    expect(test.controller.toggle(test.input({ threadRef: null }))).toBe(false);
    expect(test.launchTerminal).not.toHaveBeenCalled();
    expect(test.controller.toggle(test.input({ launchTerminal: () => null }))).toBe(false);
    expect(test.setSidebarOpen).not.toHaveBeenCalled();
    expect(test.focusTerminal).not.toHaveBeenCalled();
    expect(panel().surfaces).toHaveLength(0);
  });

  it("ensureOpen reuses the open terminal and launches once", () => {
    const test = setup();

    const first = test.controller.ensureOpen(test.input());
    const second = test.controller.ensureOpen(test.input());

    expect(first).toMatchObject({ terminalId: "quick-1" });
    expect(first?.result).toBeInstanceOf(Promise);
    expect(second).toEqual({ terminalId: "quick-1", result: first?.result });
    expect(test.launchTerminal).toHaveBeenCalledOnce();
    expect(test.focusTerminal).toHaveBeenCalledTimes(2);
  });

  it("ensureOpen returns the same pending launch until it settles", async () => {
    let resolveLaunch: (value: unknown) => void = () => undefined;
    const launch = new Promise<unknown>((resolve) => {
      resolveLaunch = resolve;
    });
    const test = setup();
    const launchTerminal = vi.fn((input: Parameters<ToggleInput["launchTerminal"]>[0]) => {
      input.place("quick-1");
      return { terminalId: "quick-1", result: launch as never };
    });

    const first = test.controller.ensureOpen(test.input({ launchTerminal }));
    const second = test.controller.ensureOpen(test.input({ launchTerminal }));

    expect(first?.result).toBe(launch);
    expect(second?.result).toBe(launch);

    resolveLaunch(undefined);
    await launch;
    await Promise.resolve();

    expect(test.controller.ensureOpen(test.input({ launchTerminal }))).toEqual({
      terminalId: "quick-1",
      result: null,
    });
    expect(launchTerminal).toHaveBeenCalledOnce();
  });

  it("clears the pending launch when it rejects", async () => {
    const launch = Promise.reject(new Error("launch failed"));
    const test = setup();
    const launchTerminal = vi.fn((input: Parameters<ToggleInput["launchTerminal"]>[0]) => {
      input.place("quick-1");
      return { terminalId: "quick-1", result: launch as never };
    });

    test.controller.ensureOpen(test.input({ launchTerminal }));
    await launch.catch(() => undefined);
    await Promise.resolve();

    expect(test.controller.ensureOpen(test.input({ launchTerminal }))?.result).toBeNull();
  });

  it("toggle after ensureOpen restores the layout", () => {
    const test = setup();
    test.controller.ensureOpen(test.input());

    expect(test.controller.toggle(test.input())).toBe(true);

    expect(test.setSidebarOpen).toHaveBeenLastCalledWith(true);
    expect(test.focusComposer).toHaveBeenCalledOnce();
    expect(test.controller.restore()).toBe(false);
  });

  it("ensureOpen returns null when disabled or the launch fails", () => {
    const test = setup();

    expect(test.controller.ensureOpen(test.input({ enabled: false }))).toBeNull();
    expect(test.controller.ensureOpen(test.input({ launchTerminal: () => null }))).toBeNull();
    expect(test.focusTerminal).not.toHaveBeenCalled();
  });
});
