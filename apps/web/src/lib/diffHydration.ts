/**
 * Hydrates a partial `FileDiffMetadata` (parsed from a patch string without
 * full file contents) into a non-partial one so that the `@pierre/diffs`
 * library enables inline hunk expansion ("N unmodified lines" separators
 * become clickable).
 *
 * The library gates expansion behind `isPartial === false`, which requires
 * `additionLines` / `deletionLines` to contain the **complete** file
 * contents indexed by absolute line number.  When a patch is parsed with
 * `parsePatchFiles()` alone, the metadata is partial and those arrays only
 * hold the lines that appear within hunks.
 *
 * This module reconstructs the full old-file lines from the new file
 * (read from disk) and the diff hunk data, then re-indexes all hunk /
 * hunkContent entries so that their `additionLineIndex` / `deletionLineIndex`
 * values are absolute rather than sequential.
 */

import type { FileDiffMetadata } from "@pierre/diffs/react";

// ---------------------------------------------------------------------------
// SPLIT_WITH_NEWLINES keeps trailing newlines on each element, matching the
// splitting strategy used internally by @pierre/diffs.
// ---------------------------------------------------------------------------
const SPLIT_WITH_NEWLINES = /(?<=\n)/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a non-partial copy of `partial` by populating full-file
 * `additionLines` / `deletionLines` and re-indexing all hunks.
 *
 * `newFileContent` should be the raw text of the **new** file version (i.e.
 * the file as it exists on disk for unstaged / checkpoint diffs).
 *
 * If the diff cannot be hydrated (e.g. deleted file, or line-count
 * inconsistency) the original partial is returned unchanged.
 */
export function hydrateFileDiff(
  partial: FileDiffMetadata,
  newFileContent: string,
): FileDiffMetadata {
  if (!partial.isPartial) return partial;
  if (partial.hunks.length === 0) return partial;

  const newFileLines = newFileContent.split(SPLIT_WITH_NEWLINES);

  // Sanity-check: the last hunk should not reference lines beyond the file.
  const lastHunk = partial.hunks[partial.hunks.length - 1]!;
  const expectedMinNewLines = lastHunk.additionStart + lastHunk.additionCount - 1;
  if (newFileLines.length < expectedMinNewLines) {
    // The file on disk doesn't match the diff – skip hydration.
    return partial;
  }

  const oldFileLines = reconstructOldFileLines(partial, newFileLines);
  const hunks = reindexHunks(partial.hunks);

  // Recompute the top-level line counts to include the trailing collapsed
  // region that appears after the last hunk (only relevant for non-partial).
  let { splitLineCount, unifiedLineCount } = partial;
  if (oldFileLines.length > 0 && newFileLines.length > 0) {
    const lastReindexedHunk = hunks[hunks.length - 1]!;
    const lastHunkEnd = lastReindexedHunk.additionStart + lastReindexedHunk.additionCount - 1;
    const collapsedAfter = Math.max(newFileLines.length - lastHunkEnd, 0);
    splitLineCount += collapsedAfter;
    unifiedLineCount += collapsedAfter;
  }

  return {
    ...partial,
    isPartial: false,
    additionLines: newFileLines,
    deletionLines: oldFileLines,
    hunks,
    splitLineCount,
    unifiedLineCount,
    // Invalidate the worker-pool cache so the library re-highlights with the
    // new (complete) line arrays.  Omit the key entirely when the original
    // diff had none so that `exactOptionalPropertyTypes` stays happy.
    ...(partial.cacheKey != null ? { cacheKey: `${partial.cacheKey}:hydrated` } : {}),
  };
}

// ---------------------------------------------------------------------------
// Old-file reconstruction
// ---------------------------------------------------------------------------

/**
 * Walks through the parsed hunks and the new-file lines to reconstruct the
 * old-file line array.
 *
 * Between hunks the lines are unchanged (identical in old and new), so we
 * simply copy from `newFileLines`.  Within each hunk we copy context lines
 * from the new file and swap additions for deletions (the deletion text is
 * available in `partial.deletionLines` at sequential indexes).
 */
function reconstructOldFileLines(partial: FileDiffMetadata, newFileLines: string[]): string[] {
  const oldFileLines: string[] = [];
  let newCursor = 0; // 0-based position in newFileLines

  for (const hunk of partial.hunks) {
    // ── Unchanged lines before this hunk ──
    const hunkNewStart = hunk.additionStart - 1; // 0-based
    while (newCursor < hunkNewStart && newCursor < newFileLines.length) {
      oldFileLines.push(newFileLines[newCursor]!);
      newCursor++;
    }

    // ── Walk the hunk's content segments ──
    for (const segment of hunk.hunkContent) {
      if (segment.type === "context") {
        for (let i = 0; i < segment.lines; i++) {
          oldFileLines.push(newFileLines[newCursor] ?? "");
          newCursor++;
        }
      } else {
        // Change block: emit deletion lines (from the partial array) and
        // skip the corresponding addition lines in the new file.
        for (let i = 0; i < segment.deletions; i++) {
          oldFileLines.push(partial.deletionLines[segment.deletionLineIndex + i] ?? "");
        }
        newCursor += segment.additions;
      }
    }
  }

  // ── Remaining lines after the last hunk ──
  while (newCursor < newFileLines.length) {
    oldFileLines.push(newFileLines[newCursor]!);
    newCursor++;
  }

  return oldFileLines;
}

// ---------------------------------------------------------------------------
// Hunk re-indexing (sequential → absolute)
// ---------------------------------------------------------------------------

/**
 * Returns a shallow copy of each hunk (and its hunkContent entries) with
 * `additionLineIndex` / `deletionLineIndex` converted from the sequential
 * values used in partial mode to the absolute 0-based values expected when
 * `isPartial === false`.
 */
function reindexHunks(hunks: FileDiffMetadata["hunks"]): FileDiffMetadata["hunks"] {
  return hunks.map((hunk) => {
    let delIdx = hunk.deletionStart - 1;
    let addIdx = hunk.additionStart - 1;

    const hunkContent = hunk.hunkContent.map((segment) => {
      if (segment.type === "context") {
        const reindexed = { ...segment, deletionLineIndex: delIdx, additionLineIndex: addIdx };
        delIdx += segment.lines;
        addIdx += segment.lines;
        return reindexed;
      }

      // Change segment
      const reindexed = { ...segment, deletionLineIndex: delIdx, additionLineIndex: addIdx };
      delIdx += segment.deletions;
      addIdx += segment.additions;
      return reindexed;
    });

    return {
      ...hunk,
      additionLineIndex: hunk.additionStart - 1,
      deletionLineIndex: hunk.deletionStart - 1,
      hunkContent,
    };
  });
}
