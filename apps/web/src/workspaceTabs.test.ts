import { describe, expect, it } from "vitest";

import {
  buildTerminalWorkspaceTabId,
  buildWorkspaceTabs,
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
    ).toEqual(["chat"]);
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
      ["chat", "Chat"],
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
      ["chat", "Chat"],
      [buildTerminalWorkspaceTabId("group-a"), "Terminal"],
    ]);
  });

  it("falls back to chat when the preferred tab is no longer available", () => {
    const tabs = buildWorkspaceTabs({
      diffOpen: false,
      terminalOpen: false,
      terminalGroups: [],
    });

    expect(resolveWorkspaceTabId("diff", tabs)).toBe("chat");
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
