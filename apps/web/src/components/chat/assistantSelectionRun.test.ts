import { beforeEach, describe, expect, it } from "vite-plus/test";

import { prepareSelectionCommand, useAssistantSelectionRunStore } from "./assistantSelectionRun";

describe("prepareSelectionCommand", () => {
  it("trims a single line", () => {
    expect(prepareSelectionCommand("  vp test run foo.test.ts \n")).toBe("vp test run foo.test.ts");
  });

  it("keeps the inner newline between lines", () => {
    expect(prepareSelectionCommand("cd apps/web\nvp run typecheck")).toBe(
      "cd apps/web\nvp run typecheck",
    );
  });

  it("converts CRLF and lone CR to newline", () => {
    expect(prepareSelectionCommand("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("rejects zero-width and bidi format characters", () => {
    expect(prepareSelectionCommand("ls​ -la")).toBeNull();
    expect(prepareSelectionCommand("ls ‮-la")).toBeNull();
  });

  it("rejects tabs and other control characters", () => {
    expect(prepareSelectionCommand("ls\t-la")).toBeNull();
    expect(prepareSelectionCommand("ls\u001b[0m")).toBeNull();
  });

  it("rejects empty and whitespace-only input", () => {
    expect(prepareSelectionCommand("")).toBeNull();
    expect(prepareSelectionCommand(" \n\r\n ")).toBeNull();
  });

  it("accepts 65535 characters and rejects 65536", () => {
    expect(prepareSelectionCommand("a".repeat(65_535))).toHaveLength(65_535);
    expect(prepareSelectionCommand("a".repeat(65_536))).toBeNull();
  });
});

describe("useAssistantSelectionRunStore", () => {
  beforeEach(() => {
    useAssistantSelectionRunStore.setState({ pending: null });
  });

  it("stores and clears the pending command", () => {
    useAssistantSelectionRunStore.getState().setPending("ls");
    expect(useAssistantSelectionRunStore.getState().pending).toBe("ls");

    useAssistantSelectionRunStore.getState().setPending(null);
    expect(useAssistantSelectionRunStore.getState().pending).toBeNull();
  });
});
