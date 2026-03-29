import { describe, expect, it } from "vitest";

import {
  buildThreadWorkspaceTabId,
  buildTerminalWorkspaceTabId,
  buildWorkspaceTabs,
  DEFAULT_CHAT_WORKSPACE_TAB_ID,
  resolveWorkspaceTabId,
} from "./workspaceTabs";

describe("workspaceTabs", () => {
  it("always includes chat first", () => {
    expect(
      buildWorkspaceTabs({
        diffOpen: false,
        terminalOpen: false,
        terminalGroups: [],
      }).map((tab) => tab.id),
    ).toEqual([DEFAULT_CHAT_WORKSPACE_TAB_ID]);
  });

  it("adds review and one terminal tab per terminal group", () => {
    expect(
      buildWorkspaceTabs({
        diffOpen: true,
        terminalOpen: true,
        terminalGroups: [
          { id: "group-a", terminalIds: ["terminal-a"] },
          { id: "group-b", terminalIds: ["terminal-b", "terminal-c"] },
        ],
      }).map((tab) => [tab.id, tab.title]),
    ).toEqual([
      [DEFAULT_CHAT_WORKSPACE_TAB_ID, "Chat"],
      ["diff", "Review"],
      [buildTerminalWorkspaceTabId("group-a"), "Terminal 1"],
      [buildTerminalWorkspaceTabId("group-b"), "Terminal 2 (2)"],
    ]);
  });

  it("uses a plain terminal title when there is only one terminal group", () => {
    expect(
      buildWorkspaceTabs({
        diffOpen: false,
        terminalOpen: true,
        terminalGroups: [{ id: "group-a", terminalIds: ["terminal-a"] }],
      }).map((tab) => [tab.id, tab.title]),
    ).toEqual([
      [DEFAULT_CHAT_WORKSPACE_TAB_ID, "Chat"],
      [buildTerminalWorkspaceTabId("group-a"), "Terminal"],
    ]);
  });

  it("replaces the default chat tab with workspace session tabs", () => {
    expect(
      buildWorkspaceTabs({
        sessionTabs: [
          { threadId: "thread-b", title: "Second session", isDraft: false },
          { threadId: "draft-a", title: "New thread", isDraft: true },
        ],
        diffOpen: false,
        terminalOpen: false,
        terminalGroups: [],
      }).map((tab) => [tab.id, tab.title]),
    ).toEqual([
      [buildThreadWorkspaceTabId("thread-b"), "Second session"],
      [buildThreadWorkspaceTabId("draft-a"), "New session"],
    ]);
  });

  it("falls back to chat when the preferred tab is no longer available", () => {
    const tabs = buildWorkspaceTabs({
      diffOpen: false,
      terminalOpen: false,
      terminalGroups: [],
    });

    expect(resolveWorkspaceTabId("diff", tabs)).toBe(DEFAULT_CHAT_WORKSPACE_TAB_ID);
  });

  it("keeps the preferred terminal tab when it still exists", () => {
    const tabs = buildWorkspaceTabs({
      diffOpen: true,
      terminalOpen: true,
      terminalGroups: [{ id: "group-a", terminalIds: ["terminal-a"] }],
    });

    expect(resolveWorkspaceTabId(buildTerminalWorkspaceTabId("group-a"), tabs)).toBe(
      buildTerminalWorkspaceTabId("group-a"),
    );
  });
});
