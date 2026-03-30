import type { TurnId } from "@t3tools/contracts";
import type { TurnDiffSummary } from "../types";

export function resolveTurnChipLabel(
  summary: TurnDiffSummary,
  latestTurnId: TurnId | null,
  inferredCheckpointTurnCountByTurnId: Record<TurnId, number>,
): string {
  if (summary.turnId === latestTurnId) {
    return "Last turn";
  }

  const checkpointTurnCount =
    summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
  return `Turn ${checkpointTurnCount ?? "?"}`;
}

export function toggleCollapsedFileKey(
  collapsedFileKeys: ReadonlySet<string>,
  fileKey: string,
): ReadonlySet<string> {
  const nextCollapsedFileKeys = new Set(collapsedFileKeys);
  if (nextCollapsedFileKeys.has(fileKey)) {
    nextCollapsedFileKeys.delete(fileKey);
  } else {
    nextCollapsedFileKeys.add(fileKey);
  }
  return nextCollapsedFileKeys;
}

export function expandCollapsedFileKey(
  collapsedFileKeys: ReadonlySet<string>,
  fileKey: string | null,
): ReadonlySet<string> {
  if (!fileKey || !collapsedFileKeys.has(fileKey)) {
    return collapsedFileKeys;
  }

  const nextCollapsedFileKeys = new Set(collapsedFileKeys);
  nextCollapsedFileKeys.delete(fileKey);
  return nextCollapsedFileKeys;
}
