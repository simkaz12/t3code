import { RunId } from "@t3tools/contracts";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import { describe, expect, it } from "vite-plus/test";

import type { ChatFileAttachment } from "~/types";

import { resolveArtifactMode, type ArtifactTarget } from "./artifactModalMode";

const runId = RunId.make("run-1");

function summary(
  overrides: Partial<ThreadCheckpointSummary> & { paths?: ReadonlyArray<string> } = {},
): ThreadCheckpointSummary {
  const { paths = ["src/foo.ts"], ...rest } = overrides;
  return {
    runId,
    checkpointTurnCount: 3,
    checkpointRef: "refs/t3/checkpoints/3" as ThreadCheckpointSummary["checkpointRef"],
    status: "ready",
    files: paths.map((path) => ({ path, kind: "modified", additions: 2, deletions: 1 })),
    assistantMessageId: null,
    completedAt: "2026-10-24T10:00:00.000Z",
    ...rest,
  };
}

function fileTarget(overrides: Partial<Extract<ArtifactTarget, { kind: "file" }>> = {}) {
  return { kind: "file", path: "src/foo.ts", runId, ...overrides } as ArtifactTarget;
}

describe("resolveArtifactMode", () => {
  it("opens a diff when the run changed the file", () => {
    expect(resolveArtifactMode(fileTarget(), [summary()])).toBe("diff");
  });

  it("opens the file when the run did not change it", () => {
    expect(resolveArtifactMode(fileTarget({ path: "src/bar.ts" }), [summary()])).toBe("file");
  });

  it("opens the file when the target has no run", () => {
    expect(resolveArtifactMode(fileTarget({ runId: undefined }), [summary()])).toBe("file");
  });

  it("opens the file when no summary matches the run", () => {
    expect(resolveArtifactMode(fileTarget(), [summary({ runId: RunId.make("run-2") })])).toBe(
      "file",
    );
    expect(resolveArtifactMode(fileTarget(), [])).toBe("file");
  });

  it("matches a changed path written with a leading ./", () => {
    expect(resolveArtifactMode(fileTarget({ path: "./src/foo.ts" }), [summary()])).toBe("diff");
  });

  it("opens a changed image as a file", () => {
    expect(
      resolveArtifactMode(fileTarget({ path: "assets/logo.png" }), [
        summary({ paths: ["assets/logo.png"] }),
      ]),
    ).toBe("file");
  });

  it("opens attachments as files", () => {
    const attachment = { id: "a-1", name: "notes.md" } as ChatFileAttachment;

    expect(resolveArtifactMode({ kind: "attachment", attachment }, [summary()])).toBe("file");
  });
});
