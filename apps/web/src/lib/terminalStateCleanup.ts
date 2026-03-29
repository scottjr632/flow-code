import type { ThreadId, WorkspaceId } from "@t3tools/contracts";

interface TerminalRetentionThread {
  id: ThreadId;
  workspaceId: WorkspaceId | null;
  deletedAt: string | null;
}

interface CollectActiveTerminalThreadIdsInput {
  snapshotThreads: readonly TerminalRetentionThread[];
  draftThreadIds: Iterable<ThreadId>;
}

/**
 * Collect all IDs that may own terminal state. This includes thread IDs and
 * workspace IDs (terminals in a workspace are keyed by workspaceId, not threadId).
 */
export function collectActiveTerminalThreadIds(
  input: CollectActiveTerminalThreadIdsInput,
): Set<ThreadId> {
  const activeIds = new Set<ThreadId>();
  for (const thread of input.snapshotThreads) {
    if (thread.deletedAt !== null) continue;
    activeIds.add(thread.id);
    if (thread.workspaceId) {
      activeIds.add(thread.workspaceId as unknown as ThreadId);
    }
  }
  for (const draftThreadId of input.draftThreadIds) {
    activeIds.add(draftThreadId);
  }
  return activeIds;
}
