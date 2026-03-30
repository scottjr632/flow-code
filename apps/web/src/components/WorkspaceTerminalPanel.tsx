/**
 * Workspace-scoped terminal panel rendered in the global layout.
 *
 * Uses the existing ThreadTerminalDrawer component with a sentinel
 * `WORKSPACE_TERMINAL_OWNER_ID` as the threadId, reusing the full
 * terminal infrastructure (server PTY, WS protocol, xterm.js) without
 * any protocol changes.
 */

import { ThreadId, WORKSPACE_TERMINAL_OWNER_ID } from "@t3tools/contracts";
import { useCallback, useMemo, useRef, useState } from "react";

import ThreadTerminalDrawer from "./ThreadTerminalDrawer";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useWorkspaceTerminalStore } from "../workspaceTerminalStore";
import { useStore } from "../store";
import { randomUUID } from "~/lib/utils";
import type { TerminalContextSelection } from "~/lib/terminalContext";

const WORKSPACE_OWNER_THREAD_ID = ThreadId.makeUnsafe(WORKSPACE_TERMINAL_OWNER_ID);

export default function WorkspaceTerminalPanel() {
  const isOpen = useWorkspaceTerminalStore((state) => state.isOpen);
  const cwd = useStore((store) => store.projects[0]?.cwd ?? null);

  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, WORKSPACE_OWNER_THREAD_ID),
  );

  const setTerminalHeight = useTerminalStateStore((state) => state.setTerminalHeight);
  const splitTerminal = useTerminalStateStore((state) => state.splitTerminal);
  const newTerminal = useTerminalStateStore((state) => state.newTerminal);
  const setActiveTerminal = useTerminalStateStore((state) => state.setActiveTerminal);
  const closeTerminal = useTerminalStateStore((state) => state.closeTerminal);

  const [focusRequestId, setFocusRequestId] = useState(0);
  const lastNewTerminalIdRef = useRef<string | null>(null);

  const handleSplitTerminal = useCallback(() => {
    const terminalId = randomUUID();
    lastNewTerminalIdRef.current = terminalId;
    splitTerminal(WORKSPACE_OWNER_THREAD_ID, terminalId);
  }, [splitTerminal]);

  const handleNewTerminal = useCallback(() => {
    const terminalId = randomUUID();
    lastNewTerminalIdRef.current = terminalId;
    newTerminal(WORKSPACE_OWNER_THREAD_ID, terminalId);
  }, [newTerminal]);

  const handleActiveTerminalChange = useCallback(
    (terminalId: string) => {
      setActiveTerminal(WORKSPACE_OWNER_THREAD_ID, terminalId);
    },
    [setActiveTerminal],
  );

  const handleCloseTerminal = useCallback(
    (terminalId: string) => {
      closeTerminal(WORKSPACE_OWNER_THREAD_ID, terminalId);
    },
    [closeTerminal],
  );

  const handleHeightChange = useCallback(
    (height: number) => {
      setTerminalHeight(WORKSPACE_OWNER_THREAD_ID, height);
    },
    [setTerminalHeight],
  );

  const handleAddTerminalContext = useCallback((_selection: TerminalContextSelection) => {
    // Workspace terminal context is not tied to a composer, so this is a no-op.
  }, []);

  const handleFocusRequest = useCallback(() => {
    setFocusRequestId((id) => id + 1);
  }, []);

  // Expose focus request for keyboard shortcut toggle
  const stableHandleFocusRequest = useRef(handleFocusRequest);
  stableHandleFocusRequest.current = handleFocusRequest;

  const terminalGroups = useMemo(
    () => terminalState.terminalGroups,
    [terminalState.terminalGroups],
  );

  if (!isOpen || !cwd) {
    return null;
  }

  return (
    <div className="min-h-0 border-t border-border">
      <ThreadTerminalDrawer
        key={WORKSPACE_TERMINAL_OWNER_ID}
        variant="drawer"
        threadId={WORKSPACE_OWNER_THREAD_ID}
        cwd={cwd}
        height={terminalState.terminalHeight}
        terminalIds={terminalState.terminalIds}
        terminalNamesById={terminalState.terminalNamesById}
        activeTerminalId={terminalState.activeTerminalId}
        terminalGroups={terminalGroups}
        activeTerminalGroupId={terminalState.activeTerminalGroupId}
        focusRequestId={focusRequestId}
        onSplitTerminal={handleSplitTerminal}
        onNewTerminal={handleNewTerminal}
        onActiveTerminalChange={handleActiveTerminalChange}
        onCloseTerminal={handleCloseTerminal}
        onHeightChange={handleHeightChange}
        onAddTerminalContext={handleAddTerminalContext}
      />
    </div>
  );
}
