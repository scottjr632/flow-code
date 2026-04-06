import type { KeybindingShortcut, TurnId } from "@t3tools/contracts";
import { formatShortcutLabel, type ShortcutEventLike } from "../keybindings";
import { matchesModEnterShortcut } from "../lib/utils";
import type { TurnDiffSummary } from "../types";

const REVIEW_COMMENT_SUBMIT_SHORTCUT: KeybindingShortcut = {
  key: "enter",
  modKey: true,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
};

export function formatReviewCommentSubmitShortcutLabel(platform = navigator.platform): string {
  return formatShortcutLabel(REVIEW_COMMENT_SUBMIT_SHORTCUT, platform);
}

export function matchesReviewCommentSubmitShortcut(
  event: ShortcutEventLike & {
    defaultPrevented?: boolean;
    nativeEvent?: {
      isComposing?: boolean;
    };
  },
  platform = navigator.platform,
): boolean {
  return matchesModEnterShortcut(event, platform);
}

export function getDiffCommentComposerKey(
  selection: {
    filePath: string;
    side: string;
    lineStart: number;
    lineEnd: number;
  } | null,
): string | null {
  if (!selection) {
    return null;
  }

  return `${selection.filePath}:${selection.side}:${selection.lineStart}:${selection.lineEnd}`;
}

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
