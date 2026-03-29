import { ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComposerPendingDiffCommentChip } from "./ComposerPendingDiffComments";

describe("ComposerPendingDiffCommentChip", () => {
  it("renders the diff comment label and a remove action", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingDiffCommentChip
        comment={{
          id: "comment-1",
          threadId: ThreadId.makeUnsafe("thread-1"),
          filePath: "apps/web/src/components/DiffPanel.tsx",
          lineStart: 2,
          lineEnd: 4,
          side: "additions",
          body: "This needs a guard.",
          excerpt: "2 | if (foo)\n3 |   bar()",
          createdAt: "2026-03-28T18:42:05.449Z",
        }}
        onRemove={vi.fn()}
      />,
    );

    expect(markup).toContain("apps/web/src/components/DiffPanel.tsx added lines 2-4");
    expect(markup).toContain("Remove apps/web/src/components/DiffPanel.tsx added lines 2-4");
  });
});
