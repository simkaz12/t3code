import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import { useGT } from "gt-react";
import { useRef } from "react";

import { cn } from "~/lib/utils";

import { DiffStatLabel } from "./DiffStatLabel";
import { countHiddenTurnFiles } from "./artifactModalMode";

function splitPath(path: string): { readonly name: string; readonly dir: string } {
  const index = path.lastIndexOf("/");
  return index < 0
    ? { name: path, dir: "" }
    : { name: path.slice(index + 1), dir: path.slice(0, index) };
}

export function ArtifactTurnFileList(props: {
  readonly summary: ThreadCheckpointSummary;
  readonly selectedPath: string | null;
  readonly onSelect: (path: string) => void;
}) {
  const { summary, selectedPath, onSelect } = props;
  const gt = useGT();
  const hiddenCount = countHiddenTurnFiles(summary);
  const handledPath = useRef<string | null>(null);

  return (
    <nav
      aria-label={gt("Changed files")}
      data-turn-file-list=""
      className="flex max-h-40 w-full shrink-0 flex-col gap-0.5 overflow-y-auto border-b border-border/60 p-1.5 sm:max-h-none sm:w-72 sm:border-r sm:border-b-0"
    >
      {summary.files.map((file) => (
        <button
          key={file.path}
          type="button"
          aria-current={file.path === selectedPath ? "true" : undefined}
          onClick={() => onSelect(file.path)}
          ref={(element) => {
            if (!element || file.path !== selectedPath || handledPath.current === file.path) {
              return;
            }

            handledPath.current = file.path;
            element.scrollIntoView({ block: "nearest" });
            const active = document.activeElement;
            if (active !== element && active?.closest("[data-turn-file-list]")) {
              element.focus({ preventScroll: true });
            }
          }}
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left font-mono text-xs hover:bg-accent/60",
            file.path === selectedPath && "bg-accent text-accent-foreground",
          )}
        >
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="max-w-full shrink-0 truncate">{splitPath(file.path).name}</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {splitPath(file.path).dir}
            </span>
          </span>
          {file.additions > 0 || file.deletions > 0 ? (
            <DiffStatLabel additions={file.additions} deletions={file.deletions} layout="inline" />
          ) : null}
        </button>
      ))}
      {hiddenCount > 0 ? (
        <div className="px-2 py-1 font-mono text-xs text-muted-foreground">
          {gt("+{count} more files", { count: hiddenCount })}
        </div>
      ) : null}
    </nav>
  );
}
