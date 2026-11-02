import { useEffect, useRef } from "react";

import { memoryTrayOpenAtom, useMemoryTray } from "./memoryState";
import { newTileIds } from "./memoryTray.logic";
import { appAtomRegistry } from "../../rpc/atomRegistry";

export function MemoryTrayCoordinator() {
  const { configured, tiles } = useMemoryTray();
  const seen = useRef<Set<string> | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the tray imperatively when proposals arrive after the first snapshot
  useEffect(() => {
    if (!configured) return;

    const arrived = newTileIds(seen.current, tiles);
    seen.current = new Set(tiles.map((tile) => tile.id));
    if (arrived.length > 0) appAtomRegistry.set(memoryTrayOpenAtom, true);
  }, [configured, tiles]);

  return null;
}
