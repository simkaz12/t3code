import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  acquireBrowserSurface,
  acquireBrowserSurfaceActivity,
  resolveSavedFittedSourceContent,
  useBrowserSurfaceStore,
} from "./browserSurfaceStore";

describe("browserSurfaceStore", () => {
  beforeEach(() => {
    useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} });
  });

  it("keeps concurrent background work active until every lease is released", () => {
    const first = acquireBrowserSurfaceActivity("background-browser");
    const second = acquireBrowserSurfaceActivity("background-browser");

    first();
    expect(useBrowserSurfaceStore.getState().activityByTabId["background-browser"]).toBe(1);

    second();
    expect(useBrowserSurfaceStore.getState().activityByTabId["background-browser"]).toBeUndefined();
  });

  it("freezes the source content dimensions for a fitted presentation", () => {
    const tabId = "fitted-browser-surface";
    const sourceOwner = Symbol("source");
    const sourceContent = {
      x: 10,
      y: 20,
      width: 1_280,
      height: 720,
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
    };
    useBrowserSurfaceStore.getState().claim(tabId, sourceOwner, false);
    useBrowserSurfaceStore.getState().presentContent(tabId, sourceContent);

    const fittedLease = acquireBrowserSurface(tabId, true);
    useBrowserSurfaceStore.getState().presentContent(tabId, {
      ...sourceContent,
      width: 360,
      height: 203,
      scale: 0.28125,
    });

    expect(useBrowserSurfaceStore.getState().byTabId[tabId]?.fittedSourceContent).toEqual(
      sourceContent,
    );
    fittedLease.release();
  });

  it("ignores updates and releases from a stale surface lease", () => {
    const tabId = "leased-browser-surface";
    const staleRect = { x: 0, y: 0, width: 500, height: 700 };
    const liveRect = { x: 10, y: 20, width: 900, height: 640 };
    const staleLease = acquireBrowserSurface(tabId);
    staleLease.present(staleRect, true);

    const liveLease = acquireBrowserSurface(tabId);
    liveLease.present(liveRect, true);
    expect(staleLease.present(staleRect, true)).toBe(false);
    staleLease.release();

    expect(useBrowserSurfaceStore.getState().byTabId[tabId]).toMatchObject({
      rect: liveRect,
      visible: true,
    });
  });

  it("returns a fitted lease to the source size it had before a full-size lease took the tab", () => {
    const tabId = "enlarged-browser-surface";
    const floatedContent = {
      x: 0,
      y: 0,
      width: 640,
      height: 400,
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
    };
    const enlargedContent = { ...floatedContent, width: 1_178, height: 670 };
    const store = useBrowserSurfaceStore;
    const floatedLease = acquireBrowserSurface(tabId, true);
    store.getState().presentContent(tabId, floatedContent);
    const floated = store.getState().byTabId[tabId]?.fittedSourceContent ?? null;

    floatedLease.release();
    const enlargedLease = acquireBrowserSurface(tabId);
    store.getState().presentContent(tabId, enlargedContent);
    store.getState().seedFittedSourceContent(tabId, floated ?? floatedContent);
    enlargedLease.release();
    const restored = acquireBrowserSurface(tabId, true);

    expect(store.getState().byTabId[tabId]?.fittedSourceContent).toEqual(floatedContent);
    restored.release();
  });

  it("keeps the mini player fit across a dialog unmount and remount before shrinking", () => {
    const tabId = "thread-switch-browser-surface";
    const floatedContent = {
      x: 0,
      y: 0,
      width: 640,
      height: 400,
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
    };
    const enlargedContent = { ...floatedContent, width: 1_178, height: 670 };
    const store = useBrowserSurfaceStore;
    const miniLease = acquireBrowserSurface(tabId, true);
    store.getState().presentContent(tabId, floatedContent);
    const firstMount = resolveSavedFittedSourceContent(store.getState(), tabId);

    miniLease.release();
    const firstDialogLease = acquireBrowserSurface(tabId);
    store.getState().presentContent(tabId, enlargedContent);
    store.getState().seedFittedSourceContent(tabId, firstMount ?? enlargedContent);
    firstDialogLease.release();
    const secondMount = resolveSavedFittedSourceContent(store.getState(), tabId);

    expect(firstMount).toEqual(floatedContent);
    expect(secondMount).toEqual(floatedContent);

    const secondDialogLease = acquireBrowserSurface(tabId);
    store.getState().seedFittedSourceContent(tabId, secondMount ?? enlargedContent);
    secondDialogLease.release();
    const restored = acquireBrowserSurface(tabId, true);

    expect(store.getState().byTabId[tabId]?.fittedSourceContent).toEqual(floatedContent);
    restored.release();
  });

  it("recomputes the fit from the current content when nothing was seeded", () => {
    const tabId = "unseeded-browser-surface";
    const content = {
      x: 0,
      y: 0,
      width: 1_178,
      height: 670,
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
    };
    const enlargedLease = acquireBrowserSurface(tabId);
    useBrowserSurfaceStore.getState().presentContent(tabId, content);
    enlargedLease.release();

    const fittedLease = acquireBrowserSurface(tabId, true);

    expect(useBrowserSurfaceStore.getState().byTabId[tabId]?.fittedSourceContent).toEqual(content);
    fittedLease.release();
  });

  it("consumes a seeded fit on the next claim", () => {
    const tabId = "consumed-seed-browser-surface";
    const seeded = {
      x: 0,
      y: 0,
      width: 640,
      height: 400,
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
    };
    const current = { ...seeded, width: 1_178, height: 670 };
    const store = useBrowserSurfaceStore;
    const first = acquireBrowserSurface(tabId);
    store.getState().presentContent(tabId, current);
    store.getState().seedFittedSourceContent(tabId, seeded);
    first.release();

    acquireBrowserSurface(tabId, true).release();
    const second = acquireBrowserSurface(tabId, true);

    expect(store.getState().seededFitByTabId[tabId]).toBeUndefined();
    expect(store.getState().byTabId[tabId]?.fittedSourceContent).toEqual(current);
    second.release();
  });

  it("drops a seeded fit when a full-size lease claims the tab", () => {
    const tabId = "seeded-then-claimed-browser-surface";
    const seeded = {
      x: 0,
      y: 0,
      width: 640,
      height: 400,
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
    };
    const current = { ...seeded, width: 1_178, height: 670 };
    const store = useBrowserSurfaceStore;
    store.getState().presentContent(tabId, current);
    store.getState().seedFittedSourceContent(tabId, seeded);

    const panelLease = acquireBrowserSurface(tabId);
    panelLease.release();
    const fittedLease = acquireBrowserSurface(tabId, true);

    expect(store.getState().byTabId[tabId]?.fittedSourceContent).toEqual(current);
    fittedLease.release();
  });
});
