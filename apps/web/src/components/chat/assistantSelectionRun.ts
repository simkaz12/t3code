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
  owner: string | null;
  setPending: (text: string | null, owner?: string | null) => void;
  clearPending: (owner: string) => void;
}>((set) => ({
  pending: null,
  owner: null,
  setPending: (text, owner = null) => set({ pending: text, owner: text === null ? null : owner }),
  clearPending: (owner) =>
    set((state) => (state.owner === owner ? { pending: null, owner: null } : state)),
}));
