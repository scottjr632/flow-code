/**
 * Zustand store for workspace-level terminal panel visibility and height.
 *
 * The actual terminal tab/group state is managed by the shared
 * `terminalStateStore` under the `WORKSPACE_TERMINAL_OWNER_ID` sentinel key.
 * This store only controls the panel open/closed state and its height.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";

const STORAGE_KEY = "flow:workspace-terminal:v1";

interface WorkspaceTerminalState {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

function createStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

export const useWorkspaceTerminalStore = create<WorkspaceTerminalState>()(
  persist(
    (set) => ({
      isOpen: false,
      setOpen: (open) => set({ isOpen: open }),
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(createStorage),
      partialize: (state) => ({ isOpen: state.isOpen }),
    },
  ),
);
