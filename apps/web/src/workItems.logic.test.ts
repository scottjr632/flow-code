import { ProjectId, WorkItemId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { WorkItem } from "./types";
import { buildWorkItemRankUpdates } from "./workItems.logic";

const projectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const workItemId = (value: string): WorkItemId => WorkItemId.makeUnsafe(value);

function createWorkItem(
  overrides: Partial<WorkItem> & Pick<WorkItem, "id" | "projectId">,
): WorkItem {
  return {
    id: overrides.id,
    projectId: overrides.projectId,
    title: overrides.title ?? overrides.id,
    notes: overrides.notes ?? null,
    status: overrides.status ?? "todo",
    source: overrides.source ?? "manual",
    workspaceId: overrides.workspaceId ?? null,
    linkedThreadId: overrides.linkedThreadId ?? null,
    rank: overrides.rank ?? 0,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    deletedAt: overrides.deletedAt ?? null,
  };
}

describe("buildWorkItemRankUpdates", () => {
  it("moves an item after the target when dragging forward in the same status", () => {
    const updates = buildWorkItemRankUpdates({
      items: [
        createWorkItem({
          id: workItemId("item-1"),
          projectId: projectId("project-1"),
          status: "todo",
          rank: 0,
        }),
        createWorkItem({
          id: workItemId("item-2"),
          projectId: projectId("project-1"),
          status: "todo",
          rank: 1,
        }),
      ],
      itemId: workItemId("item-1"),
      targetStatus: "todo",
      overItemId: workItemId("item-2"),
    });

    expect(updates).toEqual([
      {
        itemId: workItemId("item-2"),
        status: "todo",
        rank: 0,
      },
      {
        itemId: workItemId("item-1"),
        status: "todo",
        rank: 1,
      },
    ]);
  });

  it("updates the dragged item when moving to a different status with the same rank", () => {
    const updates = buildWorkItemRankUpdates({
      items: [
        createWorkItem({
          id: workItemId("item-1"),
          projectId: projectId("project-1"),
          status: "todo",
          rank: 0,
        }),
      ],
      itemId: workItemId("item-1"),
      targetStatus: "in_progress",
    });

    expect(updates).toEqual([
      {
        itemId: workItemId("item-1"),
        status: "in_progress",
        rank: 0,
      },
    ]);
  });

  it("reindexes the source column after moving an item to a different status", () => {
    const updates = buildWorkItemRankUpdates({
      items: [
        createWorkItem({
          id: workItemId("item-1"),
          projectId: projectId("project-1"),
          status: "todo",
          rank: 0,
        }),
        createWorkItem({
          id: workItemId("item-2"),
          projectId: projectId("project-1"),
          status: "todo",
          rank: 1,
        }),
      ],
      itemId: workItemId("item-1"),
      targetStatus: "done",
    });

    expect(updates).toEqual([
      {
        itemId: workItemId("item-2"),
        status: "todo",
        rank: 0,
      },
      {
        itemId: workItemId("item-1"),
        status: "done",
        rank: 0,
      },
    ]);
  });
});
