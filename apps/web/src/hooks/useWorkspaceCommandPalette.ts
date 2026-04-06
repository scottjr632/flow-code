import { useEffect, useState } from "react";

import {
  isWorkspaceCommandPaletteShortcut,
  OPEN_WORKSPACE_COMMAND_PALETTE_EVENT,
} from "~/workspaceCommandPaletteShortcuts";

export function useWorkspaceCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const openPalette = () => {
      setIsOpen(true);
    };

    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }
      if (!isWorkspaceCommandPaletteShortcut(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openPalette();
    };

    window.addEventListener("keydown", onWindowKeyDown);
    window.addEventListener(OPEN_WORKSPACE_COMMAND_PALETTE_EVENT, openPalette);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      window.removeEventListener(OPEN_WORKSPACE_COMMAND_PALETTE_EVENT, openPalette);
    };
  }, []);

  return {
    isOpen,
    setIsOpen,
  };
}
