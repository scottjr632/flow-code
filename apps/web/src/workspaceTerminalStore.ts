/**
 * Zustand store for the global bottom terminal panel target/visibility.
 *
 * The actual terminal tab/group state is managed by the shared
 * `terminalStateStore` under synthetic terminal owner ids. This store tracks
 * which project the panel currently targets and whether the panel is visible.
 */

import type { ProjectId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";

const STORAGE_KEY = "flow:workspace-terminal:v1";

interface WorkspaceTerminalState {
  isOpen: boolean;
  projectId: ProjectId | null;
  setOpen: (open: boolean, projectId?: ProjectId | null) => void;
  openForProject: (projectId: ProjectId) => void;
  toggle: (projectId?: ProjectId | null) => void;
}

function createStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

export const useWorkspaceTerminalStore = create<WorkspaceTerminalState>()(
  persist(
    (set) => ({
      isOpen: false,
      projectId: null,
      setOpen: (open, projectId) =>
        set((state) => ({
          isOpen: open,
          projectId: projectId === undefined ? state.projectId : projectId,
        })),
      openForProject: (projectId) => set({ isOpen: true, projectId }),
      toggle: (projectId) =>
        set((state) => {
          const nextProjectId = projectId ?? state.projectId;
          if (nextProjectId !== null && nextProjectId !== state.projectId) {
            return { isOpen: true, projectId: nextProjectId };
          }
          return {
            isOpen: !state.isOpen,
            projectId: nextProjectId,
          };
        }),
    }),
    {
      name: STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(createStorage),
      partialize: (state) => ({ isOpen: state.isOpen, projectId: state.projectId }),
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== "object") {
          return { isOpen: false, projectId: null };
        }
        const candidate = persistedState as { isOpen?: unknown; projectId?: unknown };
        return {
          isOpen: candidate.isOpen === true,
          projectId:
            typeof candidate.projectId === "string" ? (candidate.projectId as ProjectId) : null,
        };
      },
    },
  ),
);
