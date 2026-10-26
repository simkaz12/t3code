import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

export interface PreviewExpandedState {
  readonly tabId: string;
}

interface PreviewExpandedStoreState {
  readonly byThreadKey: Record<string, PreviewExpandedState>;
  readonly expand: (ref: ScopedThreadRef, tabId: string) => void;
  readonly collapse: (ref: ScopedThreadRef) => void;
  /** `miniPlayerTabId` is the tab the thread's floating preview shows, if any. */
  readonly toggle: (ref: ScopedThreadRef, miniPlayerTabId: string | null) => boolean;
}

export const usePreviewExpandedStore = create<PreviewExpandedStoreState>()((set, get) => ({
  byThreadKey: {},
  expand: (ref, tabId) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      if (state.byThreadKey[threadKey]?.tabId === tabId) return state;
      return { byThreadKey: { ...state.byThreadKey, [threadKey]: { tabId } } };
    }),
  collapse: (ref) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      if (!(threadKey in state.byThreadKey)) return state;
      const { [threadKey]: _collapsed, ...byThreadKey } = state.byThreadKey;
      return { byThreadKey };
    }),
  toggle: (ref, miniPlayerTabId) => {
    const expanded = get().byThreadKey[scopedThreadKey(ref)];
    if (expanded) {
      get().collapse(ref);
      return true;
    }
    if (miniPlayerTabId === null) return false;
    get().expand(ref, miniPlayerTabId);
    return true;
  },
}));

export function selectThreadPreviewExpandedTabId(
  byThreadKey: Record<string, PreviewExpandedState>,
  ref: ScopedThreadRef | null | undefined,
): string | null {
  if (!ref) return null;
  return byThreadKey[scopedThreadKey(ref)]?.tabId ?? null;
}
