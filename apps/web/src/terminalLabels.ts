import { DEFAULT_THREAD_TERMINAL_ID } from "./types";

export const DEFAULT_TERMINAL_LABEL = "Terminal";

function normalizeTerminalIds(terminalIds: readonly string[]): string[] {
  const normalized = [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  return normalized.length > 0 ? normalized : [DEFAULT_THREAD_TERMINAL_ID];
}

export function defaultTerminalLabelForIndex(index: number): string {
  return `${DEFAULT_TERMINAL_LABEL} ${index + 1}`;
}

export function normalizeTerminalName(name: string | null | undefined): string | null {
  if (typeof name !== "string") {
    return null;
  }
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildTerminalLabelById(
  terminalIds: readonly string[],
  terminalNamesById: Readonly<Record<string, string>> = {},
): Map<string, string> {
  const normalizedTerminalIds = normalizeTerminalIds(terminalIds);
  return new Map(
    normalizedTerminalIds.map((terminalId, index) => [
      terminalId,
      normalizeTerminalName(terminalNamesById[terminalId]) ?? defaultTerminalLabelForIndex(index),
    ]),
  );
}

export function resolveTerminalGroupTitle(input: {
  groupIndex: number;
  terminalIds: readonly string[];
  allTerminalIds: readonly string[];
  terminalNamesById?: Readonly<Record<string, string>>;
  groupCount: number;
}): string {
  const { groupIndex, terminalIds, allTerminalIds, terminalNamesById = {}, groupCount } = input;
  const splitCount = terminalIds.length;
  const primaryTerminalId = terminalIds[0];
  const customPrimaryName =
    primaryTerminalId === undefined
      ? null
      : normalizeTerminalName(terminalNamesById[primaryTerminalId]);

  const baseTitle =
    customPrimaryName ??
    (groupCount <= 1 ? DEFAULT_TERMINAL_LABEL : defaultTerminalLabelForIndex(groupIndex));

  if (splitCount > 1) {
    return `${baseTitle} (${splitCount})`;
  }

  if (customPrimaryName) {
    return customPrimaryName;
  }

  if (groupCount <= 1) {
    const labelById = buildTerminalLabelById(allTerminalIds, terminalNamesById);
    if (primaryTerminalId && labelById.get(primaryTerminalId) === defaultTerminalLabelForIndex(0)) {
      return DEFAULT_TERMINAL_LABEL;
    }
  }

  return baseTitle;
}
