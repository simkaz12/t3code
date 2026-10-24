import { describe, expect, it } from "vite-plus/test";

import {
  isArtifactModalReservedChord,
  resolveViewerKey,
  type ViewerKeyEvent,
  type ViewerKeyState,
} from "./artifactModalKeys";

function key(value: string, overrides: Partial<ViewerKeyEvent> = {}): ViewerKeyEvent {
  return {
    key: value,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function state(overrides: Partial<ViewerKeyState> = {}): ViewerKeyState {
  return {
    lastKey: null,
    lastKeyAt: 0,
    now: 1_000,
    isMarkdown: false,
    diffAvailable: false,
    hasCodeView: false,
    ...overrides,
  };
}

describe("resolveViewerKey", () => {
  it("scrolls one line with j and k", () => {
    expect(resolveViewerKey(key("j"), state())).toMatchObject({ action: "scrollLine", dir: 1 });
    expect(resolveViewerKey(key("k"), state())).toMatchObject({ action: "scrollLine", dir: -1 });
  });

  it("scrolls half a page with ctrl+d and ctrl+u", () => {
    expect(resolveViewerKey(key("d", { ctrlKey: true }), state())).toMatchObject({
      action: "scrollHalfPage",
      dir: 1,
    });
    expect(resolveViewerKey(key("u", { ctrlKey: true }), state())).toMatchObject({
      action: "scrollHalfPage",
      dir: -1,
    });
  });

  it("jumps to the top on g followed by g within 500 ms", () => {
    const result = resolveViewerKey(key("g"), state({ lastKey: "g", lastKeyAt: 600, now: 1_000 }));

    expect(result?.action).toBe("scrollTop");
    expect(result?.nextState).toEqual({ lastKey: null, lastKeyAt: 0 });
  });

  it("treats a g after the 500 ms window as the first g of a new pair", () => {
    expect(
      resolveViewerKey(key("g"), state({ lastKey: "g", lastKeyAt: 400, now: 1_000 })),
    ).toBeNull();
  });

  it("does not chord g after another key", () => {
    expect(
      resolveViewerKey(key("g"), state({ lastKey: "j", lastKeyAt: 900, now: 1_000 })),
    ).toBeNull();
  });

  it("jumps to the bottom on G", () => {
    expect(resolveViewerKey(key("G", { shiftKey: true }), state())?.action).toBe("scrollBottom");
  });

  it("toggles raw only for markdown", () => {
    expect(resolveViewerKey(key("r"), state())).toBeNull();
    expect(resolveViewerKey(key("r"), state({ isMarkdown: true }))?.action).toBe("toggleRaw");
  });

  it("toggles the full file only when a diff is available", () => {
    expect(resolveViewerKey(key("f"), state())).toBeNull();
    expect(resolveViewerKey(key("f"), state({ diffAvailable: true }))?.action).toBe(
      "toggleFullFile",
    );
  });

  it("opens find with / only when a code view is mounted", () => {
    expect(resolveViewerKey(key("/"), state())).toBeNull();
    expect(resolveViewerKey(key("/"), state({ hasCodeView: true }))?.action).toBe("openFind");
  });

  it("opens find with ctrl+f or cmd+f only when a code view is mounted", () => {
    expect(resolveViewerKey(key("f", { ctrlKey: true }), state())).toBeNull();
    expect(
      resolveViewerKey(key("f", { ctrlKey: true }), state({ hasCodeView: true }))?.action,
    ).toBe("openFind");
    expect(
      resolveViewerKey(key("f", { metaKey: true }), state({ hasCodeView: true }))?.action,
    ).toBe("openFind");
  });

  it("leaves Escape to the dialog", () => {
    expect(
      resolveViewerKey(key("Escape"), state({ hasCodeView: true, isMarkdown: true })),
    ).toBeNull();
  });

  it("ignores plain letters with alt held", () => {
    expect(resolveViewerKey(key("j", { altKey: true }), state())).toBeNull();
  });
});

describe("isArtifactModalReservedChord", () => {
  it("reserves mod+d, mod+u and mod+f for the platform modifier", () => {
    for (const letter of ["d", "u", "f"]) {
      expect(isArtifactModalReservedChord(key(letter, { ctrlKey: true }), "Linux x86_64")).toBe(
        true,
      );
      expect(isArtifactModalReservedChord(key(letter, { metaKey: true }), "MacIntel")).toBe(true);
    }
  });

  it("leaves other chords and the wrong platform modifier alone", () => {
    expect(isArtifactModalReservedChord(key("d", { metaKey: true }), "Linux x86_64")).toBe(false);
    expect(isArtifactModalReservedChord(key("d", { ctrlKey: true }), "MacIntel")).toBe(false);
    expect(isArtifactModalReservedChord(key("k", { ctrlKey: true }), "Linux x86_64")).toBe(false);
    expect(
      isArtifactModalReservedChord(key("d", { ctrlKey: true, shiftKey: true }), "Linux x86_64"),
    ).toBe(false);
    expect(isArtifactModalReservedChord(key("d"), "Linux x86_64")).toBe(false);
  });
});
