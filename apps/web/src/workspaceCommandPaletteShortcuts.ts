export const OPEN_WORKSPACE_COMMAND_PALETTE_EVENT = "flow:open-workspace-command-palette";

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

  const key = event.key.toLowerCase();
  return key === "k" || key === "p";
}

export function dispatchWorkspaceCommandPaletteOpen(): void {
  window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_COMMAND_PALETTE_EVENT));
}
