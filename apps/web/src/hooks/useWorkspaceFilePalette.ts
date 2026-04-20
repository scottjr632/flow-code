import {
  isWorkspaceFilePaletteShortcut,
  OPEN_WORKSPACE_FILE_PALETTE_EVENT,
} from "~/workspaceCommandPaletteShortcuts";
import { useWorkspacePaletteState } from "./useWorkspacePaletteState";

export function useWorkspaceFilePalette() {
  return useWorkspacePaletteState({
    isShortcut: isWorkspaceFilePaletteShortcut,
    openEvent: OPEN_WORKSPACE_FILE_PALETTE_EVENT,
  });
}
