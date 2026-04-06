import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { removeLocalStorageItem } from "./hooks/useLocalStorage";
import {
  WORKSPACE_EDITOR_VIM_MODE_KEY,
  readPersistedWorkspaceEditorVimMode,
  useWorkspaceEditorStore,
} from "./workspaceEditorStore";

describe("workspaceEditorStore", () => {
  beforeEach(() => {
    removeLocalStorageItem(WORKSPACE_EDITOR_VIM_MODE_KEY);
    useWorkspaceEditorStore.setState({ editorsByThreadId: {} });
  });

  it("persists vim mode when toggled", () => {
    useWorkspaceEditorStore.getState().setVimMode(ThreadId.makeUnsafe("thread-1"), true);

    expect(readPersistedWorkspaceEditorVimMode()).toBe(true);
  });

  it("hydrates new thread editor state from the persisted vim mode preference", () => {
    useWorkspaceEditorStore.getState().setVimMode(ThreadId.makeUnsafe("persisted-thread"), true);
    useWorkspaceEditorStore.setState({ editorsByThreadId: {} });

    useWorkspaceEditorStore
      .getState()
      .openFile(ThreadId.makeUnsafe("thread-2"), "apps/web/src/components/ChatView.tsx");

    expect(useWorkspaceEditorStore.getState().editorsByThreadId["thread-2"]?.vimMode).toBe(true);
  });
});
