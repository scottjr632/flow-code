/**
 * React hook that progressively hydrates partial `FileDiffMetadata` objects
 * by fetching the current file contents from disk.  Once a file's content is
 * available, the corresponding diff is hydrated (setting `isPartial = false`)
 * so the `@pierre/diffs` library enables inline hunk expansion.
 *
 * Files that are deleted, binary, or too large are returned as-is (still
 * partial).
 */

import type { FileDiffMetadata } from "@pierre/diffs/react";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { hydrateFileDiff } from "~/lib/diffHydration";
import { projectReadFileQueryOptions } from "~/lib/projectReactQuery";
import { resolveReviewFilePath } from "~/lib/reviewDiffFiles";

/**
 * For each file in `fileDiffs`, fetches the current file content from disk
 * and returns a hydrated copy with full-file `additionLines` /
 * `deletionLines` so hunk expansion works.
 *
 * While the file content is loading, the original (partial) diff is returned.
 */
export function useHydratedFileDiffs(
  fileDiffs: FileDiffMetadata[],
  cwd: string | undefined,
): FileDiffMetadata[] {
  // Build one read-file query per diff file that can be hydrated.
  const queries = useMemo(
    () =>
      fileDiffs.map((fileDiff) => {
        const canHydrate =
          fileDiff.isPartial &&
          fileDiff.hunks.length > 0 &&
          fileDiff.type !== "deleted" &&
          fileDiff.type !== "rename-pure";

        return projectReadFileQueryOptions({
          cwd: cwd ?? null,
          relativePath: canHydrate ? resolveReviewFilePath(fileDiff) : "",
          enabled: canHydrate && cwd != null,
        });
      }),
    [fileDiffs, cwd],
  );

  const fileQueries = useQueries({ queries });

  return useMemo(() => {
    return fileDiffs.map((fileDiff, index) => {
      const query = fileQueries[index];
      if (!query || !query.data) return fileDiff;

      const { contents, binary, tooLarge } = query.data;
      if (binary || tooLarge || contents.length === 0) return fileDiff;

      return hydrateFileDiff(fileDiff, contents);
    });
  }, [fileDiffs, fileQueries]);
}
