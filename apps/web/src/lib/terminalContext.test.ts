import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { appendDiffCommentsToPrompt } from "./diffCommentContext";
import {
  appendTerminalContextsToPrompt,
  buildTerminalContextPreviewTitle,
  buildTerminalContextBlock,
  countInlineTerminalContextPlaceholders,
  deriveDisplayedUserMessageState,
  ensureInlineTerminalContextPlaceholders,
  extractTrailingTerminalContexts,
  filterTerminalContextsWithText,
  formatInlineTerminalContextLabel,
  formatTerminalContextLabel,
  hasTerminalContextText,
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  insertInlineTerminalContextPlaceholder,
  isTerminalContextExpired,
  materializeInlineTerminalContextPrompt,
  removeInlineTerminalContextPlaceholder,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "./terminalContext";

function makeContext(overrides?: Partial<TerminalContextDraft>): TerminalContextDraft {
  return {
    id: "context-1",
    threadId: ThreadId.makeUnsafe("thread-1"),
    terminalId: "default",
    terminalLabel: "Terminal 1",
    lineStart: 12,
    lineEnd: 13,
    text: "git status\nOn branch main",
    createdAt: "2026-03-13T12:00:00.000Z",
    ...overrides,
  };
}

describe("terminalContext", () => {
  it("formats terminal labels with line ranges", () => {
    expect(formatTerminalContextLabel(makeContext())).toBe("Terminal 1 lines 12-13");
    expect(
      formatTerminalContextLabel(
        makeContext({
          lineStart: 9,
          lineEnd: 9,
        }),
      ),
    ).toBe("Terminal 1 line 9");
  });

  it("builds a numbered terminal context block", () => {
    expect(buildTerminalContextBlock([makeContext()])).toBe(
      [
        "<terminal_context>",
        "- Terminal 1 lines 12-13:",
        "  12 | git status",
        "  13 | On branch main",
        "</terminal_context>",
      ].join("\n"),
    );
  });

  it("appends terminal context blocks after prompt text", () => {
    expect(appendTerminalContextsToPrompt("Investigate this", [makeContext()])).toBe(
      [
        "Investigate this",
        "",
        "<terminal_context>",
        "- Terminal 1 lines 12-13:",
        "  12 | git status",
        "  13 | On branch main",
        "</terminal_context>",
      ].join("\n"),
    );
  });

  it("replaces inline placeholders with inline terminal labels before appending context blocks", () => {
    expect(
      appendTerminalContextsToPrompt(
        `Investigate ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} carefully`,
        [makeContext()],
      ),
    ).toBe(
      [
        "Investigate @terminal-1:12-13 carefully",
        "",
        "<terminal_context>",
        "- Terminal 1 lines 12-13:",
        "  12 | git status",
        "  13 | On branch main",
        "</terminal_context>",
      ].join("\n"),
    );
  });

  it("extracts terminal context blocks from message text", () => {
    const prompt = appendTerminalContextsToPrompt("Investigate this", [makeContext()]);
    expect(extractTrailingTerminalContexts(prompt)).toEqual({
      promptText: "Investigate this",
      contextCount: 1,
      previewTitle: "Terminal 1 lines 12-13\n12 | git status\n13 | On branch main",
      contexts: [
        {
          header: "Terminal 1 lines 12-13",
          body: "12 | git status\n13 | On branch main",
        },
      ],
    });
  });

  it("derives displayed user message state from terminal context prompts", () => {
    const prompt = appendTerminalContextsToPrompt("Investigate this", [makeContext()]);
    expect(deriveDisplayedUserMessageState(prompt)).toEqual({
      visibleText: "Investigate this",
      copyText: prompt,
      contextCount: 1,
      previewTitle: "Terminal 1 lines 12-13\n12 | git status\n13 | On branch main",
      contexts: [
        {
          header: "Terminal 1 lines 12-13",
          body: "12 | git status\n13 | On branch main",
        },
      ],
      diffComments: [],
      sessionReferences: [],
      terminalLogReferences: [],
    });
  });

  it("preserves prompt text when no trailing terminal context block exists", () => {
    expect(extractTrailingTerminalContexts("No attached context")).toEqual({
      promptText: "No attached context",
      contextCount: 0,
      previewTitle: null,
      contexts: [],
    });
  });

  it("strips trailing diff comment blocks from displayed user messages", () => {
    const promptWithTerminalContext = appendTerminalContextsToPrompt("Investigate this", [
      makeContext(),
    ]);
    const prompt = appendDiffCommentsToPrompt(promptWithTerminalContext, [
      {
        filePath: "apps/web/src/components/DiffPanel.tsx",
        lineStart: 12,
        lineEnd: 12,
        side: "additions",
        body: "Check the null guard.",
        excerpt: "12 | if (foo)",
      },
    ]);

    expect(deriveDisplayedUserMessageState(prompt)).toEqual({
      visibleText: "Investigate this",
      copyText: prompt,
      contextCount: 2,
      previewTitle: [
        "Terminal 1 lines 12-13",
        "12 | git status",
        "13 | On branch main",
        "",
        "apps/web/src/components/DiffPanel.tsx added line 12",
        "Comment:",
        "  Check the null guard.",
        "Code:",
        "  12 | if (foo)",
      ].join("\n"),
      contexts: [
        {
          header: "Terminal 1 lines 12-13",
          body: "12 | git status\n13 | On branch main",
        },
      ],
      diffComments: [
        {
          header: "apps/web/src/components/DiffPanel.tsx added line 12",
          body: "Comment:\n  Check the null guard.\nCode:\n  12 | if (foo)",
        },
      ],
      sessionReferences: [],
      terminalLogReferences: [],
    });
  });

  it("strips trailing session references before parsing other display context", () => {
    const prompt = [
      appendTerminalContextsToPrompt("Use @session:fix-reconnect-flow#thread-a", [makeContext()]),
      "",
      "<session_context>",
      "- Fix reconnect flow:",
      "  Thread id: thread-a",
      "  Branch: feature/reconnect",
      "</session_context>",
    ].join("\n");

    expect(deriveDisplayedUserMessageState(prompt)).toEqual({
      visibleText: "Use @session:fix-reconnect-flow",
      copyText: prompt,
      contextCount: 2,
      previewTitle: [
        "Fix reconnect flow\nThread id: thread-a\nBranch: feature/reconnect",
        "Terminal 1 lines 12-13\n12 | git status\n13 | On branch main",
      ].join("\n\n"),
      contexts: [
        {
          header: "Terminal 1 lines 12-13",
          body: "12 | git status\n13 | On branch main",
        },
      ],
      diffComments: [],
      sessionReferences: [
        {
          header: "Fix reconnect flow",
          body: "Thread id: thread-a\nBranch: feature/reconnect",
        },
      ],
      terminalLogReferences: [],
    });
  });

  it("strips trailing terminal log references before parsing other display context", () => {
    const prompt = [
      appendTerminalContextsToPrompt("Use @terminal:tests#thread-a:terminal-2", [makeContext()]),
      "",
      "<terminal_log_context>",
      "- tests:",
      "  Thread id: thread-a",
      "  Terminal id: terminal-2",
      "  Recent output:",
      "    1 | pnpm lint",
      "</terminal_log_context>",
    ].join("\n");

    expect(deriveDisplayedUserMessageState(prompt)).toEqual({
      visibleText: "Use @terminal:tests",
      copyText: prompt,
      contextCount: 2,
      previewTitle: [
        "tests\nThread id: thread-a\nTerminal id: terminal-2\nRecent output:\n  1 | pnpm lint",
        "Terminal 1 lines 12-13\n12 | git status\n13 | On branch main",
      ].join("\n\n"),
      contexts: [
        {
          header: "Terminal 1 lines 12-13",
          body: "12 | git status\n13 | On branch main",
        },
      ],
      diffComments: [],
      sessionReferences: [],
      terminalLogReferences: [
        {
          header: "tests",
          body: "Thread id: thread-a\nTerminal id: terminal-2\nRecent output:\n  1 | pnpm lint",
        },
      ],
    });
  });

  it("returns null preview title when every context is invalid", () => {
    expect(
      buildTerminalContextPreviewTitle([
        makeContext({
          terminalId: "   ",
        }),
        makeContext({
          id: "context-2",
          text: "\n\n",
        }),
      ]),
    ).toBeNull();
  });

  it("tracks inline terminal context placeholders in prompt text", () => {
    const placeholder = INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
    expect(countInlineTerminalContextPlaceholders(`a${placeholder}b${placeholder}`)).toBe(2);
    expect(ensureInlineTerminalContextPlaceholders("Investigate this", 2)).toBe(
      `${placeholder}${placeholder}Investigate this`,
    );
    expect(insertInlineTerminalContextPlaceholder("abc", 1)).toEqual({
      prompt: `a ${placeholder} bc`,
      cursor: 4,
      contextIndex: 0,
    });
    expect(removeInlineTerminalContextPlaceholder(`a${placeholder}b${placeholder}c`, 1)).toEqual({
      prompt: `a${placeholder}bc`,
      cursor: 3,
    });
    expect(stripInlineTerminalContextPlaceholders(`a${placeholder}b`)).toBe("ab");
  });

  it("inserts a placeholder after a file mention when given the expanded prompt cursor", () => {
    const placeholder = INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
    expect(insertInlineTerminalContextPlaceholder("Inspect @package.json ", 22)).toEqual({
      prompt: `Inspect @package.json ${placeholder} `,
      cursor: 24,
      contextIndex: 0,
    });
  });

  it("adds a trailing space and consumes an existing trailing space at the insertion point", () => {
    const placeholder = INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
    expect(insertInlineTerminalContextPlaceholder("yo whats", 3)).toEqual({
      prompt: `yo ${placeholder} whats`,
      cursor: 5,
      contextIndex: 0,
    });
  });

  it("marks contexts without snapshot text as expired and filters them from sendable contexts", () => {
    const liveContext = makeContext();
    const expiredContext = makeContext({
      id: "context-2",
      text: "",
    });

    expect(hasTerminalContextText(liveContext)).toBe(true);
    expect(isTerminalContextExpired(liveContext)).toBe(false);
    expect(hasTerminalContextText(expiredContext)).toBe(false);
    expect(isTerminalContextExpired(expiredContext)).toBe(true);
    expect(filterTerminalContextsWithText([expiredContext, liveContext])).toEqual([liveContext]);
  });

  it("formats and materializes inline terminal labels from placeholder positions", () => {
    expect(formatInlineTerminalContextLabel(makeContext())).toBe("@terminal-1:12-13");
    expect(
      materializeInlineTerminalContextPrompt(
        `Investigate ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} carefully`,
        [makeContext()],
      ),
    ).toBe("Investigate @terminal-1:12-13 carefully");
  });
});
