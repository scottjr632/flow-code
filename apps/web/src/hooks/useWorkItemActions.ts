import {
  type ProjectId,
  type WorkItemId,
  type WorkItemStatus,
  type WorkspaceId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { buildTemporaryWorktreeBranchName } from "../components/ChatView.logic";
import { markPendingAutoSend, useComposerDraftStore } from "../composerDraftStore";
import { newCommandId, newThreadId, newWorkItemId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type WorkItem } from "../types";
import { resolveNewWorkspaceBaseBranch } from "../threadLaunch";
import { buildWorkItemLaunchPrompt } from "../workItemPrompt";
import { resolveExistingWorkspaceContext } from "../workspaceContext";
import {
  type WorkItemLaunchMode,
  setPreferredWorkItemLaunchMode,
} from "../workItemLaunchPreferences";
import type { WorkItemRankUpdate } from "../workItems.logic";

export class WorkItemLaunchLinkError extends Error {
  readonly itemId: WorkItemId;
  readonly threadId: string;
  readonly workspaceId: WorkspaceId | null;

  constructor(input: {
    readonly itemId: WorkItemId;
    readonly threadId: string;
    readonly workspaceId: WorkspaceId | null;
    readonly cause: unknown;
  }) {
    const message =
      input.cause instanceof Error
        ? input.cause.message
        : "Work item link update failed after thread creation.";
    super(message);
    this.name = "WorkItemLaunchLinkError";
    this.itemId = input.itemId;
    this.threadId = input.threadId;
    this.workspaceId = input.workspaceId;
  }
}

export function useWorkItemActions() {
  const navigate = useNavigate();
  const projects = useStore((store) => store.projects);
  const workspaces = useStore((store) => store.workspaces);
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);

  const refreshSnapshot = useCallback(async () => {
    const api = readNativeApi();
    if (!api) {
      throw new Error("Native API not found");
    }
    const snapshot = await api.orchestration.getSnapshot();
    syncServerReadModel(snapshot);
    return snapshot;
  }, [syncServerReadModel]);

  const dispatchWithoutRefresh = useCallback(async (command: unknown) => {
    const api = readNativeApi();
    if (!api) {
      throw new Error("Native API not found");
    }
    await api.orchestration.dispatchCommand(command as never);
  }, []);

  const dispatchAndRefresh = useCallback(
    async (command: unknown) => {
      await dispatchWithoutRefresh(command);
      await refreshSnapshot();
    },
    [dispatchWithoutRefresh, refreshSnapshot],
  );

  const createWorkItem = useCallback(
    async (input: {
      readonly projectId: ProjectId;
      readonly title: string;
      readonly notes?: string | null;
      readonly workspaceId?: WorkspaceId | null;
      readonly status?: WorkItemStatus;
      readonly source?: WorkItem["source"];
    }) => {
      const createdAt = new Date().toISOString();
      await dispatchAndRefresh({
        type: "work-item.create",
        commandId: newCommandId(),
        itemId: newWorkItemId(),
        projectId: input.projectId,
        title: input.title,
        notes: input.notes ?? null,
        workspaceId: input.workspaceId ?? null,
        status: input.status ?? "todo",
        source: input.source ?? "manual",
        createdAt,
      });
    },
    [dispatchAndRefresh],
  );

  const updateWorkItem = useCallback(
    async (
      itemId: WorkItemId,
      patch: {
        readonly title?: string;
        readonly notes?: string | null;
        readonly workspaceId?: WorkspaceId | null;
        readonly linkedThreadId?: string | null;
        readonly status?: WorkItemStatus;
        readonly rank?: number;
      },
    ) => {
      await dispatchAndRefresh({
        type: "work-item.update",
        commandId: newCommandId(),
        itemId,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.workspaceId !== undefined ? { workspaceId: patch.workspaceId } : {}),
        ...(patch.linkedThreadId !== undefined ? { linkedThreadId: patch.linkedThreadId } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.rank !== undefined ? { rank: patch.rank } : {}),
      });
    },
    [dispatchAndRefresh],
  );

  const deleteWorkItem = useCallback(
    async (itemId: WorkItemId) => {
      await dispatchAndRefresh({
        type: "work-item.delete",
        commandId: newCommandId(),
        itemId,
      });
    },
    [dispatchAndRefresh],
  );

  const applyRankUpdates = useCallback(
    async (updates: ReadonlyArray<WorkItemRankUpdate>) => {
      if (updates.length === 0) {
        return;
      }
      for (const update of updates) {
        await dispatchWithoutRefresh({
          type: "work-item.update",
          commandId: newCommandId(),
          itemId: update.itemId,
          status: update.status,
          rank: update.rank,
        });
      }
      await refreshSnapshot();
    },
    [dispatchWithoutRefresh, refreshSnapshot],
  );

  const retryLinkWorkItem = useCallback(
    async (input: {
      readonly itemId: WorkItemId;
      readonly threadId: string;
      readonly workspaceId: WorkspaceId | null;
    }) => {
      await dispatchAndRefresh({
        type: "work-item.update",
        commandId: newCommandId(),
        itemId: input.itemId,
        linkedThreadId: input.threadId,
        status: "in_progress",
        ...(input.workspaceId !== null ? { workspaceId: input.workspaceId } : {}),
      });
    },
    [dispatchAndRefresh],
  );

  const launchFromWorkItem = useCallback(
    async (input: { readonly item: WorkItem; readonly mode: WorkItemLaunchMode }) => {
      const api = readNativeApi();
      if (!api) {
        throw new Error("Native API not found");
      }

      const project = projects.find((entry) => entry.id === input.item.projectId);
      if (!project) {
        throw new Error("Work item project no longer exists.");
      }
      if (!project.defaultModelSelection) {
        throw new Error("Project does not have a default model selection.");
      }

      let workspaceId: WorkspaceId | null = null;
      let branch: string | null = null;
      let worktreePath: string | null = null;

      if (input.mode === "workspace") {
        if (input.item.workspaceId) {
          const existingWorkspace = workspaces.find(
            (workspace) => workspace.id === input.item.workspaceId,
          );
          if (!existingWorkspace) {
            throw new Error("Linked workspace no longer exists.");
          }
          const resolved = resolveExistingWorkspaceContext({
            workspaceId: existingWorkspace.id,
            branch: existingWorkspace.branch,
            worktreePath: existingWorkspace.worktreePath,
            workspaces,
          });
          workspaceId = resolved.workspaceId;
          branch = resolved.branch;
          worktreePath = resolved.worktreePath;
        } else {
          const branches = await api.git.listBranches({ cwd: project.cwd });
          const baseBranch = resolveNewWorkspaceBaseBranch(branches.branches);
          if (!baseBranch) {
            throw new Error("No local base branch is available for this project.");
          }
          const worktree = await api.git.createWorktree({
            cwd: project.cwd,
            branch: baseBranch,
            newBranch: buildTemporaryWorktreeBranchName(),
            path: null,
          });
          workspaceId = crypto.randomUUID() as WorkspaceId;
          branch = worktree.worktree.branch;
          worktreePath = worktree.worktree.path;
          await dispatchWithoutRefresh({
            type: "workspace.create",
            commandId: newCommandId(),
            workspaceId,
            projectId: project.id,
            title: worktree.worktree.branch,
            branch,
            worktreePath,
            createdAt: new Date().toISOString(),
          });
        }
      }

      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const initialPrompt = buildWorkItemLaunchPrompt(input.item);

      await dispatchWithoutRefresh({
        type: "thread.create",
        commandId: newCommandId(),
        threadId,
        projectId: project.id,
        workspaceId,
        title: input.item.title,
        modelSelection: project.defaultModelSelection,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch,
        worktreePath,
        createdAt,
      });

      try {
        await dispatchWithoutRefresh({
          type: "work-item.update",
          commandId: newCommandId(),
          itemId: input.item.id,
          linkedThreadId: threadId,
          status: "in_progress",
          ...(workspaceId !== null ? { workspaceId } : {}),
        });
      } catch (error) {
        await refreshSnapshot();
        throw new WorkItemLaunchLinkError({
          itemId: input.item.id,
          threadId,
          workspaceId,
          cause: error,
        });
      }

      useComposerDraftStore.getState().setPrompt(threadId, initialPrompt);
      markPendingAutoSend(threadId);

      setPreferredWorkItemLaunchMode(project.id, input.mode);
      await refreshSnapshot();
      await navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [dispatchWithoutRefresh, navigate, projects, refreshSnapshot, workspaces],
  );

  return {
    applyRankUpdates,
    createWorkItem,
    deleteWorkItem,
    launchFromWorkItem,
    retryLinkWorkItem,
    updateWorkItem,
  };
}
