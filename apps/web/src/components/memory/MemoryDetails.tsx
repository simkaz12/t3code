import { useState, type KeyboardEvent, type RefObject } from "react";

import { Button } from "../ui/button";
import { Dialog, DialogFooter, DialogPanel, DialogPopup } from "../ui/dialog";
import { Kbd } from "../ui/kbd";
import { DiffText } from "./MemoryTile";
import {
  approveLabel,
  detailFields,
  isDestructiveTarget,
  TRAY_AUDIENCES,
  tileDiff,
  type TrayTile,
} from "./memoryTray.logic";

export type DetailsAction = "approve" | "reject" | "reinforce" | "close";

const AUDIENCE_SELECT_CLASS =
  "h-7 w-full max-w-48 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring";

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

function AudienceSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (audience: string) => void;
}) {
  return (
    <select
      aria-label="Audience"
      className={AUDIENCE_SELECT_CLASS}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">none</option>
      {TRAY_AUDIENCES.map((audience) => (
        <option key={audience} value={audience}>
          {audience}
        </option>
      ))}
    </select>
  );
}

function DetailsBody({
  tile,
  audience,
  onAudienceChange,
}: {
  tile: TrayTile;
  audience: string;
  onAudienceChange: (audience: string) => void;
}) {
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
          ) : field.editable === "audience" ? (
            <AudienceSelect value={audience} onChange={onAudienceChange} />
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
  onAction: (action: DetailsAction, audience: string) => void;
}) {
  const canReinforce = tile?.suggestion?.action === "reinforce";
  const [draft, setDraft] = useState<{ readonly tileId: string; readonly audience: string } | null>(
    null,
  );
  const audience =
    tile === null ? "" : draft?.tileId === tile.id ? draft.audience : (tile.audience ?? "");

  const act = (action: DetailsAction) => onAction(action, audience);

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    if (event.target instanceof Element && event.target.closest("select, input, textarea")) return;

    const action = detailsKeyAction(event.key, canReinforce);
    if (action === null) return;

    event.preventDefault();
    event.stopPropagation();
    act(action);
  };

  return (
    <Dialog open={tile !== null} onOpenChange={(open) => (open ? undefined : act("close"))}>
      <DialogPopup
        aria-label="Memory proposal details"
        showCloseButton={false}
        finalFocus={finalFocus}
        onKeyDown={handleKeyDown}
      >
        {tile === null ? null : (
          <>
            <DialogPanel>
              <DetailsBody
                tile={tile}
                audience={audience}
                onAudienceChange={(next) => setDraft({ tileId: tile.id, audience: next })}
              />
            </DialogPanel>
            <DialogFooter>
              <Button
                size="sm"
                variant={isDestructiveTarget(tile) ? "destructive-outline" : "default"}
                onClick={() => act("approve")}
              >
                {approveLabel(tile)}
                <Kbd>a</Kbd>
              </Button>
              <Button size="sm" variant="ghost-destructive" onClick={() => act("reject")}>
                Reject
                <Kbd>r</Kbd>
              </Button>
              {canReinforce ? (
                <Button size="sm" variant="outline" onClick={() => act("reinforce")}>
                  Reinforce
                  <Kbd>n</Kbd>
                </Button>
              ) : null}
              <Button size="sm" variant="ghost-muted" onClick={() => act("close")}>
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
