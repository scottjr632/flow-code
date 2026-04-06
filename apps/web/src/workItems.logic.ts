import type { WorkItemStatus, WorkItemId } from "@t3tools/contracts";

import type { WorkItem } from "./types";

export const WORK_ITEM_STATUS_ORDER = [
  "todo",
  "in_progress",
  "done",
] as const satisfies readonly WorkItemStatus[];

export function compareWorkItems(
  left: WorkItem,
  right: WorkItem,
  resolveProjectSortKey: (projectId: WorkItem["projectId"]) => string,
): number {
  const leftProjectKey = resolveProjectSortKey(left.projectId);
  const rightProjectKey = resolveProjectSortKey(right.projectId);
  if (leftProjectKey !== rightProjectKey) {
    return leftProjectKey.localeCompare(rightProjectKey);
  }
  if (left.rank !== right.rank) {
    return left.rank - right.rank;
  }
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt.localeCompare(right.updatedAt);
  }
  return left.id.localeCompare(right.id);
}

export function sortWorkItems(
  items: ReadonlyArray<WorkItem>,
  resolveProjectSortKey: (projectId: WorkItem["projectId"]) => string,
): WorkItem[] {
  return [...items].toSorted((left, right) => compareWorkItems(left, right, resolveProjectSortKey));
}

export interface WorkItemRankUpdate {
  itemId: WorkItemId;
  status: WorkItemStatus;
  rank: number;
}

function hasRankChanged(input: {
  readonly originalItemsById: ReadonlyMap<WorkItemId, WorkItem>;
  readonly item: WorkItem;
  readonly expectedStatus: WorkItemStatus;
  readonly expectedRank: number;
}): boolean {
  const original = input.originalItemsById.get(input.item.id);
  if (!original) {
    return true;
  }
  return original.status !== input.expectedStatus || original.rank !== input.expectedRank;
}

export function buildWorkItemRankUpdates(input: {
  readonly items: ReadonlyArray<WorkItem>;
  readonly itemId: WorkItemId;
  readonly targetStatus: WorkItemStatus;
  readonly overItemId?: WorkItemId | null;
}): WorkItemRankUpdate[] {
  const movingItem = input.items.find((item) => item.id === input.itemId);
  if (!movingItem) {
    return [];
  }

  const originalItemsById = new Map(input.items.map((item) => [item.id, item] as const));
  const projectItems = input.items.filter(
    (item) => item.projectId === movingItem.projectId && item.deletedAt === null,
  );
  const bucketByStatus = new Map<WorkItemStatus, WorkItem[]>(
    WORK_ITEM_STATUS_ORDER.map((status) => [
      status,
      projectItems
        .filter((item) => item.status === status)
        .toSorted((left, right) =>
          left.rank !== right.rank
            ? left.rank - right.rank
            : left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        ),
    ]),
  );

  const targetBucket = [...(bucketByStatus.get(input.targetStatus) ?? [])];
  const overIndex =
    input.overItemId == null ? -1 : targetBucket.findIndex((item) => item.id === input.overItemId);
  const targetBucketWithoutMovingItem = targetBucket.filter((item) => item.id !== movingItem.id);
  const insertIndex =
    overIndex < 0
      ? targetBucketWithoutMovingItem.length
      : Math.min(overIndex, targetBucketWithoutMovingItem.length);
  targetBucketWithoutMovingItem.splice(insertIndex, 0, {
    ...movingItem,
    status: input.targetStatus,
  });
  bucketByStatus.set(input.targetStatus, targetBucketWithoutMovingItem);
  if (movingItem.status !== input.targetStatus) {
    bucketByStatus.set(
      movingItem.status,
      (bucketByStatus.get(movingItem.status) ?? []).filter((item) => item.id !== movingItem.id),
    );
  }

  const changedItems: WorkItemRankUpdate[] = [];
  for (const status of WORK_ITEM_STATUS_ORDER) {
    const bucket = bucketByStatus.get(status) ?? [];
    bucket.forEach((item, index) => {
      if (
        hasRankChanged({
          originalItemsById,
          item,
          expectedStatus: status,
          expectedRank: index,
        })
      ) {
        changedItems.push({
          itemId: item.id,
          status,
          rank: index,
        });
      }
    });
  }

  return changedItems;
}
