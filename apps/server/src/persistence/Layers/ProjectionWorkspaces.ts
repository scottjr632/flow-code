import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionWorkspaceInput,
  GetProjectionWorkspaceInput,
  ListProjectionWorkspacesByProjectInput,
  ProjectionWorkspace,
  ProjectionWorkspaceRepository,
  type ProjectionWorkspaceRepositoryShape,
} from "../Services/ProjectionWorkspaces.ts";

const makeProjectionWorkspaceRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionWorkspaceRow = SqlSchema.void({
    Request: ProjectionWorkspace,
    execute: (row) =>
      sql`
        INSERT INTO projection_workspaces (
          workspace_id,
          project_id,
          title,
          branch,
          worktree_path,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          ${row.workspaceId},
          ${row.projectId},
          ${row.title},
          ${row.branch},
          ${row.worktreePath},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (workspace_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          branch = excluded.branch,
          worktree_path = excluded.worktree_path,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionWorkspaceRow = SqlSchema.findOneOption({
    Request: GetProjectionWorkspaceInput,
    Result: ProjectionWorkspace,
    execute: ({ workspaceId }) =>
      sql`
        SELECT
          workspace_id AS "workspaceId",
          project_id AS "projectId",
          title,
          branch,
          worktree_path AS "worktreePath",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_workspaces
        WHERE workspace_id = ${workspaceId}
      `,
  });

  const listProjectionWorkspaceRows = SqlSchema.findAll({
    Request: ListProjectionWorkspacesByProjectInput,
    Result: ProjectionWorkspace,
    execute: ({ projectId }) =>
      sql`
        SELECT
          workspace_id AS "workspaceId",
          project_id AS "projectId",
          title,
          branch,
          worktree_path AS "worktreePath",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_workspaces
        WHERE project_id = ${projectId}
        ORDER BY created_at ASC, workspace_id ASC
      `,
  });

  const listAllProjectionWorkspaceRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionWorkspace,
    execute: () =>
      sql`
        SELECT
          workspace_id AS "workspaceId",
          project_id AS "projectId",
          title,
          branch,
          worktree_path AS "worktreePath",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_workspaces
        ORDER BY created_at ASC, workspace_id ASC
      `,
  });

  const deleteProjectionWorkspaceRow = SqlSchema.void({
    Request: DeleteProjectionWorkspaceInput,
    execute: ({ workspaceId }) =>
      sql`
        DELETE FROM projection_workspaces
        WHERE workspace_id = ${workspaceId}
      `,
  });

  const upsert: ProjectionWorkspaceRepositoryShape["upsert"] = (row) =>
    upsertProjectionWorkspaceRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkspaceRepository.upsert:query")),
    );

  const getById: ProjectionWorkspaceRepositoryShape["getById"] = (input) =>
    getProjectionWorkspaceRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkspaceRepository.getById:query")),
    );

  const listAll: ProjectionWorkspaceRepositoryShape["listAll"] = () =>
    listAllProjectionWorkspaceRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkspaceRepository.listAll:query")),
    );

  const listByProjectId: ProjectionWorkspaceRepositoryShape["listByProjectId"] = (input) =>
    listProjectionWorkspaceRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkspaceRepository.listByProjectId:query")),
    );

  const deleteById: ProjectionWorkspaceRepositoryShape["deleteById"] = (input) =>
    deleteProjectionWorkspaceRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkspaceRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    listByProjectId,
    deleteById,
  } satisfies ProjectionWorkspaceRepositoryShape;
});

export const ProjectionWorkspaceRepositoryLive = Layer.effect(
  ProjectionWorkspaceRepository,
  makeProjectionWorkspaceRepository,
);
