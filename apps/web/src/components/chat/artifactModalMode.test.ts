import { MessageId, RunId } from "@t3tools/contracts";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import { describe, expect, it } from "vite-plus/test";

import type { ChatFileAttachment } from "~/types";

import {
  countHiddenTurnFiles,
  findAssistantTurnSummary,
  findTurnSummary,
  resolveArtifactMode,
  resolveTurnFilePath,
  stepTurnFilePath,
  type ArtifactTarget,
} from "./artifactModalMode";

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

describe("turn target", () => {
  const messageId = MessageId.make("message-1");
  const turn = summary({
    paths: ["src/a.ts", "src/b.ts", "src/c.ts"],
    assistantMessageId: messageId,
  });

  it("finds the changed-files summary for an assistant message only when it has files", () => {
    expect(findAssistantTurnSummary([turn], messageId)).toBe(turn);
    expect(findAssistantTurnSummary([turn], MessageId.make("message-2"))).toBeUndefined();
    expect(
      findAssistantTurnSummary([summary({ paths: [], assistantMessageId: messageId })], messageId),
    ).toBeUndefined();
  });

  it("looks the summary up by run id", () => {
    expect(findTurnSummary({ kind: "turn", runId }, [turn])).toBe(turn);
    expect(findTurnSummary({ kind: "turn", runId: RunId.make("run-2") }, [turn])).toBeUndefined();
    expect(findTurnSummary(fileTarget(), [turn])).toBeUndefined();
  });

  it("selects the first file by default and keeps a still-present selection", () => {
    expect(resolveTurnFilePath(turn, null)).toBe("src/a.ts");
    expect(resolveTurnFilePath(turn, "src/b.ts")).toBe("src/b.ts");
    expect(resolveTurnFilePath(turn, "src/gone.ts")).toBe("src/a.ts");
    expect(resolveTurnFilePath(undefined, null)).toBeNull();
  });

  it("counts files the wire summary left out", () => {
    expect(countHiddenTurnFiles(turn)).toBe(0);
    expect(
      countHiddenTurnFiles({ ...turn, filesTotal: { count: 203, additions: 0, deletions: 0 } }),
    ).toBe(203 - turn.files.length);
  });

  it("steps through files without wrapping", () => {
    expect(stepTurnFilePath(turn, "src/a.ts", 1)).toBe("src/b.ts");
    expect(stepTurnFilePath(turn, "src/c.ts", 1)).toBe("src/c.ts");
    expect(stepTurnFilePath(turn, "src/a.ts", -1)).toBe("src/a.ts");
  });
});
