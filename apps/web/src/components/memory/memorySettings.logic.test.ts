import { describe, expect, it } from "vite-plus/test";

import {
  effectiveMemoryServerUrl,
  isConfidenceFloorLocked,
  parseConfidenceFloor,
  shouldSaveConfidenceFloor,
} from "./memorySettings.logic";

describe("parseConfidenceFloor", () => {
  it("accepts numbers from 0 to 1", () => {
    expect(parseConfidenceFloor("0.8")).toEqual({ valid: true, value: 0.8 });
    expect(parseConfidenceFloor(" 0 ")).toEqual({ valid: true, value: 0 });
    expect(parseConfidenceFloor("1")).toEqual({ valid: true, value: 1 });
  });

  it("rejects empty, non-numeric and out-of-range values", () => {
    for (const raw of ["", "  ", "abc", "1.5", "-0.1", "Infinity"]) {
      expect(parseConfidenceFloor(raw).valid).toBe(false);
    }
  });
});

describe("shouldSaveConfidenceFloor", () => {
  it("saves only a valid value that differs from the saved one", () => {
    expect(shouldSaveConfidenceFloor(parseConfidenceFloor("0.8"), 0.7)).toBe(true);
    expect(shouldSaveConfidenceFloor(parseConfidenceFloor("0.7"), 0.7)).toBe(false);
    expect(shouldSaveConfidenceFloor(parseConfidenceFloor("2"), 0.7)).toBe(false);
  });
});

describe("effectiveMemoryServerUrl", () => {
  it("reads the environment's memoryServerUrl and falls back to empty", () => {
    expect(
      effectiveMemoryServerUrl({ settings: { memoryServerUrl: "http://127.0.0.1:18890/v2" } }),
    ).toBe("http://127.0.0.1:18890/v2");
    expect(effectiveMemoryServerUrl({ settings: { memoryServerUrl: "" } })).toBe("");
    expect(effectiveMemoryServerUrl(undefined)).toBe("");
    expect(effectiveMemoryServerUrl(null)).toBe("");
  });
});

describe("isConfidenceFloorLocked", () => {
  it("locks the input until the server value is loaded and while a save or refresh is pending", () => {
    expect(isConfidenceFloorLocked({ saved: 0.7, saving: false, refreshing: false })).toBe(false);
    expect(isConfidenceFloorLocked({ saved: null, saving: false, refreshing: false })).toBe(true);
    expect(isConfidenceFloorLocked({ saved: 0.7, saving: true, refreshing: false })).toBe(true);
    expect(isConfidenceFloorLocked({ saved: 0.7, saving: false, refreshing: true })).toBe(true);
  });
});
