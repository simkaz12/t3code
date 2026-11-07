import { Fragment, useState, type CSSProperties } from "react";

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { ProjectId } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { useProject } from "../../state/entities";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Textarea } from "../ui/textarea";
import {
  approveLabel,
  collapsedLine,
  targetSummary,
  tileDiff,
  tileProjectStyle,
  type DiffSegment,
  type TileButton,
  type TrayTile,
} from "./memoryTray.logic";

const CLAIM_CLASS = "m-0 text-xs/4.5 text-card-foreground";
const META_CLASS = "m-0 text-2xs/4 text-muted-foreground";

const ACT_BUTTONS: ReadonlyArray<{
  readonly button: TileButton;
  readonly glyph: string;
  readonly hover: string;
  readonly highlighted: string;
}> = [
  { button: "approve", glyph: "✓", hover: "hover:text-success", highlighted: "text-success" },
  {
    button: "reject",
    glyph: "✗",
    hover: "hover:text-destructive",
    highlighted: "text-destructive",
  },
  { button: "details", glyph: "⤢", hover: "hover:text-foreground", highlighted: "text-foreground" },
];

function keyedSegments(segments: ReadonlyArray<DiffSegment>) {
  const size = (segment: DiffSegment) =>
    segment.kind === "same" ? segment.words.length : segment.removed.length + segment.added.length;

  const entries: Array<{ key: number; segment: DiffSegment }> = [];
  let key = 0;
  for (const segment of segments) {
    entries.push({ key, segment });
    key += size(segment);
  }

  return entries;
}

export function DiffText({ segments }: { segments: ReadonlyArray<DiffSegment> }) {
  return (
    <>
      {keyedSegments(segments).map(({ key, segment }) => (
        <Fragment key={key}>
          {key > 0 ? " " : null}
          {segment.kind === "same" ? (
            segment.words.join(" ")
          ) : (
            <DiffChange removed={segment.removed.join(" ")} added={segment.added.join(" ")} />
          )}
        </Fragment>
      ))}
    </>
  );
}

function DiffChange({ removed, added }: { removed: string; added: string }) {
  return (
    <>
      {removed === "" ? null : <span className="text-diff-deletion-foreground">{removed}</span>}
      {removed !== "" && added !== "" ? (
        <>
          {" "}
          <span className="text-muted-foreground">→</span>{" "}
        </>
      ) : null}
      {added === "" ? null : <span className="text-diff-addition-foreground">{added}</span>}
    </>
  );
}

function ClaimBody({ tile }: { tile: TrayTile }) {
  const diff = tileDiff(tile);
  if (diff === null) return <p className={CLAIM_CLASS}>{tile.claim}</p>;

  return (
    <p className={CLAIM_CLASS}>
      <DiffText segments={diff} />
    </p>
  );
}

function TargetLines({ tile }: { tile: TrayTile }) {
  const summary = targetSummary(tile);
  if (summary === null) return null;

  const lines = [summary.record, summary.keeper].filter((line) => line !== null);

  return (
    <>
      {lines.map((line) => (
        <p key={line.label} className={META_CLASS}>
          {line.label}: {line.text}
        </p>
      ))}
      {summary.reason === null ? null : <p className={META_CLASS}>Reason: {summary.reason}</p>}
    </>
  );
}

function TileBody({ tile }: { tile: TrayTile }) {
  return (
    <>
      <TargetLines tile={tile} />
      {tile.kind === "defect" && tile.where !== null ? (
        <p className={cn(META_CLASS, "truncate font-mono")}>{tile.where}</p>
      ) : null}
      <ClaimBody tile={tile} />
    </>
  );
}

function ClaimEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (claim: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);

  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        autoFocus
        size="sm"
        aria-label="Claim"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;

          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.stopPropagation();
            onSave(draft);
          }
        }}
      />
      <div className="-mx-1.5 flex items-center gap-0.5">
        <Button size="xs" variant="ghost" tabIndex={-1} onClick={() => onSave(draft)}>
          Save
          <Kbd>ctrl+enter</Kbd>
        </Button>
        <Button size="xs" variant="ghost-muted" tabIndex={-1} onClick={onCancel}>
          Cancel
          <Kbd>esc</Kbd>
        </Button>
      </div>
    </div>
  );
}

