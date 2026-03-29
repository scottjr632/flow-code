import { WorkspaceId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { Workspace } from "./types";
import { resolveExistingWorkspaceContext } from "./workspaceContext";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: WorkspaceId.makeUnsafe("workspace-1"),
    projectId: "project-1" as Workspace["projectId"],
    name: "Workspace",
    branch: "feature-a",
    worktreePath: "/tmp/repo/worktrees/feature-a",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveExistingWorkspaceContext", () => {
  it("keeps an existing workspace id and canonical workspace path", () => {
    const workspace = makeWorkspace();

    expect(
      resolveExistingWorkspaceContext({
        workspaceId: workspace.id,
        branch: "stale-branch",
        worktreePath: "/tmp/other",
        workspaces: [workspace],
      }),
    ).toEqual({
      workspaceId: workspace.id,
      branch: workspace.branch,
      worktreePath: workspace.worktreePath,
    });
  });

  it("re-links a stale workspace id when the worktree path still matches a live workspace", () => {
    const workspace = makeWorkspace();

    expect(
      resolveExistingWorkspaceContext({
        workspaceId: WorkspaceId.makeUnsafe("workspace-deleted"),
        branch: "feature-a",
        worktreePath: "/tmp/repo/worktrees/feature-a/",
        workspaces: [workspace],
      }),
    ).toEqual({
      workspaceId: workspace.id,
      branch: workspace.branch,
      worktreePath: workspace.worktreePath,
    });
  });

  it("drops a missing workspace id but preserves branch and worktree path", () => {
    expect(
      resolveExistingWorkspaceContext({
        workspaceId: WorkspaceId.makeUnsafe("workspace-deleted"),
        branch: "feature-stale",
        worktreePath: "/tmp/repo/worktrees/feature-stale",
        workspaces: [],
      }),
    ).toEqual({
      workspaceId: null,
      branch: "feature-stale",
      worktreePath: "/tmp/repo/worktrees/feature-stale",
    });
  });
});
