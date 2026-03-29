import { IsoDateTime, ProjectId, WorkspaceId } from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionWorkspace = Schema.Struct({
  workspaceId: WorkspaceId,
  projectId: ProjectId,
  title: Schema.String,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionWorkspace = typeof ProjectionWorkspace.Type;

export const GetProjectionWorkspaceInput = Schema.Struct({
  workspaceId: WorkspaceId,
});
export type GetProjectionWorkspaceInput = typeof GetProjectionWorkspaceInput.Type;

export const DeleteProjectionWorkspaceInput = Schema.Struct({
  workspaceId: WorkspaceId,
});
export type DeleteProjectionWorkspaceInput = typeof DeleteProjectionWorkspaceInput.Type;

export const ListProjectionWorkspacesByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectionWorkspacesByProjectInput =
  typeof ListProjectionWorkspacesByProjectInput.Type;

export interface ProjectionWorkspaceRepositoryShape {
  readonly upsert: (row: ProjectionWorkspace) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionWorkspaceInput,
  ) => Effect.Effect<Option.Option<ProjectionWorkspace>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionWorkspace>,
    ProjectionRepositoryError
  >;
  readonly listByProjectId: (
    input: ListProjectionWorkspacesByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionWorkspace>, ProjectionRepositoryError>;
  readonly deleteById: (
    input: DeleteProjectionWorkspaceInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionWorkspaceRepository extends ServiceMap.Service<
  ProjectionWorkspaceRepository,
  ProjectionWorkspaceRepositoryShape
>()("t3/persistence/Services/ProjectionWorkspaces/ProjectionWorkspaceRepository") {}
