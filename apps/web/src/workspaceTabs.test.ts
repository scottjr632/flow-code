import { describe, expect, it } from "vitest";

import {
  buildThreadWorkspaceTabId,
  buildTerminalWorkspaceTabId,
  buildWorkspaceTabs,
  DEFAULT_CHAT_WORKSPACE_TAB_ID,
  getAdjacentWorkspaceTabId,
  reorderWorkspaceTabIds,
  resolveWorkspaceTabId,
  sortWorkspaceTabsByOrder,
} from "./workspaceTabs";
import { getProviderIcon } from "./providerIcons";

describe("workspaceTabs", () => {
  it("always includes chat, files, and review", () => {
    expect(
      buildWorkspaceTabs({
        fileTabs: [],
        terminalOpen: false,
        terminalGroups: [],
      }).map((tab) => tab.id),
    ).toEqual(["chat", "files", "diff"]);
  });

  it("uses the active provider icon for the default non-workspace chat tab", () => {
    const tabs = buildWorkspaceTabs({
      chatProvider: "claudeAgent",
      fileTabs: [],
      terminalOpen: false,
      terminalGroups: [],
    });

    expect(tabs[0]).toMatchObject({
      kind: "chat",
      icon: getProviderIcon("claudeAgent"),
    });
  });

  it("adds one terminal tab per terminal group", () => {
    expect(
      buildWorkspaceTabs({
        fileTabs: [],
        terminalOpen: true,
        terminalGroups: [
          { id: "group-a", terminalIds: ["terminal-a"] },
          { id: "group-b", terminalIds: ["terminal-b", "terminal-c"] },
        ],
      }).map((tab) => [tab.id, tab.title]),
    ).toEqual([
      ["chat", "Chat"],
      ["files", "Files"],
      ["diff", "Review"],
      [buildTerminalWorkspaceTabId("group-a"), "Terminal 1"],
      [buildTerminalWorkspaceTabId("group-b"), "Terminal 2 (2)"],
    ]);
  });

  it("uses custom terminal names for terminal tabs", () => {
    expect(
      buildWorkspaceTabs({
        fileTabs: [],
        terminalOpen: true,
        terminalGroups: [
          { id: "group-a", terminalIds: ["terminal-a"] },
          { id: "group-b", terminalIds: ["terminal-b", "terminal-c"] },
        ],
        terminalNamesById: {
          "terminal-a": "Logs",
          "terminal-b": "Build",
        },
      }).map((tab) => [tab.id, tab.title]),
    ).toEqual([
      ["chat", "Chat"],
      ["files", "Files"],
      ["diff", "Review"],
      [buildTerminalWorkspaceTabId("group-a"), "Logs"],
      [buildTerminalWorkspaceTabId("group-b"), "Build (2)"],
    ]);
  });

  it("uses a plain terminal title when there is only one terminal group", () => {
    expect(
      buildWorkspaceTabs({
        fileTabs: [],
        terminalOpen: true,
        terminalGroups: [{ id: "group-a", terminalIds: ["terminal-a"] }],
      }).map((tab) => [tab.id, tab.title]),
    ).toEqual([
      ["chat", "Chat"],
      ["files", "Files"],
      ["diff", "Review"],
      [buildTerminalWorkspaceTabId("group-a"), "Terminal"],
    ]);
  });

  it("replaces the default chat tab with workspace session tabs", () => {
    const tabs = buildWorkspaceTabs({
      sessionTabs: [
        {
          threadId: "thread-b",
          title: "Second session",
          isDraft: false,
          provider: "codex",
        },
        {
          threadId: "draft-a",
          title: "New thread",
          isDraft: true,
          provider: "claudeAgent",
        },
      ],
      diffOpen: false,
      terminalOpen: false,
      terminalGroups: [],
    });

    expect(tabs.map((tab) => [tab.id, tab.title])).toEqual([
      [buildThreadWorkspaceTabId("thread-b"), "Second session"],
      [buildThreadWorkspaceTabId("draft-a"), "New session"],
      ["files", "Files"],
      ["diff", "Review"],
    ]);

    expect(tabs[0]).toMatchObject({
      kind: "session",
      provider: "codex",
      icon: getProviderIcon("codex"),
    });
    expect(tabs[1]).toMatchObject({
      kind: "session",
      provider: "claudeAgent",
      icon: getProviderIcon("claudeAgent"),
    });
  });

  it("falls back to chat when the preferred tab is no longer available", () => {
    const tabs = buildWorkspaceTabs({
      fileTabs: [],
      terminalOpen: false,
      terminalGroups: [],
    });

    expect(resolveWorkspaceTabId("terminal:nonexistent", tabs)).toBe("chat");
  });

  it("keeps the preferred terminal tab when it still exists", () => {
    const tabs = buildWorkspaceTabs({
      fileTabs: [],
      terminalOpen: true,
      terminalGroups: [{ id: "group-a", terminalIds: ["terminal-a"] }],
    });

    expect(resolveWorkspaceTabId(buildTerminalWorkspaceTabId("group-a"), tabs)).toBe(
      buildTerminalWorkspaceTabId("group-a"),
    );
  });

  it("returns the previous and next workspace tab with wraparound", () => {
    const tabs = buildWorkspaceTabs({
      fileTabs: [],
      terminalOpen: true,
      terminalGroups: [{ id: "group-a", terminalIds: ["terminal-a"] }],
    });

    expect(
      getAdjacentWorkspaceTabId({
        activeTabId: DEFAULT_CHAT_WORKSPACE_TAB_ID,
        tabs,
        direction: "previous",
      }),
    ).toBe(buildTerminalWorkspaceTabId("group-a"));
    expect(
      getAdjacentWorkspaceTabId({
        activeTabId: buildTerminalWorkspaceTabId("group-a"),
        tabs,
        direction: "next",
      }),
    ).toBe(DEFAULT_CHAT_WORKSPACE_TAB_ID);
  });

  it("falls back to the resolved active tab before traversing", () => {
    const tabs = buildWorkspaceTabs({
      fileTabs: [],
      terminalOpen: false,
      terminalGroups: [],
    });

    expect(
      getAdjacentWorkspaceTabId({
        activeTabId: "missing",
        tabs,
        direction: "next",
      }),
    ).toBe("files");
  });

  it("reorders tabs using a saved tab id order", () => {
    const tabs = buildWorkspaceTabs({
      diffOpen: true,
      terminalOpen: true,
      terminalGroups: [{ id: "group-a", terminalIds: ["terminal-a"] }],
    });

    expect(
      sortWorkspaceTabsByOrder(tabs, ["diff", DEFAULT_CHAT_WORKSPACE_TAB_ID]).map((tab) => tab.id),
    ).toEqual([
      "diff",
      DEFAULT_CHAT_WORKSPACE_TAB_ID,
      "files",
      buildTerminalWorkspaceTabId("group-a"),
    ]);
  });

  it("moves the dragged tab id to the target position", () => {
    expect(
      reorderWorkspaceTabIds(
        [
          DEFAULT_CHAT_WORKSPACE_TAB_ID,
          "diff",
          buildTerminalWorkspaceTabId("group-a"),
          buildTerminalWorkspaceTabId("group-b"),
        ],
        buildTerminalWorkspaceTabId("group-b"),
        "diff",
      ),
    ).toEqual([
      DEFAULT_CHAT_WORKSPACE_TAB_ID,
      buildTerminalWorkspaceTabId("group-b"),
      "diff",
      buildTerminalWorkspaceTabId("group-a"),
    ]);
  });
});
