import { ThreadId, WorkspaceId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { collectActiveTerminalThreadIds } from "./terminalStateCleanup";

const threadId = (id: string): ThreadId => ThreadId.makeUnsafe(id);
const workspaceId = (id: string): WorkspaceId => WorkspaceId.makeUnsafe(id);

describe("collectActiveTerminalThreadIds", () => {
  it("retains non-deleted server threads", () => {
    const activeThreadIds = collectActiveTerminalThreadIds({
      snapshotThreads: [
        { id: threadId("server-1"), workspaceId: null, deletedAt: null },
        { id: threadId("server-2"), workspaceId: null, deletedAt: null },
      ],
      draftThreadIds: [],
    });

    expect(activeThreadIds).toEqual(new Set([threadId("server-1"), threadId("server-2")]));
  });

  it("ignores deleted server threads and keeps local draft threads", () => {
    const activeThreadIds = collectActiveTerminalThreadIds({
      snapshotThreads: [
        { id: threadId("server-active"), workspaceId: null, deletedAt: null },
        {
          id: threadId("server-deleted"),
          workspaceId: null,
          deletedAt: "2026-03-05T08:00:00.000Z",
        },
      ],
      draftThreadIds: [threadId("local-draft")],
    });

    expect(activeThreadIds).toEqual(new Set([threadId("server-active"), threadId("local-draft")]));
  });

  it("retains workspace IDs from threads with workspaces", () => {
    const wsId = workspaceId("ws-1");
    const activeThreadIds = collectActiveTerminalThreadIds({
      snapshotThreads: [
        { id: threadId("thread-1"), workspaceId: wsId, deletedAt: null },
        { id: threadId("thread-2"), workspaceId: wsId, deletedAt: null },
        { id: threadId("thread-3"), workspaceId: null, deletedAt: null },
      ],
      draftThreadIds: [],
    });

    expect(activeThreadIds).toEqual(
      new Set([
        threadId("thread-1"),
        threadId("thread-2"),
        threadId("thread-3"),
        wsId as unknown as ThreadId,
      ]),
    );
  });
});
