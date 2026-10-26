import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectThreadPreviewExpandedTabId, usePreviewExpandedStore } from "./previewExpandedStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

const expandedTab = (ref: typeof refA) =>
  selectThreadPreviewExpandedTabId(usePreviewExpandedStore.getState().byThreadKey, ref);

beforeEach(() => {
  usePreviewExpandedStore.setState({ byThreadKey: {} });
});

describe("previewExpandedStore", () => {
  it("expands and collapses one thread without touching another", () => {
    usePreviewExpandedStore.getState().expand(refA, "tab-a");
    usePreviewExpandedStore.getState().expand(refB, "tab-b");
    usePreviewExpandedStore.getState().collapse(refA);

    expect(expandedTab(refA)).toBeNull();
    expect(expandedTab(refB)).toBe("tab-b");
  });

  it("toggles a floating preview into the modal and back", () => {
    expect(usePreviewExpandedStore.getState().toggle(refA, "tab-a")).toBe(true);
    expect(expandedTab(refA)).toBe("tab-a");

    expect(usePreviewExpandedStore.getState().toggle(refA, "tab-a")).toBe(true);
    expect(expandedTab(refA)).toBeNull();
  });

  it("collapses an open modal even when the floating preview is gone", () => {
    usePreviewExpandedStore.getState().expand(refA, "tab-a");

    expect(usePreviewExpandedStore.getState().toggle(refA, null)).toBe(true);
    expect(expandedTab(refA)).toBeNull();
  });

  it("does nothing without a floating preview or modal", () => {
    expect(usePreviewExpandedStore.getState().toggle(refA, null)).toBe(false);
    expect(expandedTab(refA)).toBeNull();
  });

  it("keeps the same state object when collapsing or re-expanding is a no-op", () => {
    usePreviewExpandedStore.getState().collapse(refA);
    const idle = usePreviewExpandedStore.getState().byThreadKey;
    usePreviewExpandedStore.getState().collapse(refA);
    expect(usePreviewExpandedStore.getState().byThreadKey).toBe(idle);

    usePreviewExpandedStore.getState().expand(refA, "tab-a");
    const open = usePreviewExpandedStore.getState().byThreadKey;
    usePreviewExpandedStore.getState().expand(refA, "tab-a");
    expect(usePreviewExpandedStore.getState().byThreadKey).toBe(open);
  });
});
