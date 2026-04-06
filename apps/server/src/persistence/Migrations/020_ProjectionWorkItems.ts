import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_work_items (
      item_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      workspace_id TEXT,
      linked_thread_id TEXT,
      rank INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_work_items_project_status_rank
    ON projection_work_items(project_id, status, deleted_at, rank, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_work_items_workspace_id
    ON projection_work_items(workspace_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_work_items_linked_thread_id
    ON projection_work_items(linked_thread_id)
  `;
});
