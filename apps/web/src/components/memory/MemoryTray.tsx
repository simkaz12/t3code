import { useAtom } from "@effect/atom-react";
import { InboxIcon } from "lucide-react";
import {
  memo,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { stackedThreadToast } from "../ui/toastHelpers";
import { MemoryDetails, type DetailsAction } from "./MemoryDetails";
import { MemoryTile } from "./MemoryTile";
import { memoryEnvironment, memoryTrayOpenAtom, useMemoryTray } from "./memoryState";
import {
  actionTargetKeys,
  approveAction,
  editsFromTile,
  escapeBlursList,
  flashText,
  initialCursorState,
  orderedTiles,
  pendingCount,
  runTileAction,
  TILE_BUTTONS,
  tileKey,
  trayCursorReducer,
  type TileAction,
  type TileButton,
  type TrayTile,
} from "./memoryTray.logic";

const STATUS_MS = 2_000;

const LEGEND: ReadonlyArray<readonly [string, string]> = [
  ["j/k", "move"],
  ["h/l", "button"],
  ["enter", "act"],
  ["x", "mark"],
  ["a", "approve"],
  ["r", "reject"],
  ["e", "edit"],
  ["o", "details"],
  ["esc", "clear"],
];

const sameKeys = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((key, index) => key === b[index]);

interface PlannedAction {
  readonly tile: TrayTile;
  readonly action: TileAction;
}

function TrayFooter({
  status,
  tileCount,
  markCount,
  legendOpen,
  onToggleLegend,
}: {
  status: string | null;
  tileCount: number;
  markCount: number;
  legendOpen: boolean;
  onToggleLegend: () => void;
}) {
  const counts = `${tileCount} ${tileCount === 1 ? "tile" : "tiles"} · ${markCount} marked`;

  return (
    <footer className="shrink-0 border-t border-border pt-2 text-2xs/4 text-muted-foreground">
      <div className="flex gap-1.5" aria-live="polite">
        <span className="min-w-0 truncate">{status ?? counts}</span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          tabIndex={-1}
          className="flex-none hover:text-foreground"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggleLegend}
        >
          ? keys
        </button>
      </div>
      {legendOpen ? (
        <div className="mt-1 flex flex-wrap gap-x-4 font-mono">
          {LEGEND.map(([combo, word]) => (
            <span key={combo} className="whitespace-pre">
              <b className="font-normal text-foreground">{combo}</b> {word}
            </span>
          ))}
        </div>
      ) : null}
    </footer>
  );
}

