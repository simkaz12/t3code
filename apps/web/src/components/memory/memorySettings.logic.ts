export const CONFIDENCE_FLOOR_STEP = 0.05;

export type ConfidenceFloorParse =
  | { readonly valid: true; readonly value: number }
  | { readonly valid: false; readonly message: string };

export function parseConfidenceFloor(raw: string): ConfidenceFloorParse {
  const text = raw.trim();
  if (text === "") return { valid: false, message: "Enter a number from 0 to 1." };

  const value = Number(text);
  if (!Number.isFinite(value)) return { valid: false, message: "Enter a number from 0 to 1." };
  if (value < 0 || value > 1) return { valid: false, message: "The floor must be from 0 to 1." };

  return { valid: true, value };
}

export function shouldSaveConfidenceFloor(parsed: ConfidenceFloorParse, saved: number | null) {
  return parsed.valid && parsed.value !== saved;
}

export function effectiveMemoryServerUrl(
  config: { readonly settings: { readonly memoryServerUrl: string } } | null | undefined,
): string {
  return config?.settings.memoryServerUrl ?? "";
}

export function isConfidenceFloorLocked(state: {
  readonly saved: number | null;
  readonly saving: boolean;
  readonly refreshing: boolean;
}): boolean {
  return state.saved === null || state.saving || state.refreshing;
}
