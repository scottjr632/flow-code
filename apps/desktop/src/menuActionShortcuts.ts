export type DesktopMenuAction =
  | "open-settings"
  | "thread-next"
  | "thread-previous"
  | "thread-traversal-end";

interface ShortcutLikeInput {
  type: string;
  key?: string;
  control?: boolean;
  shift?: boolean;
}

export function resolveDesktopMenuActionForInput(
  input: ShortcutLikeInput,
): DesktopMenuAction | null {
  const normalizedKey = input.key?.toLowerCase();
  if (
    input.type === "keyUp" &&
    input.control !== true &&
    (normalizedKey === "control" || normalizedKey === "tab")
  ) {
    return "thread-traversal-end";
  }

  if (input.type !== "keyDown") {
    return null;
  }

  if (normalizedKey !== "tab" || input.control !== true) {
    return null;
  }

  return input.shift === true ? "thread-previous" : "thread-next";
}
