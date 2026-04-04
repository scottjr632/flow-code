import type { FileDiffMetadata } from "@pierre/diffs/react";
import { describe, expect, it } from "vitest";

import {
  buildReviewFileRenderKey,
  resolveReviewFilePath,
  summarizeReviewFileDiff,
  toReviewFileTreeEntries,
} from "./reviewDiffFiles";

function createFileDiff(overrides: Partial<FileDiffMetadata> = {}): FileDiffMetadata {
  return {
    name: "src/app.ts",
    type: "change",
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
    ...overrides,
  };
}

function createHunkContent(
  content: ReadonlyArray<{
    type: "context" | "change";
    lines?: number;
    additions?: number;
    deletions?: number;
    additionLineIndex: number;
    deletionLineIndex: number;
  }>,
): FileDiffMetadata["hunks"] {
  return [
    {
      collapsedBefore: 0,
      additionStart: 1,
      additionCount: 3,
      additionLines: 3,
      additionLineIndex: 0,
      deletionStart: 1,
      deletionCount: 2,
      deletionLines: 2,
      deletionLineIndex: 0,
      hunkContent: content.map((segment) =>
        segment.type === "context"
          ? {
              type: "context" as const,
              lines: segment.lines ?? 0,
              additionLineIndex: segment.additionLineIndex,
              deletionLineIndex: segment.deletionLineIndex,
            }
          : {
              type: "change" as const,
              additions: segment.additions ?? 0,
              deletions: segment.deletions ?? 0,
              additionLineIndex: segment.additionLineIndex,
              deletionLineIndex: segment.deletionLineIndex,
            },
      ),
      splitLineStart: 0,
      splitLineCount: 0,
      unifiedLineStart: 0,
      unifiedLineCount: 0,
      noEOFCRDeletions: false,
      noEOFCRAdditions: false,
    },
  ];
}

describe("reviewDiffFiles", () => {
  it("normalizes git patch prefixes in file paths", () => {
    expect(resolveReviewFilePath(createFileDiff({ name: "b/apps/web/src/app.tsx" }))).toBe(
      "apps/web/src/app.tsx",
    );
  });

  it("uses cache keys when available", () => {
    expect(buildReviewFileRenderKey(createFileDiff({ cacheKey: "cached:file" }))).toBe(
      "cached:file",
    );
  });

  it("sums additions and deletions across every hunk segment", () => {
    const stat = summarizeReviewFileDiff(
      createFileDiff({
        hunks: createHunkContent([
          {
            type: "context",
            lines: 1,
            additionLineIndex: 0,
            deletionLineIndex: 0,
          },
          {
            type: "change",
            additions: 2,
            deletions: 0,
            additionLineIndex: 1,
            deletionLineIndex: 1,
          },
          {
            type: "change",
            additions: 0,
            deletions: 1,
            additionLineIndex: 3,
            deletionLineIndex: 1,
          },
        ]),
      }),
    );

    expect(stat).toEqual({ additions: 2, deletions: 1 });
  });

  it("maps parsed file diffs into file tree entries", () => {
    expect(
      toReviewFileTreeEntries([
        createFileDiff({
          name: "b/src/renamed.ts",
          prevName: "a/src/old.ts",
          type: "rename-changed",
          hunks: createHunkContent([
            {
              type: "change",
              additions: 1,
              deletions: 0,
              additionLineIndex: 0,
              deletionLineIndex: 0,
            },
          ]),
        }),
      ]),
    ).toEqual([
      {
        path: "src/renamed.ts",
        additions: 1,
        kind: "rename-changed",
      },
    ]);
  });
});
