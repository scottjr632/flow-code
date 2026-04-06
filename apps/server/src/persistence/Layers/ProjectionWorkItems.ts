import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionWorkItemInput,
  GetProjectionWorkItemInput,
  ListProjectionWorkItemsByProjectInput,
  ProjectionWorkItem,
  ProjectionWorkItemRepository,
  type ProjectionWorkItemRepositoryShape,
} from "../Services/ProjectionWorkItems.ts";

const makeProjectionWorkItemRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionWorkItemRow = SqlSchema.void({
    Request: ProjectionWorkItem,
    execute: (row) =>
      sql`
        INSERT INTO projection_work_items (
          item_id,
          project_id,
          title,
          notes,
          status,
          source,
          workspace_id,
          linked_thread_id,
          rank,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          ${row.itemId},
          ${row.projectId},
          ${row.title},
          ${row.notes},
          ${row.status},
          ${row.source},
          ${row.workspaceId},
          ${row.linkedThreadId},
          ${row.rank},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (item_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          notes = excluded.notes,
          status = excluded.status,
          source = excluded.source,
          workspace_id = excluded.workspace_id,
          linked_thread_id = excluded.linked_thread_id,
          rank = excluded.rank,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionWorkItemRow = SqlSchema.findOneOption({
    Request: GetProjectionWorkItemInput,
    Result: ProjectionWorkItem,
    execute: ({ itemId }) =>
      sql`
        SELECT
          item_id AS "itemId",
          project_id AS "projectId",
          title,
          notes,
          status,
          source,
          workspace_id AS "workspaceId",
          linked_thread_id AS "linkedThreadId",
          rank,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_work_items
        WHERE item_id = ${itemId}
      `,
  });

  const listAllProjectionWorkItemRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionWorkItem,
    execute: () =>
      sql`
        SELECT
          item_id AS "itemId",
          project_id AS "projectId",
          title,
          notes,
          status,
          source,
          workspace_id AS "workspaceId",
          linked_thread_id AS "linkedThreadId",
          rank,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_work_items
        ORDER BY project_id ASC, status ASC, rank ASC, created_at ASC, item_id ASC
      `,
  });

  const listProjectionWorkItemRows = SqlSchema.findAll({
    Request: ListProjectionWorkItemsByProjectInput,
    Result: ProjectionWorkItem,
    execute: ({ projectId }) =>
      sql`
        SELECT
          item_id AS "itemId",
          project_id AS "projectId",
          title,
          notes,
          status,
          source,
          workspace_id AS "workspaceId",
          linked_thread_id AS "linkedThreadId",
          rank,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_work_items
        WHERE project_id = ${projectId}
        ORDER BY status ASC, rank ASC, created_at ASC, item_id ASC
      `,
  });

  const deleteProjectionWorkItemRow = SqlSchema.void({
    Request: DeleteProjectionWorkItemInput,
    execute: ({ itemId }) =>
      sql`
        DELETE FROM projection_work_items
        WHERE item_id = ${itemId}
      `,
  });

  const upsert: ProjectionWorkItemRepositoryShape["upsert"] = (row) =>
    upsertProjectionWorkItemRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkItemRepository.upsert:query")),
    );

  const getById: ProjectionWorkItemRepositoryShape["getById"] = (input) =>
    getProjectionWorkItemRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkItemRepository.getById:query")),
    );

  const listAll: ProjectionWorkItemRepositoryShape["listAll"] = () =>
    listAllProjectionWorkItemRows(undefined).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkItemRepository.listAll:query")),
    );

  const listByProjectId: ProjectionWorkItemRepositoryShape["listByProjectId"] = (input) =>
    listProjectionWorkItemRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkItemRepository.listByProjectId:query")),
    );

  const deleteById: ProjectionWorkItemRepositoryShape["deleteById"] = (input) =>
    deleteProjectionWorkItemRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkItemRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    listByProjectId,
    deleteById,
  } satisfies ProjectionWorkItemRepositoryShape;
});

export const ProjectionWorkItemRepositoryLive = Layer.effect(
  ProjectionWorkItemRepository,
  makeProjectionWorkItemRepository,
);
