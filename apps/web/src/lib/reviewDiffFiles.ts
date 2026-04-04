import type { FileDiffMetadata } from "@pierre/diffs/react";

import type { TurnDiffFileChange } from "../types";

export function resolveReviewFilePath(
  fileDiff: Pick<FileDiffMetadata, "name" | "prevName">,
): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

export function buildReviewFileRenderKey(
  fileDiff: Pick<FileDiffMetadata, "cacheKey" | "name" | "prevName">,
): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

export function summarizeReviewFileDiff(fileDiff: Pick<FileDiffMetadata, "hunks">): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;

  for (const hunk of fileDiff.hunks) {
    for (const segment of hunk.hunkContent) {
      if (segment.type === "context") {
        continue;
      }
      additions += segment.additions;
      deletions += segment.deletions;
    }
  }

  return { additions, deletions };
}

export function toReviewFileTreeEntries(
  fileDiffs: ReadonlyArray<FileDiffMetadata>,
): TurnDiffFileChange[] {
  return fileDiffs.map((fileDiff) => {
    const stat = summarizeReviewFileDiff(fileDiff);
    return {
      path: resolveReviewFilePath(fileDiff),
      ...(stat.additions > 0 ? { additions: stat.additions } : {}),
      ...(stat.deletions > 0 ? { deletions: stat.deletions } : {}),
      kind: fileDiff.type,
    } satisfies TurnDiffFileChange;
  });
}
