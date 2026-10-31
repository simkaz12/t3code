import type { RunId } from "@t3tools/contracts";
import { use } from "react";

import { artifactOpener } from "./ArtifactModal";
import type { ArtifactOpenHandler } from "./artifactModalMode";
import { TimelineRowCtx } from "./timelineRowContext";

export function useTimelineArtifactOpener(runId?: RunId | null): ArtifactOpenHandler {
  const { routeThreadKey } = use(TimelineRowCtx);
  return artifactOpener(routeThreadKey, runId);
}
