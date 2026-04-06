/**
 * ProjectionWorkItemRepository - Projection repository interface for work items.
 *
 * Owns persistence operations for projected work-item records in the
 * orchestration read model.
 *
 * @module ProjectionWorkItemRepository
 */
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  WorkItemId,
  WorkItemSource,
  WorkItemStatus,
  WorkspaceId,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionWorkItem = Schema.Struct({
  itemId: WorkItemId,
  projectId: ProjectId,
  title: Schema.String,
  notes: Schema.NullOr(Schema.String),
  status: WorkItemStatus,
  source: WorkItemSource,
  workspaceId: Schema.NullOr(WorkspaceId),
  linkedThreadId: Schema.NullOr(ThreadId),
  rank: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionWorkItem = typeof ProjectionWorkItem.Type;

export const GetProjectionWorkItemInput = Schema.Struct({
  itemId: WorkItemId,
});
export type GetProjectionWorkItemInput = typeof GetProjectionWorkItemInput.Type;

export const DeleteProjectionWorkItemInput = Schema.Struct({
  itemId: WorkItemId,
});
export type DeleteProjectionWorkItemInput = typeof DeleteProjectionWorkItemInput.Type;

export const ListProjectionWorkItemsByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectionWorkItemsByProjectInput =
  typeof ListProjectionWorkItemsByProjectInput.Type;

export interface ProjectionWorkItemRepositoryShape {
  readonly upsert: (item: ProjectionWorkItem) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionWorkItemInput,
  ) => Effect.Effect<Option.Option<ProjectionWorkItem>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionWorkItem>,
    ProjectionRepositoryError
  >;
  readonly listByProjectId: (
    input: ListProjectionWorkItemsByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionWorkItem>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: DeleteProjectionWorkItemInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionWorkItemRepository extends ServiceMap.Service<
  ProjectionWorkItemRepository,
  ProjectionWorkItemRepositoryShape
>()("t3/persistence/Services/ProjectionWorkItems/ProjectionWorkItemRepository") {}
