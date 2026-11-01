import type { MemorySupersedeReason } from "@t3tools/contracts";
import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  approveLabel,
  canExpand,
  editsFromTile,
  isDestructiveTarget,
  isLowConfidence,
  suggestionFor,
  targetSummary,
  type TileAction,
  type TileEdits,
  type TrayTile,
} from "./memoryTray.logic";

const SUPERSEDE_REASONS: ReadonlyArray<MemorySupersedeReason> = [
  "correction",
  "changed",
  "elaborated",
];

const EDIT_FIELDS: ReadonlyArray<{
  readonly key: keyof TileEdits;
  readonly label: string;
  readonly multiline: boolean;
}> = [
  { key: "headline", label: "Headline", multiline: false },
  { key: "claim", label: "Claim", multiline: true },
  { key: "why", label: "Why", multiline: true },
  { key: "rejected", label: "Rejected", multiline: true },
  { key: "scope", label: "Scope", multiline: false },
  { key: "purpose", label: "Purpose", multiline: false },
  { key: "topic", label: "Topic", multiline: false },
];

export function MemoryTile({
  tile,
  busy,
  onAction,
  onExpand,
}: {
  tile: TrayTile;
  busy: boolean;
  onAction: (tile: TrayTile, action: TileAction) => void;
  onExpand: (tile: TrayTile) => void;
}) {
  const suggestion = suggestionFor(tile);
  const target = targetSummary(tile);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<TileEdits>(() => editsFromTile(tile));
  const [supersede, setSupersede] = useState(suggestion?.kind === "supersede");
  const [reason, setReason] = useState<MemorySupersedeReason>(suggestion?.reasonClass ?? "changed");
  const visibleFields = EDIT_FIELDS.filter(
    ({ key }) => key !== "rejected" || tile.kind === "decision",
  );
  const editedBody = editing ? { edits } : {};

  return (
    <li
      data-memory-tile={tile.id}
      className="flex flex-col gap-2 rounded-lg border border-border/70 bg-background/60 p-3"
    >
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium leading-snug">{tile.headline}</p>
        <div className="flex flex-wrap items-center gap-1">
          <Badge size="sm" variant={tile.kind === "decision" ? "info" : "secondary"}>
            {tile.kind}
          </Badge>
          <Badge size="sm" variant="outline">
            {tile.origin}
          </Badge>
          <Badge size="sm" variant="outline">
            {tile.scope}
          </Badge>
          {tile.topic ? (
            <Badge size="sm" variant="outline">
              {tile.topic}
            </Badge>
          ) : null}
          {tile.purpose ? (
            <Badge size="sm" variant="outline">
              {tile.purpose}
            </Badge>
          ) : null}
          {tile.flags.map((flag) => (
            <Badge key={flag} size="sm" variant="warning">
              {flag}
            </Badge>
          ))}
          {isLowConfidence(tile) ? (
            <Badge size="sm" variant="warning">
              low confidence
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">From {tile.threadTitle}</p>
      </div>

      {target === null ? null : (
        <div
          data-memory-target={target.label}
          className="flex flex-col gap-0.5 rounded-md bg-warning/8 px-2 py-1.5 text-xs"
        >
          {[target.record, target.keeper].map((line) =>
            line === null ? null : (
              <span key={line.label} className="min-w-0">
                {line.label}: <strong>{line.text}</strong>
                {line.id === null ? null : (
                  <span className="ml-1 text-3xs text-muted-foreground">{line.id}</span>
                )}
              </span>
            ),
          )}
          <span className="text-muted-foreground">{target.sentence}</span>
          {target.reason === null ? null : (
            <span className="text-muted-foreground">Reason: {target.reason}</span>
          )}
        </div>
      )}

      {suggestion?.kind === "reinforce" ? (
        <div className="flex items-center justify-between gap-2 rounded-md bg-warning/8 px-2 py-1.5 text-xs">
          <span className="min-w-0">
            Covered by existing record: <strong>{suggestion.neighbour.headline}</strong>
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => onAction(tile, { type: "reinforce", recordId: suggestion.neighbour.id })}
          >
            Reinforce existing
          </Button>
        </div>
      ) : null}

      {suggestion?.kind === "supersede" ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-warning/8 px-2 py-1.5 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={supersede}
              onChange={(event) => setSupersede(event.target.checked)}
            />
            <span className="min-w-0">
              Supersedes this one: <strong>{suggestion.neighbour.headline}</strong>
            </span>
          </label>
          {supersede ? (
            <div className="flex items-center gap-1">
              {SUPERSEDE_REASONS.map((option) => (
                <Button
                  key={option}
                  size="xs"
                  variant={option === reason ? "secondary" : "ghost"}
                  onClick={() => setReason(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <div className="flex flex-col gap-2">
          {visibleFields.map(({ key, label, multiline }) =>
            multiline ? (
              <Textarea
                key={key}
                aria-label={label}
                size="sm"
                value={edits[key]}
                onChange={(event) => setEdits({ ...edits, [key]: event.target.value })}
              />
            ) : (
              <Input
                key={key}
                aria-label={label}
                size="sm"
                value={edits[key]}
                onChange={(event) => setEdits({ ...edits, [key]: event.target.value })}
              />
            ),
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="xs"
          variant={isDestructiveTarget(tile) ? "destructive-outline" : "default"}
          disabled={busy}
          onClick={() =>
            onAction(
              tile,
              suggestion?.kind === "supersede" && supersede
                ? { type: "supersede", recordId: suggestion.neighbour.id, reason, ...editedBody }
                : { type: "approve", ...editedBody },
            )
          }
        >
          {approveLabel(tile)}
        </Button>
        <Button size="xs" variant="outline" onClick={() => setEditing(!editing)}>
          {editing ? "Cancel edit" : "Edit"}
        </Button>
        <Button
          size="xs"
          variant="ghost-destructive"
          disabled={busy}
          onClick={() => onAction(tile, { type: "reject" })}
        >
          Reject
        </Button>
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={!canExpand(tile)}
          onClick={() => onExpand(tile)}
        >
          Expand
        </Button>
      </div>
    </li>
  );
}
