import { parsePatchFiles } from "@pierre/diffs";
import { describe, expect, it } from "vitest";

import { hydrateFileDiff } from "./diffHydration";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal git-format patch string from structured data.
 */
function makePatch(
  fileName: string,
  hunks: {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: string;
  }[],
): string {
  const header = [
    `diff --git a/${fileName} b/${fileName}`,
    `--- a/${fileName}`,
    `+++ b/${fileName}`,
  ].join("\n");

  const hunkTexts = hunks.map(
    (h) => `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@\n${h.lines}`,
  );

  return `${header}\n${hunkTexts.join("\n")}`;
}

function parseFirstFile(patch: string) {
  const parsed = parsePatchFiles(patch);
  return parsed[0]!.files[0]!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hydrateFileDiff", () => {
  it("returns the original diff when already non-partial", () => {
    const patch = makePatch("foo.ts", [
      { oldStart: 1, oldCount: 3, newStart: 1, newCount: 3, lines: " a\n-b\n+c\n d\n" },
    ]);
    const partial = parseFirstFile(patch);
    // Manually mark as non-partial to test the early return
    const nonPartial = { ...partial, isPartial: false as const };
    const result = hydrateFileDiff(nonPartial, "a\nc\nd\n");
    expect(result).toBe(nonPartial);
  });

  it("returns the original diff when file has no hunks", () => {
    const patch = makePatch("foo.ts", [
      { oldStart: 1, oldCount: 3, newStart: 1, newCount: 3, lines: " a\n-b\n+c\n d\n" },
    ]);
    const partial = parseFirstFile(patch);
    const noHunks = { ...partial, hunks: [] };
    const result = hydrateFileDiff(noHunks, "a\nc\nd\n");
    expect(result).toBe(noHunks);
  });

  it("hydrates a single-hunk diff correctly", () => {
    // Old file: line1 / line2 / OLD / line4 / line5
    // New file: line1 / line2 / NEW / line4 / line5
    const patch = makePatch("test.ts", [
      {
        oldStart: 2,
        oldCount: 3,
        newStart: 2,
        newCount: 3,
        lines: " line2\n-OLD\n+NEW\n line4\n",
      },
    ]);

    const partial = parseFirstFile(patch);
    expect(partial.isPartial).toBe(true);
    expect(partial.additionLines.length).toBeGreaterThan(0);

    const newFileContent = "line1\nline2\nNEW\nline4\nline5\n";
    const hydrated = hydrateFileDiff(partial, newFileContent);

    expect(hydrated.isPartial).toBe(false);

    // additionLines should be the full new file
    expect(hydrated.additionLines).toEqual(["line1\n", "line2\n", "NEW\n", "line4\n", "line5\n"]);

    // deletionLines should be the reconstructed old file
    expect(hydrated.deletionLines).toEqual(["line1\n", "line2\n", "OLD\n", "line4\n", "line5\n"]);

    // Hunk indexes should be absolute
    const hunk = hydrated.hunks[0]!;
    expect(hunk.additionLineIndex).toBe(1); // additionStart=2, 0-based=1
    expect(hunk.deletionLineIndex).toBe(1); // deletionStart=2, 0-based=1
  });

  it("hydrates a multi-hunk diff with gap between hunks", () => {
    // Old file:
    //   1: header
    //   2: line2
    //   3: OLD_A
    //   4: line4
    //   5: gap1  (not in patch)
    //   6: gap2  (not in patch)
    //   7: line7
    //   8: OLD_B
    //   9: line9
    //  10: footer
    //
    // New file:
    //   1: header
    //   2: line2
    //   3: NEW_A
    //   4: line4
    //   5: gap1
    //   6: gap2
    //   7: line7
    //   8: NEW_B
    //   9: line9
    //  10: footer
    const patch = makePatch("multi.ts", [
      {
        oldStart: 2,
        oldCount: 3,
        newStart: 2,
        newCount: 3,
        lines: " line2\n-OLD_A\n+NEW_A\n line4\n",
      },
      {
        oldStart: 7,
        oldCount: 3,
        newStart: 7,
        newCount: 3,
        lines: " line7\n-OLD_B\n+NEW_B\n line9\n",
      },
    ]);

    const partial = parseFirstFile(patch);
    expect(partial.isPartial).toBe(true);

    const newFileContent = "header\nline2\nNEW_A\nline4\ngap1\ngap2\nline7\nNEW_B\nline9\nfooter\n";
    const hydrated = hydrateFileDiff(partial, newFileContent);

    expect(hydrated.isPartial).toBe(false);

    // The old file should have the gap lines (unchanged) and the old changed lines
    expect(hydrated.deletionLines).toEqual([
      "header\n",
      "line2\n",
      "OLD_A\n",
      "line4\n",
      "gap1\n",
      "gap2\n",
      "line7\n",
      "OLD_B\n",
      "line9\n",
      "footer\n",
    ]);

    // Verify hunk indexes are absolute
    const hunk0 = hydrated.hunks[0]!;
    expect(hunk0.additionLineIndex).toBe(1); // line 2, 0-based=1
    expect(hunk0.deletionLineIndex).toBe(1);

    const hunk1 = hydrated.hunks[1]!;
    expect(hunk1.additionLineIndex).toBe(6); // line 7, 0-based=6
    expect(hunk1.deletionLineIndex).toBe(6);
  });

  it("handles a diff with additions only (more lines in new file)", () => {
    // Old file: a / b / c
    // New file: a / b / X / Y / c
    const patch = makePatch("add.ts", [
      {
        oldStart: 2,
        oldCount: 2,
        newStart: 2,
        newCount: 4,
        lines: " b\n+X\n+Y\n c\n",
      },
    ]);

    const partial = parseFirstFile(patch);
    const newFileContent = "a\nb\nX\nY\nc\n";
    const hydrated = hydrateFileDiff(partial, newFileContent);

    expect(hydrated.isPartial).toBe(false);
    expect(hydrated.additionLines).toEqual(["a\n", "b\n", "X\n", "Y\n", "c\n"]);
    expect(hydrated.deletionLines).toEqual(["a\n", "b\n", "c\n"]);
  });

  it("handles a diff with deletions only (fewer lines in new file)", () => {
    // Old file: a / b / X / Y / c
    // New file: a / b / c
    const patch = makePatch("del.ts", [
      {
        oldStart: 2,
        oldCount: 4,
        newStart: 2,
        newCount: 2,
        lines: " b\n-X\n-Y\n c\n",
      },
    ]);

    const partial = parseFirstFile(patch);
    const newFileContent = "a\nb\nc\n";
    const hydrated = hydrateFileDiff(partial, newFileContent);

    expect(hydrated.isPartial).toBe(false);
    expect(hydrated.additionLines).toEqual(["a\n", "b\n", "c\n"]);
    expect(hydrated.deletionLines).toEqual(["a\n", "b\n", "X\n", "Y\n", "c\n"]);
  });

  it("returns original when file on disk is shorter than expected", () => {
    const patch = makePatch("mismatch.ts", [
      {
        oldStart: 5,
        oldCount: 3,
        newStart: 5,
        newCount: 3,
        lines: " x\n-old\n+new\n z\n",
      },
    ]);

    const partial = parseFirstFile(patch);
    // File is only 3 lines, but hunk expects at least 7
    const result = hydrateFileDiff(partial, "a\nb\nc\n");
    expect(result).toBe(partial); // unchanged – too short
  });

  it("includes trailing collapsed lines in splitLineCount / unifiedLineCount", () => {
    // Hunk covers lines 1-3 of a 10-line file
    const patch = makePatch("trailing.ts", [
      {
        oldStart: 1,
        oldCount: 3,
        newStart: 1,
        newCount: 3,
        lines: " line1\n-old\n+new\n line3\n",
      },
    ]);

    const partial = parseFirstFile(patch);
    const newFileContent = Array.from({ length: 10 }, (_, i) =>
      i === 1 ? "new\n" : `line${i + 1}\n`,
    ).join("");

    const hydrated = hydrateFileDiff(partial, newFileContent);
    // The trailing region (lines 4-10 = 7 lines) should be added
    expect(hydrated.splitLineCount).toBe(partial.splitLineCount + 7);
    expect(hydrated.unifiedLineCount).toBe(partial.unifiedLineCount + 7);
  });

  it("updates cacheKey when original has one", () => {
    const patch = makePatch("cached.ts", [
      { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: "-old\n+new\n" },
    ]);

    const partial = parseFirstFile(patch);
    const withKey = { ...partial, cacheKey: "test-key" };
    const hydrated = hydrateFileDiff(withKey, "new\n");
    expect(hydrated.cacheKey).toBe("test-key:hydrated");
  });

  it("re-indexes hunkContent segments to absolute positions", () => {
    const patch = makePatch("reindex.ts", [
      {
        oldStart: 5,
        oldCount: 5,
        newStart: 5,
        newCount: 6,
        lines: " ctx1\n ctx2\n-old1\n-old2\n+new1\n+new2\n+new3\n ctx3\n",
      },
    ]);

    const partial = parseFirstFile(patch);
    const newFileContent = "h1\nh2\nh3\nh4\nctx1\nctx2\nnew1\nnew2\nnew3\nctx3\nfooter\n";
    const hydrated = hydrateFileDiff(partial, newFileContent);

    const hunk = hydrated.hunks[0]!;

    // First content segment is context (ctx1, ctx2) starting at absolute line 5 (0-based: 4)
    const seg0 = hunk.hunkContent[0]!;
    expect(seg0.type).toBe("context");
    expect(seg0.additionLineIndex).toBe(4);
    expect(seg0.deletionLineIndex).toBe(4);

    // Second content segment is change block starting at absolute position 6 (0-based)
    const seg1 = hunk.hunkContent[1]!;
    expect(seg1.type).toBe("change");
    expect(seg1.additionLineIndex).toBe(6);
    expect(seg1.deletionLineIndex).toBe(6);

    // Third content segment is context (ctx3)
    const seg2 = hunk.hunkContent[2]!;
    expect(seg2.type).toBe("context");
    // After the change: deletion advanced by 2, addition by 3
    expect(seg2.deletionLineIndex).toBe(8); // 6 + 2
    expect(seg2.additionLineIndex).toBe(9); // 6 + 3
  });
});
