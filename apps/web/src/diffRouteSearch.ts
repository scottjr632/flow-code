import { TurnId } from "@t3tools/contracts";

export type DiffSelection = "staged" | "unstaged";

export interface DiffRouteSearch {
  diff?: "1" | undefined;
  diffSelection?: DiffSelection | undefined;
  diffTurnId?: TurnId | undefined;
  diffFilePath?: string | undefined;
}

function isDiffOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function stripDiffSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "diff" | "diffSelection" | "diffTurnId" | "diffFilePath"> {
  const {
    diff: _diff,
    diffSelection: _diffSelection,
    diffTurnId: _diffTurnId,
    diffFilePath: _diffFilePath,
    ...rest
  } = params;
  return rest as Omit<T, "diff" | "diffSelection" | "diffTurnId" | "diffFilePath">;
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const diff = isDiffOpenValue(search.diff) ? "1" : undefined;
  const diffSelectionRaw = diff ? normalizeSearchString(search.diffSelection) : undefined;
  const diffSelection =
    diffSelectionRaw === "staged" || diffSelectionRaw === "unstaged" ? diffSelectionRaw : undefined;
  const diffTurnIdRaw = diff ? normalizeSearchString(search.diffTurnId) : undefined;
  const diffTurnId =
    diffSelection === undefined && diffTurnIdRaw ? TurnId.makeUnsafe(diffTurnIdRaw) : undefined;
  const diffFilePath = diff ? normalizeSearchString(search.diffFilePath) : undefined;

  return {
    ...(diff ? { diff } : {}),
    ...(diffSelection ? { diffSelection } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
  };
}
