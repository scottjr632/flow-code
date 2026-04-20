import {
  isWorkspaceCommandPaletteShortcut,
  OPEN_WORKSPACE_COMMAND_PALETTE_EVENT,
} from "~/workspaceCommandPaletteShortcuts";
import { useWorkspacePaletteState } from "./useWorkspacePaletteState";

export function useWorkspaceCommandPalette() {
  return useWorkspacePaletteState({
    isShortcut: isWorkspaceCommandPaletteShortcut,
    openEvent: OPEN_WORKSPACE_COMMAND_PALETTE_EVENT,
  });
}