export function MemoryTile({
  tile,
  domId,
  cursor,
  marked,
  busy,
  activeButton,
  editing,
  onSelect,
  onToggleMark,
  onButton,
  onSaveClaim,
  onCancelEdit,
}: {
  tile: TrayTile;
  domId: string;
  cursor: boolean;
  marked: boolean;
  busy: boolean;
  activeButton: TileButton | null;
  editing: boolean;
  onSelect: () => void;
  onToggleMark: () => void;
  onButton: (button: TileButton) => void;
  onSaveClaim: (claim: string) => void;
  onCancelEdit: () => void;
}) {
  const project = useProject(
    tile.projectId === ""
      ? null
      : scopeProjectRef(tile.environmentId, ProjectId.make(tile.projectId)),
  );
  const identity = tileProjectStyle(project);
  const open = cursor || editing;
  const line = collapsedLine(tile);
  const labels: Record<TileButton, string> = {
    approve: approveLabel(tile),
    reject: "Reject",
    details: "Details",
  };

  return (
    <div
      id={domId}
      role="option"
      aria-selected={cursor}
      aria-busy={busy}
      data-memory-tile={tile.id}
      style={{ "--project": identity.color } as CSSProperties}
      className={cn(
        "surface-clip relative flex flex-col gap-1.5 rounded-none border border-(color:--tile-ring) bg-card py-1.5 pr-2.75 pl-3.75 text-card-foreground",
        "[--edge-paint:var(--tile-ring)] [--tile-ring:color-mix(in_srgb,var(--project)_55%,var(--border))]",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-(--project)",
        cursor && "bg-linear-to-b from-foreground/6 to-foreground/6 [--tile-ring:var(--project)]",
        marked && "before:bg-foreground",
        busy && "pointer-events-none opacity-60",
      )}
      onClick={onSelect}
      onMouseDown={(event) => {
        if (event.target instanceof Element && event.target.closest("button")) {
          event.preventDefault();
        }
      }}
    >
      <div className="flex min-h-5 items-center gap-1.5 text-2xs/4 text-muted-foreground">
        <button
          type="button"
          tabIndex={-1}
          aria-pressed={marked}
          aria-label="Mark"
          className={cn(
            "mr-1 size-3 flex-none rounded-sm border border-border hover:border-muted-foreground",
            marked && "border-foreground bg-foreground",
          )}
          onClick={onToggleMark}
        />
        <span aria-hidden="true" className="flex-none">
          {line.glyph}
        </span>
        <span data-memory-tile-label className="flex-none font-medium">
          {line.label}
        </span>
        <span
          data-memory-tile-headline
          className={cn("min-w-0 flex-1 text-xs/4.5 text-card-foreground", !open && "truncate")}
        >
          {line.headline}
        </span>
        {open ? (
          <span className="ml-auto flex">
            {ACT_BUTTONS.map(({ button, glyph, hover, highlighted }) => (
              <button
                key={button}
                type="button"
                tabIndex={-1}
                aria-label={labels[button]}
                disabled={busy}
                className={cn(
                  "grid size-5 flex-none place-items-center rounded-md text-sm/none",
                  hover,
                  activeButton === button &&
                    cn(
                      highlighted,
                      // oxlint-disable-next-line t3code/no-outset-state-indicators -- the tile head has no clipping ancestor and the owner-approved design offsets the button outline by 1px
                      "outline outline-1 outline-offset-1 outline-(--project)",
                    ),
                )}
                onClick={() => onButton(button)}
              >
                {glyph}
              </button>
            ))}
          </span>
        ) : null}
      </div>
      {open ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex min-h-4 items-center gap-1.5 text-2xs/4 text-muted-foreground">
            <span
              aria-hidden="true"
              className="grid size-4 flex-none place-items-center rounded-sm text-3xs/none font-semibold text-(--project)"
              style={{ backgroundColor: "color-mix(in srgb, var(--project) 14%, transparent)" }}
            >
              {identity.monogram}
            </span>
            {project === null ? null : <span className="truncate">{project.title}</span>}
            {tile.defectStatus !== null && tile.defectStatus !== "open" ? (
              <span
                data-memory-defect-status={tile.defectStatus}
                className="flex-none rounded-sm border border-border px-1 text-3xs/3.5 uppercase"
              >
                {tile.defectStatus}
              </span>
            ) : null}
          </div>
          {editing ? (
            <ClaimEditor initial={tile.claim} onSave={onSaveClaim} onCancel={onCancelEdit} />
          ) : (
            <TileBody tile={tile} />
          )}
        </div>
      ) : null}
    </div>
  );
}
