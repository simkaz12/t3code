import { create } from "zustand";

const MAX_COMMAND_LENGTH = 65_535;
const DISALLOWED_CHARACTERS = /[^\P{Cc}\n]|\p{Cf}/u;

export function prepareSelectionCommand(raw: string): string | null {
  const command = raw.replace(/\r\n?/g, "\n").trim();
  if (command.length === 0 || command.length > MAX_COMMAND_LENGTH) return null;
  if (DISALLOWED_CHARACTERS.test(command)) return null;
  return command;
}

export const useAssistantSelectionRunStore = create<{
  pending: string | null;
  setPending: (text: string | null) => void;
}>((set) => ({
  pending: null,
  setPending: (text) => set({ pending: text }),
}));
