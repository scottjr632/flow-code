import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_workspaces (
      workspace_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN workspace_id TEXT
  `.pipe(Effect.catchTag("SqlError", () => Effect.void));

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_workspaces_project_deleted
    ON projection_workspaces(project_id, deleted_at)
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_workspaces_project_path
    ON projection_workspaces(project_id, worktree_path)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_workspace_id
    ON projection_threads(workspace_id)
  `;
});
