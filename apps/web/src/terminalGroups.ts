import { type ThreadTerminalGroup } from "./types";

export function terminalGroupIdForTerminal(terminalId: string): string {
  return `group-${terminalId}`;
}

export function findTerminalGroupByTerminalId(
  terminalGroups: readonly ThreadTerminalGroup[],
  terminalId: string,
): ThreadTerminalGroup | undefined {
  return terminalGroups.find((group) => group.terminalIds.includes(terminalId));
}
