import {
  DEFAULT_RUNTIME_MODE,
  type ProjectId,
  ThreadId,
  type WorkspaceId,
} from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { newThreadId } from "../lib/utils";
import { useStore } from "../store";
import { resolveExistingWorkspaceContext } from "../workspaceContext";

export function useHandleNewThread() {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const workspaces = useStore((store) => store.workspaces);
  const navigate = useNavigate();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const activeDraftThread = useComposerDraftStore((store) =>
    routeThreadId ? (store.draftThreadsByThreadId[routeThreadId] ?? null) : null,
  );

  const activeThread = routeThreadId
    ? threads.find((thread) => thread.id === routeThreadId)
    : undefined;

  const handleNewThread = useCallback(
    (
      projectId: ProjectId,
      options?: {
        workspaceId?: WorkspaceId | null;
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
      },
    ): Promise<void> => {
      const {
        clearProjectDraftThreadId,
        getDraftThread,
        getDraftThreadByProjectId,
        applyStickyState,
        setDraftThreadContext,
        setProjectDraftThreadId,
      } = useComposerDraftStore.getState();
      const hasBranchOption = options?.branch !== undefined;
      const hasWorkspaceIdOption = options?.workspaceId !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const storedDraftThread = getDraftThreadByProjectId(projectId);
      const latestActiveDraftThread: DraftThreadState | null = routeThreadId
        ? getDraftThread(routeThreadId)
        : null;
      const resolveDraftWorkspaceContext = (context: {
        workspaceId: WorkspaceId | null;
        branch: string | null;
        worktreePath: string | null;
      }) =>
        resolveExistingWorkspaceContext({
          ...context,
          workspaces,
        });
      if (storedDraftThread) {
        return (async () => {
          const nextWorkspaceContext = resolveDraftWorkspaceContext({
            workspaceId: hasWorkspaceIdOption
              ? (options?.workspaceId ?? null)
              : (storedDraftThread.workspaceId ?? null),
            branch: hasBranchOption
              ? (options?.branch ?? null)
              : (storedDraftThread.branch ?? null),
            worktreePath: hasWorktreePathOption
              ? (options?.worktreePath ?? null)
              : (storedDraftThread.worktreePath ?? null),
          });
          if (
            storedDraftThread.workspaceId !== nextWorkspaceContext.workspaceId ||
            storedDraftThread.branch !== nextWorkspaceContext.branch ||
            storedDraftThread.worktreePath !== nextWorkspaceContext.worktreePath ||
            hasWorkspaceIdOption ||
            hasBranchOption ||
            hasWorktreePathOption ||
            hasEnvModeOption
          ) {
            setDraftThreadContext(storedDraftThread.threadId, {
              workspaceId: nextWorkspaceContext.workspaceId,
              branch: nextWorkspaceContext.branch,
              worktreePath: nextWorkspaceContext.worktreePath,
              ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
            });
          }
          setProjectDraftThreadId(projectId, storedDraftThread.threadId);
          if (routeThreadId === storedDraftThread.threadId) {
            return;
          }
          await navigate({
            to: "/$threadId",
            params: { threadId: storedDraftThread.threadId },
          });
        })();
      }

      clearProjectDraftThreadId(projectId);

      if (
        latestActiveDraftThread &&
        routeThreadId &&
        latestActiveDraftThread.projectId === projectId
      ) {
        const nextWorkspaceContext = resolveDraftWorkspaceContext({
          workspaceId: hasWorkspaceIdOption
            ? (options?.workspaceId ?? null)
            : (latestActiveDraftThread.workspaceId ?? null),
          branch: hasBranchOption
            ? (options?.branch ?? null)
            : (latestActiveDraftThread.branch ?? null),
          worktreePath: hasWorktreePathOption
            ? (options?.worktreePath ?? null)
            : (latestActiveDraftThread.worktreePath ?? null),
        });
        if (
          latestActiveDraftThread.workspaceId !== nextWorkspaceContext.workspaceId ||
          latestActiveDraftThread.branch !== nextWorkspaceContext.branch ||
          latestActiveDraftThread.worktreePath !== nextWorkspaceContext.worktreePath ||
          hasWorkspaceIdOption ||
          hasBranchOption ||
          hasWorktreePathOption ||
          hasEnvModeOption
        ) {
          setDraftThreadContext(routeThreadId, {
            workspaceId: nextWorkspaceContext.workspaceId,
            branch: nextWorkspaceContext.branch,
            worktreePath: nextWorkspaceContext.worktreePath,
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
          });
        }
        setProjectDraftThreadId(projectId, routeThreadId);
        return Promise.resolve();
      }

      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const nextWorkspaceContext = resolveDraftWorkspaceContext({
        workspaceId: options?.workspaceId ?? null,
        branch: options?.branch ?? null,
        worktreePath: options?.worktreePath ?? null,
      });
      return (async () => {
        setProjectDraftThreadId(projectId, threadId, {
          createdAt,
          workspaceId: nextWorkspaceContext.workspaceId,
          branch: nextWorkspaceContext.branch,
          worktreePath: nextWorkspaceContext.worktreePath,
          envMode: options?.envMode ?? "local",
          runtimeMode: DEFAULT_RUNTIME_MODE,
        });
        applyStickyState(threadId);

        await navigate({
          to: "/$threadId",
          params: { threadId },
        });
      })();
    },
    [navigate, routeThreadId, workspaces],
  );

  return {
    activeDraftThread,
    activeThread,
    handleNewThread,
    projects,
    routeThreadId,
  };
}
