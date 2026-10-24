import { isMacPlatform } from "@t3tools/shared/keybindings";

export const ARTIFACT_VIEWER_CHORD_WINDOW_MS = 500;

export type ViewerAction =
  | "scrollLine"
  | "scrollHalfPage"
  | "scrollTop"
  | "scrollBottom"
  | "toggleRaw"
  | "toggleFullFile"
  | "openFind";

export interface ViewerKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export interface ViewerKeyState {
  readonly lastKey: string | null;
  readonly lastKeyAt: number;
  readonly now: number;
  readonly isMarkdown: boolean;
  readonly diffAvailable: boolean;
  readonly hasCodeView: boolean;
}

export interface ViewerKeyResult {
  readonly action: ViewerAction;
  readonly dir?: 1 | -1;
  readonly nextState: Pick<ViewerKeyState, "lastKey" | "lastKeyAt">;
}

const MODAL_RESERVED_CHORD_KEYS: ReadonlySet<string> = new Set(["d", "u", "f"]);

export function isArtifactModalReservedChord(
  event: Pick<ViewerKeyEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  platform: string,
): boolean {
  const modPressed = isMacPlatform(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;

  return (
    modPressed &&
    !event.altKey &&
    !event.shiftKey &&
    MODAL_RESERVED_CHORD_KEYS.has(event.key.toLowerCase())
  );
}

export function resolveViewerKey(
  event: ViewerKeyEvent,
  state: ViewerKeyState,
): ViewerKeyResult | null {
  const hit = (action: ViewerAction, dir?: 1 | -1, reset = false): ViewerKeyResult => ({
    action,
    ...(dir === undefined ? {} : { dir }),
    nextState: reset
      ? { lastKey: null, lastKeyAt: 0 }
      : { lastKey: event.key, lastKeyAt: state.now },
  });
  const { key, ctrlKey, metaKey, altKey, shiftKey } = event;

  if (altKey) return null;

  if (ctrlKey && !metaKey && !shiftKey) {
    if (key === "d") return hit("scrollHalfPage", 1);
    if (key === "u") return hit("scrollHalfPage", -1);
    if (key === "f" && state.hasCodeView) return hit("openFind");
    return null;
  }

  if (metaKey && !ctrlKey && !shiftKey) {
    return key === "f" && state.hasCodeView ? hit("openFind") : null;
  }

  if (ctrlKey || metaKey) return null;

  if (key === "G") return hit("scrollBottom");
  if (shiftKey && key !== "/") return null;

  switch (key) {
    case "j":
      return hit("scrollLine", 1);
    case "k":
      return hit("scrollLine", -1);
    case "g": {
      const chorded =
        state.lastKey === "g" && state.now - state.lastKeyAt <= ARTIFACT_VIEWER_CHORD_WINDOW_MS;
      return chorded ? hit("scrollTop", undefined, true) : null;
    }
    case "r":
      return state.isMarkdown ? hit("toggleRaw") : null;
    case "f":
      return state.diffAvailable ? hit("toggleFullFile") : null;
    case "/":
      return state.hasCodeView ? hit("openFind") : null;
    default:
      return null;
  }
}
