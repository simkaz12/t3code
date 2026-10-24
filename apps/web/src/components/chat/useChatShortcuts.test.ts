import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { resolveChatShortcutCommand } from "../../keybindings";
import { isArtifactModalOwnedKey } from "./useChatShortcuts";

const LINUX = "Linux x86_64";

function keydown(key: string, options: { inModal: boolean; ctrlKey?: boolean; metaKey?: boolean }) {
  return {
    key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    altKey: false,
    shiftKey: false,
    target: {
      closest: (selector: string) =>
        options.inModal && selector === "[data-artifact-modal]" ? {} : null,
    } as unknown as EventTarget,
  };
}

describe("isArtifactModalOwnedKey", () => {
  it("does not consume mod+d, mod+u and mod+f typed inside the artifact modal", () => {
    for (const letter of ["d", "u", "f"]) {
      expect(
        isArtifactModalOwnedKey(keydown(letter, { inModal: true, ctrlKey: true }), LINUX),
      ).toBe(true);
    }
    expect(
      isArtifactModalOwnedKey(keydown("d", { inModal: true, metaKey: true }), "MacIntel"),
    ).toBe(true);
  });

  it("leaves the same chords alone outside the modal, where diff.toggle still resolves", () => {
    const event = keydown("d", { inModal: false, ctrlKey: true });

    expect(isArtifactModalOwnedKey(event, LINUX)).toBe(false);
    expect(
      resolveChatShortcutCommand(
        event,
        DEFAULT_RESOLVED_KEYBINDINGS,
        DEFAULT_RESOLVED_KEYBINDINGS,
        {
          platform: LINUX,
        },
      ),
    ).toBe("diff.toggle");
  });

  it("only yields the reserved chords inside the modal", () => {
    expect(isArtifactModalOwnedKey(keydown("k", { inModal: true, ctrlKey: true }), LINUX)).toBe(
      false,
    );
    expect(
      isArtifactModalOwnedKey({ ...keydown("d", { inModal: true }), target: null }, LINUX),
    ).toBe(false);
  });
});
