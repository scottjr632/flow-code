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
