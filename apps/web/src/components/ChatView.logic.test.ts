import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildWorkspaceTabOrderContextId,
  buildExpiredTerminalContextToastCopy,
  deriveComposerSendState,
  getWorkspaceTabReconciliationTarget,
  shouldReuseHiddenDefaultTerminalForWorkspaceCreation,
  updateLastActiveWorkspaceTabByThread,
} from "./ChatView.logic";

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      diffComments: [],
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.sendableDiffComments).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      diffComments: [],
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });

  it("treats diff comments as sendable context even without plain prompt text", () => {
    const state = deriveComposerSendState({
      prompt: "",
      imageCount: 0,
      terminalContexts: [],
      diffComments: [
        {
          id: "comment-1",
          threadId: ThreadId.makeUnsafe("thread-1"),
          filePath: "apps/web/src/components/DiffPanel.tsx",
          lineStart: 12,
          lineEnd: 14,
          side: "additions",
          body: "This branch needs a guard.",
          excerpt: "12 | if (foo)\n13 |   bar()",
          createdAt: "2026-03-28T12:52:29.000Z",
        },
      ],
    });

    expect(state.sendableDiffComments).toHaveLength(1);
    expect(state.hasSendableContent).toBe(true);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats clear empty-state guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
  });

  it("formats omission guidance for sent messages", () => {
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("updateLastActiveWorkspaceTabByThread", () => {
  it("stores non-chat workspace tabs per thread", () => {
    expect(
      updateLastActiveWorkspaceTabByThread({}, ThreadId.makeUnsafe("thread-1"), "diff"),
    ).toEqual({
      "thread-1": "diff",
    });
  });

  it("preserves other thread selections when updating one thread", () => {
    expect(
      updateLastActiveWorkspaceTabByThread(
        {
          [ThreadId.makeUnsafe("thread-1")]: "diff",
          [ThreadId.makeUnsafe("thread-2")]: "terminal:group-2",
        },
        ThreadId.makeUnsafe("thread-1"),
        "terminal:group-1",
      ),
    ).toEqual({
      "thread-1": "terminal:group-1",
      "thread-2": "terminal:group-2",
    });
  });

  it("drops chat selections so threads without an override restore to chat", () => {
    expect(
      updateLastActiveWorkspaceTabByThread(
        {
          [ThreadId.makeUnsafe("thread-1")]: "diff",
          [ThreadId.makeUnsafe("thread-2")]: "terminal:group-2",
        },
        ThreadId.makeUnsafe("thread-1"),
        "chat",
      ),
    ).toEqual({
      "thread-2": "terminal:group-2",
    });
  });
});

describe("getWorkspaceTabReconciliationTarget", () => {
  it("keeps a pending review selection while the review tab is being opened", () => {
    expect(
      getWorkspaceTabReconciliationTarget({
        activeTabId: "diff",
        resolvedTabId: "chat",
        diffOpen: false,
      }),
    ).toBeNull();
  });

  it("reconciles stale terminal tabs back to the resolved tab", () => {
    expect(
      getWorkspaceTabReconciliationTarget({
        activeTabId: "terminal:group-1",
        resolvedTabId: "chat",
        diffOpen: false,
      }),
    ).toBe("chat");
  });
});

describe("buildWorkspaceTabOrderContextId", () => {
  it("keys workspace-backed tab order by workspace id", () => {
    expect(
      buildWorkspaceTabOrderContextId({
        threadId: ThreadId.makeUnsafe("thread-1"),
        workspaceId: "workspace-1",
      }),
    ).toBe("workspace:workspace-1");
  });

  it("falls back to the thread id for local threads", () => {
    expect(
      buildWorkspaceTabOrderContextId({
        threadId: ThreadId.makeUnsafe("thread-1"),
        workspaceId: null,
      }),
    ).toBe("thread:thread-1");
  });
});

describe("shouldReuseHiddenDefaultTerminalForWorkspaceCreation", () => {
  it("reuses the hidden default terminal when the terminal UI is closed", () => {
    expect(
      shouldReuseHiddenDefaultTerminalForWorkspaceCreation({
        terminalOpen: false,
        terminalIds: ["default"],
      }),
    ).toBe(true);
  });

  it("creates a new terminal when an existing terminal is already visible", () => {
    expect(
      shouldReuseHiddenDefaultTerminalForWorkspaceCreation({
        terminalOpen: true,
        terminalIds: ["default"],
      }),
    ).toBe(false);
  });

  it("creates a new terminal when the hidden state already has multiple terminals", () => {
    expect(
      shouldReuseHiddenDefaultTerminalForWorkspaceCreation({
        terminalOpen: false,
        terminalIds: ["default", "terminal-2"],
      }),
    ).toBe(false);
  });
});
