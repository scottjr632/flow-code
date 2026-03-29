import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  appendDiffCommentsToPrompt,
  buildDiffCommentBlock,
  extractTrailingDiffComments,
  formatDiffCommentLabel,
  type DiffCommentDraft,
} from "./diffCommentContext";

function makeComment(overrides?: Partial<DiffCommentDraft>): DiffCommentDraft {
  return {
    id: "comment-1",
    threadId: ThreadId.makeUnsafe("thread-1"),
    filePath: "apps/web/src/components/DiffPanel.tsx",
    lineStart: 12,
    lineEnd: 13,
    side: "additions",
    body: "This branch needs a guard.",
    excerpt: "12 | if (foo)\n13 |   bar()",
    createdAt: "2026-03-28T12:00:00.000Z",
    ...overrides,
  };
}

describe("diffCommentContext", () => {
  it("formats diff comment labels with file paths and line ranges", () => {
    expect(formatDiffCommentLabel(makeComment())).toBe(
      "apps/web/src/components/DiffPanel.tsx added lines 12-13",
    );
    expect(
      formatDiffCommentLabel(
        makeComment({
          side: "deletions",
          lineEnd: 12,
        }),
      ),
    ).toBe("apps/web/src/components/DiffPanel.tsx removed line 12");
  });

  it("builds a numbered diff comment block", () => {
    expect(buildDiffCommentBlock([makeComment()])).toBe(
      [
        "<diff_comment>",
        "- apps/web/src/components/DiffPanel.tsx added lines 12-13:",
        "  Comment:",
        "    This branch needs a guard.",
        "  Code:",
        "    12 | if (foo)",
        "    13 |   bar()",
        "</diff_comment>",
      ].join("\n"),
    );
  });

  it("extracts trailing diff comment blocks from prompt text", () => {
    const prompt = appendDiffCommentsToPrompt("Investigate this", [makeComment()]);
    expect(extractTrailingDiffComments(prompt)).toEqual({
      promptText: "Investigate this",
      comments: [
        {
          header: "apps/web/src/components/DiffPanel.tsx added lines 12-13",
          body: [
            "Comment:",
            "  This branch needs a guard.",
            "Code:",
            "  12 | if (foo)",
            "  13 |   bar()",
          ].join("\n"),
        },
      ],
    });
  });
});
