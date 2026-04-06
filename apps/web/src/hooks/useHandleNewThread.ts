import {
  DEFAULT_RUNTIME_MODE,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ProjectId,
  ThreadId,
  type WorkspaceId,
} from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import {
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  type DraftThreadState,
  markPendingAutoSend,
  useComposerDraftStore,
} from "../composerDraftStore";
import { newThreadId } from "../lib/utils";
import { useStore } from "../store";
import { isHomeProjectId } from "../systemProject";
import { DEFAULT_INTERACTION_MODE } from "../types";
import { resolveExistingWorkspaceContext } from "../workspaceContext";

export function useHandleNewThread() {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
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
        initialPrompt?: string;
        initialImages?: ComposerImageAttachment[];
        runtimeMode?: RuntimeMode;
        interactionMode?: ProviderInteractionMode;
      },
    ): Promise<void> => {
      const homeProject = isHomeProjectId(projectId);
      const {
        addImages,
        clearProjectDraftThreadId,
        getDraftThread,
        getDraftThreadByProjectId,
        applyStickyState,
        setPrompt,
        setRuntimeMode,
        setInteractionMode,
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
      }) => {
        const resolved = resolveExistingWorkspaceContext({
          ...context,
          workspaces: useStore.getState().workspaces,
        });
        if (resolved.workspaceId !== null) {
          return resolved;
        }
        if (context.workspaceId !== null && context.worktreePath !== null) {
          return context;
        }
        return resolved;
      };
      const initialPrompt =
        typeof options?.initialPrompt === "string" && options.initialPrompt.length > 0
          ? options.initialPrompt
          : null;
      const normalizedEnvMode: DraftThreadEnvMode = homeProject
        ? "local"
        : (options?.envMode ?? "local");
      const normalizedRuntimeMode: RuntimeMode = homeProject
        ? "read-only"
        : (options?.runtimeMode ?? DEFAULT_RUNTIME_MODE);
      const normalizedInteractionMode: ProviderInteractionMode = homeProject
        ? DEFAULT_INTERACTION_MODE
        : (options?.interactionMode ?? DEFAULT_INTERACTION_MODE);
      const normalizedWorkspaceId = homeProject ? null : (options?.workspaceId ?? null);
      const normalizedBranch = homeProject ? null : (options?.branch ?? null);
      const normalizedWorktreePath = homeProject ? null : (options?.worktreePath ?? null);
      const initialImages = options?.initialImages ?? [];

      /** Populate the composer draft with the initial prompt, images, and settings. */
      const primeDraftContent = (threadId: ThreadId) => {
        if (initialPrompt) {
          setPrompt(threadId, initialPrompt);
        }
        if (initialImages.length > 0) {
          addImages(threadId, initialImages);
        }
        // Apply explicit runtime/interaction mode to the composer draft
        // so the ChatView composer reflects the selection immediately.
        if (options?.runtimeMode && !homeProject) {
          setRuntimeMode(threadId, options.runtimeMode);
        }
        if (options?.interactionMode && !homeProject) {
          setInteractionMode(threadId, options.interactionMode);
        }
        // Mark for auto-send when there is content to submit.
        if (initialPrompt || initialImages.length > 0) {
          markPendingAutoSend(threadId);
        }
      };
      if (storedDraftThread) {
        return (async () => {
          const nextWorkspaceContext = resolveDraftWorkspaceContext({
            workspaceId: homeProject
              ? null
              : hasWorkspaceIdOption
                ? (options?.workspaceId ?? null)
                : (storedDraftThread.workspaceId ?? null),
            branch: homeProject
              ? null
              : hasBranchOption
                ? (options?.branch ?? null)
                : (storedDraftThread.branch ?? null),
            worktreePath: homeProject
              ? null
              : hasWorktreePathOption
                ? (options?.worktreePath ?? null)
                : (storedDraftThread.worktreePath ?? null),
          });
          if (
            storedDraftThread.workspaceId !== nextWorkspaceContext.workspaceId ||
            storedDraftThread.branch !== nextWorkspaceContext.branch ||
            storedDraftThread.worktreePath !== nextWorkspaceContext.worktreePath ||
            (homeProject && storedDraftThread.runtimeMode !== normalizedRuntimeMode) ||
            (homeProject && storedDraftThread.envMode !== normalizedEnvMode) ||
            hasWorkspaceIdOption ||
            hasBranchOption ||
            hasWorktreePathOption ||
            hasEnvModeOption
          ) {
            setDraftThreadContext(storedDraftThread.threadId, {
              workspaceId: nextWorkspaceContext.workspaceId,
              branch: nextWorkspaceContext.branch,
              worktreePath: nextWorkspaceContext.worktreePath,
              ...(hasEnvModeOption || homeProject ? { envMode: normalizedEnvMode } : {}),
              ...(homeProject ? { runtimeMode: normalizedRuntimeMode } : {}),
            });
          }
          setProjectDraftThreadId(projectId, storedDraftThread.threadId);
          primeDraftContent(storedDraftThread.threadId);
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
          workspaceId: homeProject
            ? null
            : hasWorkspaceIdOption
              ? (options?.workspaceId ?? null)
              : (latestActiveDraftThread.workspaceId ?? null),
          branch: homeProject
            ? null
            : hasBranchOption
              ? (options?.branch ?? null)
              : (latestActiveDraftThread.branch ?? null),
          worktreePath: homeProject
            ? null
            : hasWorktreePathOption
              ? (options?.worktreePath ?? null)
              : (latestActiveDraftThread.worktreePath ?? null),
        });
        if (
          latestActiveDraftThread.workspaceId !== nextWorkspaceContext.workspaceId ||
          latestActiveDraftThread.branch !== nextWorkspaceContext.branch ||
          latestActiveDraftThread.worktreePath !== nextWorkspaceContext.worktreePath ||
          (homeProject && latestActiveDraftThread.runtimeMode !== normalizedRuntimeMode) ||
          (homeProject && latestActiveDraftThread.envMode !== normalizedEnvMode) ||
          hasWorkspaceIdOption ||
          hasBranchOption ||
          hasWorktreePathOption ||
          hasEnvModeOption
        ) {
          setDraftThreadContext(routeThreadId, {
            workspaceId: nextWorkspaceContext.workspaceId,
            branch: nextWorkspaceContext.branch,
            worktreePath: nextWorkspaceContext.worktreePath,
            ...(hasEnvModeOption || homeProject ? { envMode: normalizedEnvMode } : {}),
            ...(homeProject ? { runtimeMode: normalizedRuntimeMode } : {}),
          });
        }
        setProjectDraftThreadId(projectId, routeThreadId);
        primeDraftContent(routeThreadId);
        return Promise.resolve();
      }

      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const nextWorkspaceContext = resolveDraftWorkspaceContext({
        workspaceId: normalizedWorkspaceId,
        branch: normalizedBranch,
        worktreePath: normalizedWorktreePath,
      });
      return (async () => {
        setProjectDraftThreadId(projectId, threadId, {
          createdAt,
          workspaceId: nextWorkspaceContext.workspaceId,
          branch: nextWorkspaceContext.branch,
          worktreePath: nextWorkspaceContext.worktreePath,
          envMode: normalizedEnvMode,
          runtimeMode: normalizedRuntimeMode,
          interactionMode: normalizedInteractionMode,
        });
        applyStickyState(threadId);
        primeDraftContent(threadId);

        await navigate({
          to: "/$threadId",
          params: { threadId },
        });
      })();
    },
    [navigate, routeThreadId],
  );

  return {
    activeDraftThread,
    activeThread,
    handleNewThread,
    projects,
    routeThreadId,
  };
}
