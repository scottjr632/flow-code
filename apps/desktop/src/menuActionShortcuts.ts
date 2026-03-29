export type DesktopMenuAction = "open-settings" | "thread-next" | "thread-previous";

interface ShortcutLikeInput {
  type: string;
  key?: string;
  control?: boolean;
  shift?: boolean;
}

export function resolveDesktopMenuActionForInput(
  input: ShortcutLikeInput,
): DesktopMenuAction | null {
  if (input.type !== "keyDown") {
    return null;
  }

  const normalizedKey = input.key?.toLowerCase();
  if (normalizedKey !== "tab" || input.control !== true) {
    return null;
  }

  return input.shift === true ? "thread-previous" : "thread-next";
}
