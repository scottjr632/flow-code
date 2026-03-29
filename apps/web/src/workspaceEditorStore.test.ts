import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  WORKSPACE_EDITOR_VIM_MODE_KEY,
  readPersistedWorkspaceEditorVimMode,
  useWorkspaceEditorStore,
} from "./workspaceEditorStore";

describe("workspaceEditorStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceEditorStore.setState({ editorsByThreadId: {} });
  });

  it("persists vim mode when toggled", () => {
    useWorkspaceEditorStore.getState().setVimMode(ThreadId.makeUnsafe("thread-1"), true);

    expect(readPersistedWorkspaceEditorVimMode()).toBe(true);
  });

  it("hydrates new thread editor state from the persisted vim mode preference", () => {
    localStorage.setItem(WORKSPACE_EDITOR_VIM_MODE_KEY, "true");

    useWorkspaceEditorStore
      .getState()
      .openFile(ThreadId.makeUnsafe("thread-2"), "apps/web/src/components/ChatView.tsx");

    expect(useWorkspaceEditorStore.getState().editorsByThreadId["thread-2"]?.vimMode).toBe(true);
  });
});
