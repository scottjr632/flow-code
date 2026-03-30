import { describe, expect, it } from "vitest";

import {
  buildCodeCommentOpenTarget,
  parseAssistantDirectives,
  resolveCodeCommentFileTarget,
} from "./codexDirectives";

describe("parseAssistantDirectives", () => {
  it("extracts code comments and removes directives from display text", () => {
    const parsed = parseAssistantDirectives(
      [
        "Found two issues.",
        "",
        '::code-comment{title="[P1] Handle null thread" body="This branch dereferences thread before checking it." file="apps/web/src/components/ChatView.tsx" start=526 end=530 priority=1 confidence=0.92}',
      ].join("\n"),
    );

    expect(parsed.displayText).toBe("Found two issues.");
    expect(parsed.codeComments).toEqual([
      {
        title: "[P1] Handle null thread",
        body: "This branch dereferences thread before checking it.",
        file: "apps/web/src/components/ChatView.tsx",
        start: 526,
        end: 530,
        priority: 1,
        confidence: 0.92,
      },
    ]);
  });

  it("preserves invalid directives in the message text", () => {
    const text = 'Visible text\n::code-comment{title="missing body" file="apps/web/src/file.ts"}';

    const parsed = parseAssistantDirectives(text);

    expect(parsed.displayText).toBe(text);
    expect(parsed.codeComments).toEqual([]);
  });

  it("supports escaped quotes inside directive values", () => {
    const parsed = parseAssistantDirectives(
      '::code-comment{title="Quoted \\"title\\"" body="Use \\"strict\\" mode." file="/tmp/example.ts"}',
    );

    expect(parsed.displayText).toBe("");
    expect(parsed.codeComments).toEqual([
      {
        title: 'Quoted "title"',
        body: 'Use "strict" mode.',
        file: "/tmp/example.ts",
      },
    ]);
  });
});

describe("resolveCodeCommentFileTarget", () => {
  it("resolves workspace-relative review comment paths", () => {
    expect(
      resolveCodeCommentFileTarget(
        "apps/web/src/components/ChatView.tsx",
        "/Users/scottrichardson/workspace/github.com/scottjr632/flow",
      ),
    ).toBe(
      "/Users/scottrichardson/workspace/github.com/scottjr632/flow/apps/web/src/components/ChatView.tsx",
    );
  });

  it("resolves workspace-name-prefixed review comment paths", () => {
    expect(
      resolveCodeCommentFileTarget(
        "flow/apps/web/src/components/ChatView.tsx",
        "/Users/scottrichardson/workspace/github.com/scottjr632/flow",
      ),
    ).toBe(
      "/Users/scottrichardson/workspace/github.com/scottjr632/flow/apps/web/src/components/ChatView.tsx",
    );
  });

  it("builds editor targets with line numbers when present", () => {
    expect(
      buildCodeCommentOpenTarget(
        {
          file: "apps/web/src/components/ChatView.tsx",
          start: 526,
        },
        "/Users/scottrichardson/workspace/github.com/scottjr632/flow",
      ),
    ).toBe(
      "/Users/scottrichardson/workspace/github.com/scottjr632/flow/apps/web/src/components/ChatView.tsx:526",
    );
  });
});
