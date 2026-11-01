import { useEffect, useRef } from "react";

import { toastManager } from "../ui/toast";
import { stackedThreadToast } from "../ui/toastHelpers";
import { memoryTrayOpenAtom, useMemoryTray } from "./memoryState";
import { newTileIds, trayNotices } from "./memoryTray.logic";
import { appAtomRegistry } from "../../rpc/atomRegistry";

const openTray = () => appAtomRegistry.set(memoryTrayOpenAtom, true);

export function MemoryTrayCoordinator() {
  const { configured, tiles } = useMemoryTray();
  const seen = useRef<Set<string> | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- raises imperative toastManager toasts for proposals that arrive after the first snapshot
  useEffect(() => {
    if (!configured) return;

    const arrived = newTileIds(seen.current, tiles);
    seen.current = new Set(tiles.map((tile) => tile.id));
    const notices = trayNotices(tiles.filter((tile) => arrived.includes(tile.id)));
    for (const notice of notices) {
      toastManager.add(
        stackedThreadToast({
          ...notice,
          actionProps: { children: "Review", onClick: openTray },
        }),
      );
    }
  }, [configured, tiles]);

  return null;
}
