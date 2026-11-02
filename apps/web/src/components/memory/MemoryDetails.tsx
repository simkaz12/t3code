import type { KeyboardEvent, RefObject } from "react";

import { Button } from "../ui/button";
import { Dialog, DialogFooter, DialogPanel, DialogPopup } from "../ui/dialog";
import { Kbd } from "../ui/kbd";
import { DiffText } from "./MemoryTile";
import {
  approveLabel,
  detailFields,
  isDestructiveTarget,
  tileDiff,
  type TrayTile,
} from "./memoryTray.logic";

export type DetailsAction = "approve" | "reject" | "reinforce" | "close";

function detailsKeyAction(key: string, canReinforce: boolean): DetailsAction | null {
  switch (key) {
    case "a":
      return "approve";
    case "r":
      return "reject";
    case "n":
      return canReinforce ? "reinforce" : null;
    case "o":
    case "Escape":
      return "close";
    default:
      return null;
  }
}

function DetailsBody({ tile }: { tile: TrayTile }) {
  const diff = tileDiff(tile);

  return (
    <div className="flex flex-col gap-3">
      {detailFields(tile).map((field) => (
        <div key={field.label} className="flex flex-col">
          <div className="text-2xs/4 text-muted-foreground">{field.label}</div>
          {field.label === "Headline" && diff !== null ? (
            <p className="m-0 text-sm/5">
              <DiffText segments={diff} />
            </p>
          ) : (
            field.lines.map((line) => (
              <p key={line} className="m-0 text-sm/5 whitespace-pre-wrap">
                {line}
              </p>
            ))
          )}
        </div>
      ))}
    </div>
  );
}

export function MemoryDetails({
  tile,
  finalFocus,
  onAction,
}: {
  tile: TrayTile | null;
  finalFocus: RefObject<HTMLElement | null>;
  onAction: (action: DetailsAction) => void;
}) {
  const canReinforce = tile?.suggestion?.action === "reinforce";

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;

    const action = detailsKeyAction(event.key, canReinforce);
    if (action === null) return;

    event.preventDefault();
    event.stopPropagation();
    onAction(action);
  };

  return (
    <Dialog open={tile !== null} onOpenChange={(open) => (open ? undefined : onAction("close"))}>
      <DialogPopup
        aria-label="Memory proposal details"
        showCloseButton={false}
        finalFocus={finalFocus}
        onKeyDown={handleKeyDown}
      >
        {tile === null ? null : (
          <>
            <DialogPanel>
              <DetailsBody tile={tile} />
            </DialogPanel>
            <DialogFooter>
              <Button
                size="sm"
                variant={isDestructiveTarget(tile) ? "destructive-outline" : "default"}
                onClick={() => onAction("approve")}
              >
                {approveLabel(tile)}
                <Kbd>a</Kbd>
              </Button>
              <Button size="sm" variant="ghost-destructive" onClick={() => onAction("reject")}>
                Reject
                <Kbd>r</Kbd>
              </Button>
              {canReinforce ? (
                <Button size="sm" variant="outline" onClick={() => onAction("reinforce")}>
                  Reinforce
                  <Kbd>n</Kbd>
                </Button>
              ) : null}
              <Button size="sm" variant="ghost-muted" onClick={() => onAction("close")}>
                Close
                <Kbd>esc</Kbd>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}
