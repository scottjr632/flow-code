import { ThreadId, type WorkspaceId } from "@t3tools/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";

import { getFallbackThreadIdAfterDelete } from "../components/Sidebar.logic";
import { useComposerDraftStore } from "../composerDraftStore";
import { useHandleNewThread } from "./useHandleNewThread";
import { gitRemoveWorktreeMutationOptions } from "../lib/gitReactQuery";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import {
  formatWorktreePathForDisplay,
  getOrphanedWorktreePathForThread,
  getOrphanedWorktreePathForWorkspace,
} from "../worktreeCleanup";
import { toastManager } from "../components/ui/toast";
import { useSettings } from "./useSettings";
import { resolveExistingWorkspaceContext } from "../workspaceContext";

export function useThreadActions() {
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const workspaces = useStore((store) => store.workspaces);
  const appSettings = useSettings();
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearDraftThread);
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const navigate = useNavigate();
  const { handleNewThread } = useHandleNewThread();
  const queryClient = useQueryClient();
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));

  const clearWorkspaceFromDraftThreads = useCallback(
    (workspaceId: WorkspaceId) => {
      for (const [threadId, draftThread] of Object.entries(draftThreadsByThreadId) as Array<
        [ThreadId, (typeof draftThreadsByThreadId)[ThreadId]]
      >) {
        if (draftThread?.workspaceId !== workspaceId) {
          continue;
        }
        setDraftThreadContext(threadId, { workspaceId: null });
      }
    },
    [draftThreadsByThreadId, setDraftThreadContext],
  );

  const archiveThread = useCallback(
    async (threadId: ThreadId) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) return;
      if (thread.session?.status === "running" && thread.session.activeTurnId != null) {
        throw new Error("Cannot archive a running thread.");
      }
      const nextWorkspaceThread =
        routeThreadId === threadId && thread.workspaceId
          ? (threads.find(
              (entry) =>
                entry.id !== threadId &&
                entry.archivedAt === null &&
                entry.projectId === thread.projectId &&
                entry.workspaceId === thread.workspaceId,
            ) ?? null)
          : null;
      const nextWorkspaceContext = resolveExistingWorkspaceContext({
        workspaceId: thread.workspaceId,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        workspaces,
      });

      await api.orchestration.dispatchCommand({
        type: "thread.archive",
        commandId: newCommandId(),
        threadId,
      });

      if (routeThreadId === threadId) {
        if (nextWorkspaceThread) {
          await navigate({
            to: "/$threadId",
            params: { threadId: nextWorkspaceThread.id },
            replace: true,
          });
          return;
        }

        await handleNewThread(thread.projectId, {
          workspaceId: nextWorkspaceContext.workspaceId,
          branch: nextWorkspaceContext.branch,
          worktreePath: nextWorkspaceContext.worktreePath,
          envMode: nextWorkspaceContext.worktreePath ? "worktree" : "local",
        });
      }
    },
    [handleNewThread, navigate, routeThreadId, threads, workspaces],
  );

  const confirmAndArchiveThread = useCallback(
    async (
      threadId: ThreadId,
      options: {
        forceConfirm?: boolean;
      } = {},
    ) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) return;

      if (options.forceConfirm || appSettings.confirmThreadArchive) {
        const confirmed = await api.dialogs.confirm(
          [
            `Archive thread "${thread.title}"?`,
            "You can restore it later from Settings > Archive.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }

      await archiveThread(threadId);
    },
    [appSettings.confirmThreadArchive, archiveThread, threads],
  );

  const unarchiveThread = useCallback(async (threadId: ThreadId) => {
    const api = readNativeApi();
    if (!api) return;
    await api.orchestration.dispatchCommand({
      type: "thread.unarchive",
      commandId: newCommandId(),
      threadId,
    });
  }, []);

  const deleteThread = useCallback(
    async (threadId: ThreadId, opts: { deletedThreadIds?: ReadonlySet<ThreadId> } = {}) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) return;
      const threadProject = projects.find((project) => project.id === thread.projectId);
      const deletedIds = opts.deletedThreadIds;
      const survivingThreads =
        deletedIds && deletedIds.size > 0
          ? threads.filter((entry) => entry.id === threadId || !deletedIds.has(entry.id))
          : threads;
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(survivingThreads, threadId);
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
      const shouldDeleteWorktree =
        canDeleteWorktree &&
        (await api.dialogs.confirm(
          [
            "This thread is the only one linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
        ));

      if (thread.session && thread.session.status !== "closed") {
        await api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }

      try {
        await api.terminal.close({ threadId, deleteHistory: true });
      } catch {
        // Terminal may already be closed.
      }

      const deletedThreadIds = opts.deletedThreadIds ?? new Set<ThreadId>();
      const shouldNavigateToFallback = routeThreadId === threadId;
      const fallbackThreadId = getFallbackThreadIdAfterDelete({
        threads,
        deletedThreadId: threadId,
        deletedThreadIds,
        sortOrder: appSettings.sidebarThreadSortOrder,
      });
      await api.orchestration.dispatchCommand({
        type: "thread.delete",
        commandId: newCommandId(),
        threadId,
      });
      clearComposerDraftForThread(threadId);
      clearProjectDraftThreadById(thread.projectId, thread.id);
      clearTerminalState(threadId);

      if (shouldNavigateToFallback) {
        if (fallbackThreadId) {
          await navigate({
            to: "/$threadId",
            params: { threadId: fallbackThreadId },
            replace: true,
          });
        } else {
          await navigate({ to: "/", replace: true, search: {} });
        }
      }

      if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
        return;
      }

      try {
        await removeWorktreeMutation.mutateAsync({
          cwd: threadProject.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after thread deletion", {
          threadId,
          projectCwd: threadProject.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add({
          type: "error",
          title: "Thread deleted, but worktree removal failed",
          description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
        });
      }
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalState,
      appSettings.sidebarThreadSortOrder,
      navigate,
      projects,
      removeWorktreeMutation,
      routeThreadId,
      threads,
    ],
  );

  const confirmAndDeleteThread = useCallback(
    async (threadId: ThreadId) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) return;

      if (appSettings.confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete thread "${thread.title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }

      await deleteThread(threadId);
    },
    [appSettings.confirmThreadDelete, deleteThread, threads],
  );

  const deleteWorkspace = useCallback(
    async (workspaceId: WorkspaceId, options: { deleteWorktree?: boolean } = {}) => {
      const api = readNativeApi();
      if (!api) return;
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) return;
      const project = projects.find((entry) => entry.id === workspace.projectId);
      const worktreeReferences = [...threads, ...Object.values(draftThreadsByThreadId)];
      const orphanedWorktreePath = getOrphanedWorktreePathForWorkspace(
        worktreeReferences,
        workspace,
      );
      const shouldDeleteWorktree =
        options.deleteWorktree === true && orphanedWorktreePath !== null && project !== undefined;

      await api.orchestration.dispatchCommand({
        type: "workspace.delete",
        commandId: newCommandId(),
        workspaceId,
      });
      clearWorkspaceFromDraftThreads(workspaceId);

      if (!shouldDeleteWorktree || !project || !orphanedWorktreePath) {
        return;
      }

      try {
        await removeWorktreeMutation.mutateAsync({
          cwd: project.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove worktree after workspace deletion", {
          workspaceId,
          projectCwd: project.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add({
          type: "error",
          title: "Workspace deleted, but worktree removal failed",
          description: `Could not remove ${formatWorktreePathForDisplay(orphanedWorktreePath)}. ${message}`,
        });
      }
    },
    [
      clearWorkspaceFromDraftThreads,
      draftThreadsByThreadId,
      projects,
      removeWorktreeMutation,
      threads,
      workspaces,
    ],
  );

  const confirmAndDeleteWorkspace = useCallback(
    async (workspaceId: WorkspaceId) => {
      const api = readNativeApi();
      if (!api) return;
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) return;

      const linkedThreads = threads.filter((thread) => thread.workspaceId === workspaceId);
      const linkedThreadCount = linkedThreads.length;
      const worktreeReferences = [...threads, ...Object.values(draftThreadsByThreadId)];
      const orphanedWorktreePath = getOrphanedWorktreePathForWorkspace(
        worktreeReferences,
        workspace,
      );
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;

      const confirmed = await api.dialogs.confirm(
        [
          `Delete workspace "${workspace.name}"?`,
          linkedThreadCount > 0
            ? `${linkedThreadCount} session${linkedThreadCount === 1 ? "" : "s"} will stay, but they will no longer be grouped under this workspace.`
            : "This removes the workspace from the sidebar.",
        ].join("\n"),
      );
      if (!confirmed) {
        return;
      }

      const shouldDeleteWorktree =
        orphanedWorktreePath !== null &&
        (await api.dialogs.confirm(
          [
            "This workspace is the only thing linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
        ));

      await deleteWorkspace(workspaceId, { deleteWorktree: shouldDeleteWorktree });
    },
    [deleteWorkspace, draftThreadsByThreadId, threads, workspaces],
  );

  const archiveWorkspace = useCallback(
    async (workspaceId: WorkspaceId) => {
      const api = readNativeApi();
      if (!api) return;
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) return;
      const linkedThreads = threads.filter(
        (thread) => thread.workspaceId === workspaceId && thread.archivedAt === null,
      );
      const runningThread = linkedThreads.find(
        (thread) => thread.session?.status === "running" && thread.session.activeTurnId != null,
      );
      if (runningThread) {
        throw new Error("Cannot archive a workspace while one of its threads is running.");
      }

      for (const thread of linkedThreads) {
        await api.orchestration.dispatchCommand({
          type: "thread.archive",
          commandId: newCommandId(),
          threadId: thread.id,
        });
      }

      await deleteWorkspace(workspaceId);

      if (routeThreadId && linkedThreads.some((thread) => thread.id === routeThreadId)) {
        await handleNewThread(workspace.projectId, {
          workspaceId: null,
          branch: null,
          worktreePath: null,
          envMode: "local",
        });
      }
    },
    [deleteWorkspace, handleNewThread, routeThreadId, threads, workspaces],
  );

  const confirmAndArchiveWorkspace = useCallback(
    async (workspaceId: WorkspaceId) => {
      const api = readNativeApi();
      if (!api) return;
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) return;
      const activeWorkspaceThreads = threads.filter(
        (thread) => thread.workspaceId === workspaceId && thread.archivedAt === null,
      );

      const confirmed = await api.dialogs.confirm(
        [
          `Archive workspace "${workspace.name}"?`,
          activeWorkspaceThreads.length > 0
            ? `${activeWorkspaceThreads.length} active session${activeWorkspaceThreads.length === 1 ? "" : "s"} will be archived and removed from this workspace.`
            : "This workspace will be removed from the sidebar.",
          "The worktree will be kept on disk.",
        ].join("\n"),
      );
      if (!confirmed) {
        return;
      }

      await archiveWorkspace(workspaceId);
    },
    [archiveWorkspace, threads, workspaces],
  );

  return {
    archiveThread,
    confirmAndArchiveThread,
    archiveWorkspace,
    unarchiveThread,
    deleteThread,
    confirmAndDeleteThread,
    deleteWorkspace,
    confirmAndDeleteWorkspace,
    confirmAndArchiveWorkspace,
  };
}
