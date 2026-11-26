import type { MessageId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { FileDiffIcon } from "lucide-react";
import { use } from "react";

import { useThreadCheckpointSummaries } from "~/state/entities";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { openArtifactModal } from "./ArtifactModal";
import { findAssistantTurnSummary } from "./artifactModalMode";
import { TimelineRowCtx } from "./timelineRowContext";

export function TurnChangesButton({ messageId }: { readonly messageId: MessageId }) {
  const { routeThreadKey, threadRef, onForkFromRun } = use(TimelineRowCtx);
  const gt = useGT();
  const summary = findAssistantTurnSummary(useThreadCheckpointSummaries(threadRef), messageId);
  if (!summary || threadRef === null || onForkFromRun === undefined) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() =>
              openArtifactModal(routeThreadKey, { kind: "turn", runId: summary.runId })
            }
            aria-label={gt("View changes from this response")}
          />
        }
      >
        <FileDiffIcon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup side="top">
        <T>View changes from this response</T>
      </TooltipPopup>
    </Tooltip>
  );
}
