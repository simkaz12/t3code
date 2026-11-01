import { useAtom } from "@effect/atom-react";
import { InboxIcon } from "lucide-react";
import { memo, useState } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { stackedThreadToast } from "../ui/toastHelpers";
import { MemoryTile } from "./MemoryTile";
import { memoryEnvironment, memoryTrayOpenAtom, useMemoryTray } from "./memoryState";
import { expandTile, groupTiles, pendingCount, runTileAction } from "./memoryTray.logic";
import type { TileAction, TrayTile } from "./memoryTray.logic";

export const MemoryTray = memo(function MemoryTray() {
  const { configured, tiles, errors } = useMemoryTray();
  const [open, setOpen] = useAtom(memoryTrayOpenAtom);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const handleNewThread = useNewThreadHandler();
  const approve = useAtomCommand(memoryEnvironment.approve, { reportFailure: false });
  const reject = useAtomCommand(memoryEnvironment.reject, { reportFailure: false });
  const reinforce = useAtomCommand(memoryEnvironment.reinforce, { reportFailure: false });

  if (!configured) return null;

  const count = pendingCount(tiles);
  const groups = groupTiles(tiles);

  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleAction = async (tile: TrayTile, action: TileAction) => {
    setBusy(tile.id, true);
    const result = await runTileAction(tile, action, { approve, reject, reinforce });
    setBusy(tile.id, false);
    if (result._tag === "Failure") {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Memory action failed",
          description: tile.headline,
        }),
      );
    }
  };

  return (
    <SidebarMenuItem className="shrink-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <SidebarMenuButton aria-label="Memory proposals" size="icon" className="relative">
              <InboxIcon />
              {count > 0 ? (
                <span className="absolute -top-1 -right-1" data-memory-tray-badge>
                  <Badge size="sm">{count}</Badge>
                </span>
              ) : null}
            </SidebarMenuButton>
          }
        />
        <PopoverPopup side="top" align="start" width="lg" padding="compact">
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto px-1">
            <p className="text-sm font-medium">Memory proposals</p>
            {errors.map((error) => (
              <p key={error} className="text-xs text-warning-foreground">
                {error}
              </p>
            ))}
            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing waiting for approval.</p>
            ) : null}
            {groups.map((group) => (
              <section key={group.threadId} className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">{group.threadTitle}</h3>
                <ul className="flex flex-col gap-2">
                  {group.tiles.map((tile) => (
                    <MemoryTile
                      key={`${tile.environmentId}:${tile.id}`}
                      tile={tile}
                      busy={busyIds.has(tile.id)}
                      onAction={(target, action) => void handleAction(target, action)}
                      onExpand={(target) => {
                        setOpen(false);
                        void expandTile(target, handleNewThread);
                      }}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
});