function MemoryTrayBody({
  listRef,
  errors,
  tiles,
}: {
  listRef: RefObject<HTMLDivElement | null>;
  errors: ReadonlyArray<string>;
  tiles: ReadonlyArray<TrayTile>;
}) {
  const listId = useId();
  const ordered = orderedTiles(tiles);
  const keys = ordered.map(tileKey);
  const [cursorState, dispatch] = useReducer(trayCursorReducer, initialCursorState);
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [detailsKey, setDetailsKey] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busyRef = useRef(new Set<string>());
  const approve = useAtomCommand(memoryEnvironment.approve, { reportFailure: false });
  const reject = useAtomCommand(memoryEnvironment.reject, { reportFailure: false });
  const reinforce = useAtomCommand(memoryEnvironment.reinforce, { reportFailure: false });

  if (!sameKeys(cursorState.keys, keys)) dispatch({ type: "sync", keys });

  const cursorIndex = cursorState.cursor;
  const cursorTile = ordered[cursorIndex];
  const cursorKey = cursorTile === undefined ? null : tileKey(cursorTile);
  const detailsTile = ordered.find((tile) => tileKey(tile) === detailsKey) ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the cursor tile into view once the DOM has the new open tile
  useEffect(() => {
    document.getElementById(`${listId}-${cursorIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [listId, cursorIndex]);

  const flash = (text: string) => {
    clearTimeout(statusTimer.current);
    setStatus(text);
    statusTimer.current = setTimeout(() => setStatus(null), STATUS_MS);
  };

  const markBusy = (planned: ReadonlyArray<PlannedAction>, busy: boolean) => {
    for (const { tile } of planned) {
      if (busy) busyRef.current.add(tileKey(tile));
      else busyRef.current.delete(tileKey(tile));
    }
    setBusyKeys(new Set(busyRef.current));
  };

  const perform = async (requested: ReadonlyArray<PlannedAction>) => {
    const planned = requested.filter(({ tile }) => !busyRef.current.has(tileKey(tile)));
    if (planned.length < requested.length) flash("Still working on that tile");
    if (planned.length === 0) return;

    markBusy(planned, true);
    const done: Array<TileAction> = [];
    for (const [index, entry] of planned.entries()) {
      const { tile, action } = entry;
      const result = await runTileAction(tile, action, { approve, reject, reinforce });
      markBusy([entry], false);

      if (result._tag === "Failure") {
        markBusy(planned.slice(index + 1), false);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Memory action failed",
            description: tile.headline,
          }),
        );
        flash("Memory action failed");
        return;
      }
      done.push(action);
    }

    flash(flashText(done));
  };

  const targetTiles = () => {
    const wanted = new Set(actionTargetKeys(cursorState));
    return ordered.filter((tile) => wanted.has(tileKey(tile)));
  };

  const approveTargets = () =>
    void perform(targetTiles().map((tile) => ({ tile, action: approveAction(tile) })));

  const rejectTargets = () =>
    void perform(targetTiles().map((tile) => ({ tile, action: { type: "reject" } })));

  const pressButton = (tile: TrayTile, button: TileButton) => {
    if (button === "details") setDetailsKey(tileKey(tile));
    else if (button === "approve") void perform([{ tile, action: approveAction(tile) }]);
    else void perform([{ tile, action: { type: "reject" } }]);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    listRef.current?.focus({ preventScroll: true });
  };

  const saveClaim = (tile: TrayTile, claim: string) => {
    if (claim.trim() === "") {
      cancelEdit();
      return;
    }

    setEditingKey(null);
    listRef.current?.focus({ preventScroll: true });
    void perform([
      { tile, action: approveAction(tile, { ...editsFromTile(tile), claim: claim.trim() }) },
    ]);
  };

  const handleDetails = (action: DetailsAction) => {
    const tile = detailsTile;
    setDetailsKey(null);
    if (tile === null || action === "close") return;

    if (action === "reinforce" && tile.suggestion !== null) {
      void perform([{ tile, action: { type: "reinforce", recordId: tile.suggestion.recordId } }]);
    } else if (action === "approve") {
      void perform([{ tile, action: approveAction(tile) }]);
    } else if (action === "reject") {
      void perform([{ tile, action: { type: "reject" } }]);
    }
  };

  const activate = () => {
    if (cursorTile === undefined) return;

    const button = cursorState.button === null ? "details" : TILE_BUTTONS[cursorState.button];
    dispatch({ type: "clearButton" });
    if (button !== undefined) pressButton(cursorTile, button);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { target } = event;
    if (target instanceof Element && target.closest("input, textarea") !== null) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;

    switch (event.key) {
      case "j":
      case "ArrowDown":
        dispatch({ type: "move", delta: 1 });
        break;
      case "k":
      case "ArrowUp":
        dispatch({ type: "move", delta: -1 });
        break;
      case "l":
      case "ArrowRight":
        dispatch({ type: "moveButton", delta: 1 });
        break;
      case "h":
      case "ArrowLeft":
        dispatch({ type: "moveButton", delta: -1 });
        break;
      case "Enter":
        activate();
        break;
      case "x":
      case " ":
        dispatch({ type: "toggleMark" });
        break;
      case "a":
        approveTargets();
        break;
      case "r":
        rejectTargets();
        break;
      case "e":
        if (cursorKey !== null) setEditingKey(cursorKey);
        break;
      case "o":
        setDetailsKey(cursorKey);
        break;
      case "?":
        setLegendOpen((current) => !current);
        break;
      case "Escape":
        if (escapeBlursList(cursorState)) listRef.current?.blur();
        else dispatch({ type: "escape" });
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="flex max-h-[70vh] flex-col gap-2">
      {errors.map((error) => (
        <p key={error} className="text-xs text-warning-foreground">
          {error}
        </p>
      ))}
      {ordered.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing waiting for approval.</p>
      ) : (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Memory proposals"
          aria-multiselectable="true"
          aria-activedescendant={cursorKey === null ? undefined : `${listId}-${cursorState.cursor}`}
          tabIndex={0}
          className="flex min-h-0 flex-col gap-2 overflow-y-auto p-px outline-none"
          onKeyDown={handleKeyDown}
        >
          {ordered.map((tile, index) => {
            const key = tileKey(tile);
            return (
              <MemoryTile
                key={key}
                tile={tile}
                domId={`${listId}-${index}`}
                cursor={index === cursorState.cursor}
                marked={cursorState.marks.has(key)}
                busy={busyKeys.has(key)}
                activeButton={
                  index === cursorState.cursor && cursorState.button !== null
                    ? (TILE_BUTTONS[cursorState.button] ?? null)
                    : null
                }
                editing={editingKey === key}
                onSelect={() => dispatch({ type: "select", key })}
                onToggleMark={() => dispatch({ type: "toggleMark", key })}
                onButton={(button) => pressButton(tile, button)}
                onSaveClaim={(claim) => saveClaim(tile, claim)}
                onCancelEdit={cancelEdit}
              />
            );
          })}
        </div>
      )}
      <TrayFooter
        status={status}
        tileCount={ordered.length}
        markCount={cursorState.marks.size}
        legendOpen={legendOpen}
        onToggleLegend={() => setLegendOpen((current) => !current)}
      />
      <MemoryDetails tile={detailsTile} finalFocus={listRef} onAction={handleDetails} />
    </div>
  );
}

export const MemoryTray = memo(function MemoryTray() {
  const { configured, tiles, errors } = useMemoryTray();
  const [open, setOpen] = useAtom(memoryTrayOpenAtom);
  const listRef = useRef<HTMLDivElement>(null);

  if (!configured) return null;

  const count = pendingCount(tiles);

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
        <PopoverPopup side="top" align="start" width="lg" padding="compact" initialFocus={listRef}>
          <MemoryTrayBody listRef={listRef} errors={errors} tiles={tiles} />
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
});
