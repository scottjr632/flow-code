import { useEffect, useState } from "react";

interface WorkspacePaletteShortcutEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  stopPropagation?: () => void;
  preventDefault?: () => void;
}

export function useWorkspacePaletteState(input: {
  readonly isShortcut: (event: WorkspacePaletteShortcutEventLike) => boolean;
  readonly openEvent: string;
}) {
  const { isShortcut, openEvent } = input;
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const openPalette = () => {
      setIsOpen(true);
    };

    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }
      if (!isShortcut(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openPalette();
    };

    window.addEventListener("keydown", onWindowKeyDown);
    window.addEventListener(openEvent, openPalette);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      window.removeEventListener(openEvent, openPalette);
    };
  }, [isShortcut, openEvent]);

  return {
    isOpen,
    setIsOpen,
  };
}
