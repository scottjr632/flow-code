/**
 * Project-scoped terminal panel rendered in the global layout.
 *
 * Uses the existing ThreadTerminalDrawer component with a synthetic
 * per-project owner id, reusing the full terminal infrastructure
 * (server PTY, WS protocol, xterm.js) without any protocol changes.
 */

import { type ProjectId } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import ThreadTerminalDrawer from "./ThreadTerminalDrawer";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useWorkspaceTerminalStore } from "../workspaceTerminalStore";
import { useStore } from "../store";
import { randomUUID } from "~/lib/utils";
import type { TerminalContextSelection } from "~/lib/terminalContext";
import { isUserProject } from "../systemProject";
import { projectTerminalOwnerId } from "../projectTerminal";

function resolvePanelProjectId(
  requestedProjectId: ProjectId | null,
  userProjectIds: readonly ProjectId[],
): ProjectId | null {
  if (requestedProjectId && userProjectIds.includes(requestedProjectId)) {
    return requestedProjectId;
  }
  return userProjectIds[0] ?? null;
}

export default function WorkspaceTerminalPanel() {
  const isOpen = useWorkspaceTerminalStore((state) => state.isOpen);
  const requestedProjectId = useWorkspaceTerminalStore((state) => state.projectId);
  const setWorkspaceTerminalOpen = useWorkspaceTerminalStore((state) => state.setOpen);
  const projects = useStore((store) => store.projects);
  const userProjects = useMemo(
    () => projects.filter((project) => isUserProject(project)),
    [projects],
  );
  const activeProjectId = useMemo(
    () =>
      resolvePanelProjectId(
        requestedProjectId,
        userProjects.map((project) => project.id),
      ),
    [requestedProjectId, userProjects],
  );
  const activeProject = useMemo(
    () => userProjects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, userProjects],
  );
  const ownerThreadId = useMemo(
    () => (activeProjectId ? projectTerminalOwnerId(activeProjectId) : null),
    [activeProjectId],
  );

  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const setTerminalHeight = useTerminalStateStore((state) => state.setTerminalHeight);
  const splitTerminal = useTerminalStateStore((state) => state.splitTerminal);
  const newTerminal = useTerminalStateStore((state) => state.newTerminal);
  const setActiveTerminal = useTerminalStateStore((state) => state.setActiveTerminal);
  const closeTerminal = useTerminalStateStore((state) => state.closeTerminal);
  const terminalState = useMemo(
    () =>
      ownerThreadId ? selectThreadTerminalState(terminalStateByThreadId, ownerThreadId) : null,
    [ownerThreadId, terminalStateByThreadId],
  );

  const handleSplitTerminal = useCallback(() => {
    if (!ownerThreadId) return;
    const terminalId = randomUUID();
    splitTerminal(ownerThreadId, terminalId);
  }, [ownerThreadId, splitTerminal]);

  const handleNewTerminal = useCallback(() => {
    if (!ownerThreadId) return;
    const terminalId = randomUUID();
    newTerminal(ownerThreadId, terminalId);
  }, [newTerminal, ownerThreadId]);

  const handleActiveTerminalChange = useCallback(
    (terminalId: string) => {
      if (!ownerThreadId) return;
      setActiveTerminal(ownerThreadId, terminalId);
    },
    [ownerThreadId, setActiveTerminal],
  );

  const handleCloseTerminal = useCallback(
    (terminalId: string) => {
      if (!ownerThreadId) return;
      closeTerminal(ownerThreadId, terminalId);
    },
    [closeTerminal, ownerThreadId],
  );

  const handleHeightChange = useCallback(
    (height: number) => {
      if (!ownerThreadId) return;
      setTerminalHeight(ownerThreadId, height);
    },
    [ownerThreadId, setTerminalHeight],
  );

  const handleAddTerminalContext = useCallback((_selection: TerminalContextSelection) => {
    // Project terminal context is not tied to a composer, so this is a no-op.
  }, []);
  const handleClosePanel = useCallback(() => {
    setWorkspaceTerminalOpen(false);
  }, [setWorkspaceTerminalOpen]);

  const terminalGroups = useMemo(() => terminalState?.terminalGroups ?? [], [terminalState]);

  if (!isOpen || !activeProject || !ownerThreadId || !terminalState) {
    return null;
  }

  return (
    <div className="min-h-0 border-t border-border">
      <ThreadTerminalDrawer
        key={ownerThreadId}
        variant="drawer"
        threadId={ownerThreadId}
        cwd={activeProject.cwd}
        height={terminalState.terminalHeight}
        terminalIds={terminalState.terminalIds}
        terminalNamesById={terminalState.terminalNamesById}
        activeTerminalId={terminalState.activeTerminalId}
        terminalGroups={terminalGroups}
        activeTerminalGroupId={terminalState.activeTerminalGroupId}
        focusRequestId={0}
        onSplitTerminal={handleSplitTerminal}
        onNewTerminal={handleNewTerminal}
        onActiveTerminalChange={handleActiveTerminalChange}
        onCloseTerminal={handleCloseTerminal}
        onClosePanel={handleClosePanel}
        onHeightChange={handleHeightChange}
        onAddTerminalContext={handleAddTerminalContext}
      />
    </div>
  );
}
