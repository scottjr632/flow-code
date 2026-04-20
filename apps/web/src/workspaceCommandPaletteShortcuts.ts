export const OPEN_WORKSPACE_COMMAND_PALETTE_EVENT = "flow:open-workspace-command-palette";
export const OPEN_WORKSPACE_FILE_PALETTE_EVENT = "flow:open-workspace-file-palette";

interface WorkspaceCommandPaletteShortcutEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function isWorkspaceCommandPaletteShortcut(
  event: WorkspaceCommandPaletteShortcutEventLike,
): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return false;
  }

  return event.key.toLowerCase() === "k";
}

export function isWorkspaceFilePaletteShortcut(
  event: WorkspaceCommandPaletteShortcutEventLike,
): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return false;
  }

  return event.key.toLowerCase() === "p";
}

export function dispatchWorkspaceCommandPaletteOpen(): void {
  window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_COMMAND_PALETTE_EVENT));
}

export function dispatchWorkspaceFilePaletteOpen(): void {
  window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_FILE_PALETTE_EVENT));
}
