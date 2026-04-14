import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_WORKSPACE_EXPLORER_WIDTH, useWorkspaceEditorStore } from "./workspaceEditorStore";

describe("workspaceEditorStore", () => {
  beforeEach(() => {
    useWorkspaceEditorStore.setState({ editorsByThreadId: {} });
  });

  it("starts new thread editor state with the explorer open and diagnostics collapsed", () => {
    useWorkspaceEditorStore
      .getState()
      .openFile(ThreadId.makeUnsafe("thread-default-layout"), "README.md");

    expect(
      useWorkspaceEditorStore.getState().editorsByThreadId["thread-default-layout"]?.explorerOpen,
    ).toBe(true);
    expect(
      useWorkspaceEditorStore.getState().editorsByThreadId["thread-default-layout"]?.problemsOpen,
    ).toBe(false);
    expect(
      useWorkspaceEditorStore.getState().editorsByThreadId["thread-default-layout"]?.mode,
    ).toBe("review");
  });

  it("tracks explorer visibility per thread", () => {
    const threadId = ThreadId.makeUnsafe("thread-explorer");

    useWorkspaceEditorStore.getState().openFile(threadId, "apps/web/src/components/ChatView.tsx");
    useWorkspaceEditorStore.getState().setExplorerOpen(threadId, true);

    expect(
      useWorkspaceEditorStore.getState().editorsByThreadId["thread-explorer"]?.explorerOpen,
    ).toBe(true);

    useWorkspaceEditorStore.getState().setExplorerOpen(threadId, false);

    expect(
      useWorkspaceEditorStore.getState().editorsByThreadId["thread-explorer"]?.explorerOpen,
    ).toBe(false);
  });

  it("tracks explorer width per thread", () => {
    const threadId = ThreadId.makeUnsafe("thread-explorer-width");

    useWorkspaceEditorStore.getState().setExplorerWidth(threadId, 320);

    expect(
      useWorkspaceEditorStore.getState().editorsByThreadId["thread-explorer-width"]?.explorerWidth,
    ).toBe(320);
    expect(
      useWorkspaceEditorStore.getState().editorsByThreadId["thread-explorer-width"]?.explorerOpen,
    ).toBe(true);
  });

  it("hydrates new thread editor state with the default explorer width", () => {
    useWorkspaceEditorStore
      .getState()
      .openFile(
        ThreadId.makeUnsafe("thread-default-width"),
        "apps/web/src/components/ChatView.tsx",
      );

    expect(
      useWorkspaceEditorStore.getState().editorsByThreadId["thread-default-width"]?.explorerWidth,
    ).toBe(DEFAULT_WORKSPACE_EXPLORER_WIDTH);
  });

  it("tracks review and edit mode per thread", () => {
    const threadId = ThreadId.makeUnsafe("thread-mode");

    useWorkspaceEditorStore.getState().setMode(threadId, "edit");
    expect(useWorkspaceEditorStore.getState().editorsByThreadId["thread-mode"]?.mode).toBe("edit");

    useWorkspaceEditorStore.getState().setMode(threadId, "review");
    expect(useWorkspaceEditorStore.getState().editorsByThreadId["thread-mode"]?.mode).toBe(
      "review",
    );
  });
});
