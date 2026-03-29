import type { WorkspaceId } from "@t3tools/contracts";

import type { Workspace } from "./types";

export interface WorkspaceContext {
  workspaceId: WorkspaceId | null;
  branch: string | null;
  worktreePath: string | null;
}

function normalizeWorktreePath(worktreePath: string | null): string | null {
  const trimmed = worktreePath?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function resolveExistingWorkspaceContext(
  input: WorkspaceContext & {
    workspaces: readonly Pick<Workspace, "id" | "branch" | "worktreePath">[];
  },
): WorkspaceContext {
  if (input.workspaceId) {
    const workspaceById = input.workspaces.find((workspace) => workspace.id === input.workspaceId);
    if (workspaceById) {
      return {
        workspaceId: workspaceById.id,
        branch: workspaceById.branch,
        worktreePath: workspaceById.worktreePath,
      };
    }
  }

  const normalizedWorktreePath = normalizeWorktreePath(input.worktreePath);
  if (normalizedWorktreePath) {
    const workspaceByPath = input.workspaces.find(
      (workspace) => normalizeWorktreePath(workspace.worktreePath) === normalizedWorktreePath,
    );
    if (workspaceByPath) {
      return {
        workspaceId: workspaceByPath.id,
        branch: workspaceByPath.branch,
        worktreePath: workspaceByPath.worktreePath,
      };
    }
  }

  return {
    workspaceId: null,
    branch: input.branch,
    worktreePath: input.worktreePath,
  };
}
