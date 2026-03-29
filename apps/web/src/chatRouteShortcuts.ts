export function shouldBypassChatRouteShortcut(
  pathname: string,
  command: string | null | undefined,
): boolean {
  return pathname === "/" && (command === "chat.new" || command === "chat.newLocal");
}
