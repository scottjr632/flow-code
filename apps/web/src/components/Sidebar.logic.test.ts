import { describe, expect, it } from "vitest";

import {
  deriveDefaultWorkspaceTitle,
  getFallbackThreadIdAfterDelete,
  getThreadIdsForKeyboardTraversal,
  getThreadIdsByMostRecentVisit,
  getProjectSortTimestamp,
  getVisibleThreadsForProject,
  groupThreadsForSidebarProject,
  hasUnseenCompletion,
  isWorkspaceTitleCustomized,
  isContextMenuPointerDown,
  resolveAdjacentThreadId,
  resolveThreadKeyboardTraversal,
  resolveProjectStatusIndicator,
  resolveSidebarNewThreadEnvMode,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  sortProjectsForSidebar,
  sortThreadsForSidebar,
  sortWorkspacesForSidebar,
} from "./Sidebar.logic";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Project,
  type Thread,
  type Workspace,
} from "../types";

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): Parameters<typeof hasUnseenCompletion>[0]["latestTurn"] {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: overrides?.startedAt ?? "2026-03-09T10:00:00.000Z",
    completedAt: overrides?.completedAt ?? "2026-03-09T10:05:00.000Z",
  };
}

describe("hasUnseenCompletion", () => {
  it("returns true when a thread completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
        proposedPlans: [],
        session: null,
      }),
    ).toBe(true);
  });
});

describe("resolveSidebarNewThreadEnvMode", () => {
  it("uses the app default when the caller does not request a specific mode", () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        defaultEnvMode: "worktree",
      }),
    ).toBe("worktree");
  });

  it("preserves an explicit requested mode over the app default", () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        requestedEnvMode: "local",
        defaultEnvMode: "worktree",
      }),
    ).toBe("local");
  });
});

describe("resolveThreadKeyboardTraversal", () => {
  it("switches to the most recently visited other thread on a new traversal", () => {
    const threadIds = [
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-3"),
    ];

    const targetThreadId = resolveThreadKeyboardTraversal({
      threadIds,
      currentThreadId: threadIds[0] ?? null,
      direction: "next",
    });

    expect(targetThreadId).toBe(threadIds[1]);
  });

  it("recomputes against live mru order on every traversal", () => {
    const firstTarget = resolveThreadKeyboardTraversal({
      threadIds: [
        ThreadId.makeUnsafe("thread-1"),
        ThreadId.makeUnsafe("thread-2"),
        ThreadId.makeUnsafe("thread-3"),
      ],
      currentThreadId: ThreadId.makeUnsafe("thread-1"),
      direction: "next",
    });

    expect(firstTarget).toBe(ThreadId.makeUnsafe("thread-2"));

    const secondTarget = resolveThreadKeyboardTraversal({
      threadIds: [
        ThreadId.makeUnsafe("thread-2"),
        ThreadId.makeUnsafe("thread-1"),
        ThreadId.makeUnsafe("thread-3"),
      ],
      currentThreadId: ThreadId.makeUnsafe("thread-2"),
      direction: "next",
    });

    expect(secondTarget).toBe(ThreadId.makeUnsafe("thread-1"));
  });

  it("cycles backwards when reversing traversal direction", () => {
    const threadIds = [
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-3"),
    ];

    const traversal = resolveThreadKeyboardTraversal({
      threadIds,
      currentThreadId: threadIds[0] ?? null,
      direction: "previous",
    });

    expect(traversal).toBe(threadIds[2]);
  });

  it("returns null when there is no other thread to visit", () => {
    const onlyThreadId = ThreadId.makeUnsafe("thread-1");

    const traversal = resolveThreadKeyboardTraversal({
      threadIds: [onlyThreadId],
      currentThreadId: onlyThreadId,
      direction: "next",
    });

    expect(traversal).toBeNull();
  });
});

describe("getThreadIdsByMostRecentVisit", () => {
  it("orders threads by lastVisitedAt before falling back to createdAt", () => {
    const threadIds = getThreadIdsByMostRecentVisit([
      makeThread({
        id: ThreadId.makeUnsafe("thread-1"),
        updatedAt: "2026-03-09T10:10:00.000Z",
        lastVisitedAt: "2026-03-09T10:20:00.000Z",
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-2"),
        updatedAt: "2026-03-09T10:30:00.000Z",
        lastVisitedAt: "2026-03-09T10:15:00.000Z",
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-3"),
        createdAt: "2026-03-09T10:25:00.000Z",
        updatedAt: "2026-03-09T10:30:00.000Z",
      }),
    ]);

    expect(threadIds).toEqual([
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-3"),
    ]);
  });

  it("uses createdAt and id ordering when visit timestamps are unavailable", () => {
    const threadIds = getThreadIdsByMostRecentVisit([
      makeThread({
        id: ThreadId.makeUnsafe("thread-1"),
        createdAt: "2026-03-09T10:00:00.000Z",
        updatedAt: undefined,
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-2"),
        createdAt: "" as never,
        updatedAt: undefined,
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-3"),
        createdAt: "2026-03-09T10:05:00.000Z",
        updatedAt: undefined,
      }),
    ]);

    expect(threadIds).toEqual([
      ThreadId.makeUnsafe("thread-3"),
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-2"),
    ]);
  });
});

describe("getThreadIdsForKeyboardTraversal", () => {
  it("prefers explicit MRU order over timestamp fallback", () => {
    const threadIds = getThreadIdsForKeyboardTraversal(
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-1"),
          lastVisitedAt: "2026-03-09T10:20:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          lastVisitedAt: "2026-03-09T10:10:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-3"),
          lastVisitedAt: "2026-03-09T10:15:00.000Z",
        }),
      ],
      [ThreadId.makeUnsafe("thread-2"), ThreadId.makeUnsafe("thread-1")],
    );

    expect(threadIds).toEqual([
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-3"),
    ]);
  });

  it("excludes the active thread and caps traversal to five entries", () => {
    const threadIds = getThreadIdsForKeyboardTraversal(
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-1"),
          lastVisitedAt: "2026-03-09T10:20:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          lastVisitedAt: "2026-03-09T10:19:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-3"),
          lastVisitedAt: "2026-03-09T10:18:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-4"),
          lastVisitedAt: "2026-03-09T10:17:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-5"),
          lastVisitedAt: "2026-03-09T10:16:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-6"),
          lastVisitedAt: "2026-03-09T10:15:00.000Z",
        }),
      ],
      [
        ThreadId.makeUnsafe("thread-1"),
        ThreadId.makeUnsafe("thread-2"),
        ThreadId.makeUnsafe("thread-3"),
        ThreadId.makeUnsafe("thread-4"),
        ThreadId.makeUnsafe("thread-5"),
        ThreadId.makeUnsafe("thread-6"),
      ],
      ThreadId.makeUnsafe("thread-1"),
    );

    expect(threadIds).toEqual([
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-3"),
      ThreadId.makeUnsafe("thread-4"),
      ThreadId.makeUnsafe("thread-5"),
      ThreadId.makeUnsafe("thread-6"),
    ]);
  });
});

describe("getVisibleThreadsForProject", () => {
  it("limits thread previews until the list is expanded", () => {
    const threads = Array.from({ length: 8 }, (_, index) =>
      makeThread({
        id: ThreadId.makeUnsafe(`thread-${index + 1}`),
        createdAt: `2026-03-09T10:0${index}:00.000Z`,
      }),
    );

    const result = getVisibleThreadsForProject({
      threads,
      activeThreadId: undefined,
      isThreadListExpanded: false,
      previewLimit: 6,
    });

    expect(result.hasHiddenThreads).toBe(true);
    expect(result.visibleThreads.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-3"),
      ThreadId.makeUnsafe("thread-4"),
      ThreadId.makeUnsafe("thread-5"),
      ThreadId.makeUnsafe("thread-6"),
    ]);
  });

  it("keeps the active thread visible when it falls below the preview cut", () => {
    const threads = Array.from({ length: 8 }, (_, index) =>
      makeThread({
        id: ThreadId.makeUnsafe(`thread-${index + 1}`),
        createdAt: `2026-03-09T10:0${index}:00.000Z`,
      }),
    );

    const result = getVisibleThreadsForProject({
      threads,
      activeThreadId: ThreadId.makeUnsafe("thread-8"),
      isThreadListExpanded: false,
      previewLimit: 6,
    });

    expect(result.hasHiddenThreads).toBe(true);
    expect(result.visibleThreads.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-3"),
      ThreadId.makeUnsafe("thread-4"),
      ThreadId.makeUnsafe("thread-5"),
      ThreadId.makeUnsafe("thread-6"),
      ThreadId.makeUnsafe("thread-8"),
    ]);
  });
});

describe("resolveAdjacentThreadId", () => {
  it("resolves adjacent thread ids in ordered sidebar traversal", () => {
    const threads = [
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-3"),
    ];

    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[1] ?? null,
        direction: "previous",
      }),
    ).toBe(threads[0]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[1] ?? null,
        direction: "next",
      }),
    ).toBe(threads[2]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: null,
        direction: "next",
      }),
    ).toBe(threads[0]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: null,
        direction: "previous",
      }),
    ).toBe(threads[2]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[0] ?? null,
        direction: "previous",
      }),
    ).toBeNull();
  });
});

describe("isContextMenuPointerDown", () => {
  it("treats secondary-button presses as context menu gestures on all platforms", () => {
    expect(
      isContextMenuPointerDown({
        button: 2,
        ctrlKey: false,
        isMac: false,
      }),
    ).toBe(true);
  });

  it("treats ctrl+primary-click as a context menu gesture on macOS", () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: true,
      }),
    ).toBe(true);
  });

  it("does not treat ctrl+primary-click as a context menu gesture off macOS", () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: false,
      }),
    ).toBe(false);
  });
});

describe("resolveThreadStatusPill", () => {
  const baseThread = {
    interactionMode: "plan" as const,
    latestTurn: null,
    lastVisitedAt: undefined,
    proposedPlans: [],
    session: {
      provider: "codex" as const,
      status: "running" as const,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      orchestrationStatus: "running" as const,
    },
  };

  it("shows pending approval before all other statuses", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Pending Approval", pulse: false });
  });

  it("shows awaiting input when plan mode is blocked on user answers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Awaiting Input", pulse: false });
  });

  it("falls back to working when the thread is actively running without blockers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });

  it("shows plan ready when a settled plan turn has a proposed plan ready for follow-up", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
              implementedAt: null,
              implementationThreadId: null,
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Plan Ready", pulse: false });
  });

  it("does not show plan ready after the proposed plan was implemented elsewhere", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
              implementedAt: "2026-03-09T10:06:00.000Z",
              implementationThreadId: "thread-implement" as never,
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });

  it("shows completed when there is an unseen completion and no active blocker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestTurn: makeLatestTurn(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });
});

describe("resolveThreadRowClassName", () => {
  it("uses the darker selected palette when a thread is both selected and active", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: true });
    expect(className).toContain("bg-primary/22");
    expect(className).toContain("hover:bg-primary/26");
    expect(className).toContain("dark:bg-primary/30");
    expect(className).not.toContain("bg-accent/85");
  });

  it("uses selected hover colors for selected threads", () => {
    const className = resolveThreadRowClassName({ isActive: false, isSelected: true });
    expect(className).toContain("bg-primary/15");
    expect(className).toContain("hover:bg-primary/19");
    expect(className).toContain("dark:bg-primary/22");
    expect(className).not.toContain("hover:bg-accent");
  });

  it("keeps the accent palette for active-only threads", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: false });
    expect(className).toContain("bg-accent/85");
    expect(className).toContain("hover:bg-accent");
  });
});

describe("resolveProjectStatusIndicator", () => {
  it("returns null when no threads have a notable status", () => {
    expect(resolveProjectStatusIndicator([null, null])).toBeNull();
  });

  it("surfaces the highest-priority actionable state across project threads", () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
        },
        {
          label: "Pending Approval",
          colorClass: "text-amber-600",
          dotClass: "bg-amber-500",
          pulse: false,
        },
        {
          label: "Working",
          colorClass: "text-sky-600",
          dotClass: "bg-sky-500",
          pulse: true,
        },
      ]),
    ).toMatchObject({ label: "Pending Approval", dotClass: "bg-amber-500" });
  });

  it("prefers plan-ready over completed when no stronger action is needed", () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
        },
        {
          label: "Plan Ready",
          colorClass: "text-violet-600",
          dotClass: "bg-violet-500",
          pulse: false,
        },
      ]),
    ).toMatchObject({ label: "Plan Ready", dotClass: "bg-violet-500" });
  });
});

describe("groupThreadsForSidebarProject", () => {
  it("groups threads into workspace sections while preserving thread order", () => {
    const workspaces = [
      makeWorkspace({
        id: "workspace-b" as never,
        name: "feature/b",
      }),
      makeWorkspace({
        id: "workspace-a" as never,
        name: "feature/a",
      }),
    ];
    const threads = [
      makeThread({
        id: ThreadId.makeUnsafe("thread-3"),
        workspaceId: workspaces[0]!.id,
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-2"),
        workspaceId: workspaces[1]!.id,
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-1"),
        workspaceId: workspaces[0]!.id,
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-local"),
        workspaceId: null,
      }),
    ];

    const grouped = groupThreadsForSidebarProject(threads, workspaces);

    expect(grouped.map((section) => section.key)).toEqual([
      "workspace:workspace-b",
      "workspace:workspace-a",
      "workspace:local",
    ]);
    expect(grouped[0]?.threads.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-3"),
      ThreadId.makeUnsafe("thread-1"),
    ]);
    expect(grouped[1]?.workspace?.name).toBe("feature/a");
    expect(grouped[2]?.workspace).toBeNull();
  });

  it("falls back to a local section when a thread references a missing workspace", () => {
    const grouped = groupThreadsForSidebarProject(
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-1"),
          workspaceId: "workspace-missing" as never,
        }),
      ],
      [],
    );

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.workspace).toBeNull();
    expect(grouped[0]?.threads.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-1"),
    ]);
  });
});

describe("workspace title helpers", () => {
  it("uses the branch as the default workspace title when present", () => {
    const workspace = makeWorkspace({
      name: "feature/a",
      branch: "feature/a",
      worktreePath: "/tmp/project/.t3/worktrees/feature-a",
    });

    expect(deriveDefaultWorkspaceTitle(workspace)).toBe("feature/a");
    expect(isWorkspaceTitleCustomized(workspace)).toBe(false);
  });

  it("falls back to the worktree directory when no branch exists", () => {
    const workspace = makeWorkspace({
      name: "feature-a",
      branch: null,
      worktreePath: "/tmp/project/.t3/worktrees/feature-a",
    });

    expect(deriveDefaultWorkspaceTitle(workspace)).toBe("feature-a");
    expect(isWorkspaceTitleCustomized(workspace)).toBe(false);
  });

  it("treats a renamed workspace as customized", () => {
    const workspace = makeWorkspace({
      name: "Release prep",
      branch: "feature/a",
      worktreePath: "/tmp/project/.t3/worktrees/feature-a",
    });

    expect(isWorkspaceTitleCustomized(workspace)).toBe(true);
  });
});

describe("sortWorkspacesForSidebar", () => {
  it("sorts workspaces by the freshest workspace session activity", () => {
    const workspaces = [
      makeWorkspace({
        id: "workspace-a" as never,
        name: "feature/a",
        updatedAt: "2026-03-09T10:00:00.000Z",
      }),
      makeWorkspace({
        id: "workspace-b" as never,
        name: "feature/b",
        updatedAt: "2026-03-09T09:00:00.000Z",
      }),
    ];

    const sorted = sortWorkspacesForSidebar(
      workspaces,
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-1"),
          workspaceId: workspaces[0]!.id,
          updatedAt: "2026-03-09T11:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          workspaceId: workspaces[1]!.id,
          updatedAt: "2026-03-09T12:00:00.000Z",
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((workspace) => workspace.id)).toEqual([
      "workspace-b" as never,
      "workspace-a" as never,
    ]);
  });

  it("falls back to workspace timestamps when a workspace has no sessions yet", () => {
    const workspaces = [
      makeWorkspace({
        id: "workspace-a" as never,
        name: "feature/a",
        createdAt: "2026-03-09T10:00:00.000Z",
      }),
      makeWorkspace({
        id: "workspace-b" as never,
        name: "feature/b",
        createdAt: "2026-03-09T12:00:00.000Z",
      }),
    ];

    const sorted = sortWorkspacesForSidebar(workspaces, [], "created_at");

    expect(sorted.map((workspace) => workspace.id)).toEqual([
      "workspace-b" as never,
      "workspace-a" as never,
    ]);
  });
});

function makeProject(overrides: Partial<Project> = {}): Project {
  const { defaultModelSelection, ...rest } = overrides;
  return {
    id: ProjectId.makeUnsafe("project-1"),
    name: "Project",
    cwd: "/tmp/project",
    defaultModelSelection: {
      provider: "codex",
      model: "gpt-5.4",
      ...defaultModelSelection,
    },
    expanded: true,
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    scripts: [],
    ...rest,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    workspaceId: null,
    title: "Thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5.4",
      ...overrides?.modelSelection,
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-09T10:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace-1" as never,
    projectId: ProjectId.makeUnsafe("project-1"),
    name: "feature/a",
    branch: "feature/a",
    worktreePath: "/tmp/project/.t3/worktrees/feature-a",
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    ...overrides,
  };
}

describe("sortThreadsForSidebar", () => {
  it("sorts threads by the latest user message in recency mode", () => {
    const sorted = sortThreadsForSidebar(
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-1"),
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "2026-03-09T10:10:00.000Z",
          messages: [
            {
              id: "message-1" as never,
              role: "user",
              text: "older",
              createdAt: "2026-03-09T10:01:00.000Z",
              streaming: false,
              completedAt: "2026-03-09T10:01:00.000Z",
            },
          ],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          createdAt: "2026-03-09T10:05:00.000Z",
          updatedAt: "2026-03-09T10:05:00.000Z",
          messages: [
            {
              id: "message-2" as never,
              role: "user",
              text: "newer",
              createdAt: "2026-03-09T10:06:00.000Z",
              streaming: false,
              completedAt: "2026-03-09T10:06:00.000Z",
            },
          ],
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-1"),
    ]);
  });

  it("falls back to thread timestamps when there is no user message", () => {
    const sorted = sortThreadsForSidebar(
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-1"),
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "2026-03-09T10:01:00.000Z",
          messages: [
            {
              id: "message-1" as never,
              role: "assistant",
              text: "assistant only",
              createdAt: "2026-03-09T10:02:00.000Z",
              streaming: false,
              completedAt: "2026-03-09T10:02:00.000Z",
            },
          ],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          createdAt: "2026-03-09T10:05:00.000Z",
          updatedAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-1"),
    ]);
  });

  it("falls back to id ordering when threads have no sortable timestamps", () => {
    const sorted = sortThreadsForSidebar(
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-1"),
          createdAt: "" as never,
          updatedAt: undefined,
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          createdAt: "" as never,
          updatedAt: undefined,
          messages: [],
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-1"),
    ]);
  });

  it("can sort threads by createdAt when configured", () => {
    const sorted = sortThreadsForSidebar(
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          updatedAt: "2026-03-09T10:05:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "2026-03-09T10:10:00.000Z",
        }),
      ],
      "created_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-2"),
    ]);
  });
});

describe("getFallbackThreadIdAfterDelete", () => {
  it("returns the top remaining thread in the deleted thread's project sidebar order", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-oldest"),
          projectId: ProjectId.makeUnsafe("project-1"),
          createdAt: "2026-03-09T10:00:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-active"),
          projectId: ProjectId.makeUnsafe("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-newest"),
          projectId: ProjectId.makeUnsafe("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-other-project"),
          projectId: ProjectId.makeUnsafe("project-2"),
          createdAt: "2026-03-09T10:20:00.000Z",
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.makeUnsafe("thread-active"),
      sortOrder: "created_at",
    });

    expect(fallbackThreadId).toBe(ThreadId.makeUnsafe("thread-newest"));
  });

  it("skips other threads being deleted in the same action", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-active"),
          projectId: ProjectId.makeUnsafe("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-newest"),
          projectId: ProjectId.makeUnsafe("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-next"),
          projectId: ProjectId.makeUnsafe("project-1"),
          createdAt: "2026-03-09T10:07:00.000Z",
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.makeUnsafe("thread-active"),
      deletedThreadIds: new Set([
        ThreadId.makeUnsafe("thread-active"),
        ThreadId.makeUnsafe("thread-newest"),
      ]),
      sortOrder: "created_at",
    });

    expect(fallbackThreadId).toBe(ThreadId.makeUnsafe("thread-next"));
  });
});

describe("sortProjectsForSidebar", () => {
  it("sorts projects by the most recent user message across their threads", () => {
    const projects = [
      makeProject({ id: ProjectId.makeUnsafe("project-1"), name: "Older project" }),
      makeProject({ id: ProjectId.makeUnsafe("project-2"), name: "Newer project" }),
    ];
    const threads = [
      makeThread({
        projectId: ProjectId.makeUnsafe("project-1"),
        updatedAt: "2026-03-09T10:20:00.000Z",
        messages: [
          {
            id: "message-1" as never,
            role: "user",
            text: "older project user message",
            createdAt: "2026-03-09T10:01:00.000Z",
            streaming: false,
            completedAt: "2026-03-09T10:01:00.000Z",
          },
        ],
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-2"),
        projectId: ProjectId.makeUnsafe("project-2"),
        updatedAt: "2026-03-09T10:05:00.000Z",
        messages: [
          {
            id: "message-2" as never,
            role: "user",
            text: "newer project user message",
            createdAt: "2026-03-09T10:05:00.000Z",
            streaming: false,
            completedAt: "2026-03-09T10:05:00.000Z",
          },
        ],
      }),
    ];

    const sorted = sortProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.makeUnsafe("project-2"),
      ProjectId.makeUnsafe("project-1"),
    ]);
  });

  it("falls back to project timestamps when a project has no threads", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.makeUnsafe("project-1"),
          name: "Older project",
          updatedAt: "2026-03-09T10:01:00.000Z",
        }),
        makeProject({
          id: ProjectId.makeUnsafe("project-2"),
          name: "Newer project",
          updatedAt: "2026-03-09T10:05:00.000Z",
        }),
      ],
      [],
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.makeUnsafe("project-2"),
      ProjectId.makeUnsafe("project-1"),
    ]);
  });

  it("falls back to name and id ordering when projects have no sortable timestamps", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.makeUnsafe("project-2"),
          name: "Beta",
          createdAt: undefined,
          updatedAt: undefined,
        }),
        makeProject({
          id: ProjectId.makeUnsafe("project-1"),
          name: "Alpha",
          createdAt: undefined,
          updatedAt: undefined,
        }),
      ],
      [],
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.makeUnsafe("project-1"),
      ProjectId.makeUnsafe("project-2"),
    ]);
  });

  it("preserves manual project ordering", () => {
    const projects = [
      makeProject({ id: ProjectId.makeUnsafe("project-2"), name: "Second" }),
      makeProject({ id: ProjectId.makeUnsafe("project-1"), name: "First" }),
    ];

    const sorted = sortProjectsForSidebar(projects, [], "manual");

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.makeUnsafe("project-2"),
      ProjectId.makeUnsafe("project-1"),
    ]);
  });

  it("ignores archived threads when sorting projects", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.makeUnsafe("project-1"),
          name: "Visible project",
          updatedAt: "2026-03-09T10:01:00.000Z",
        }),
        makeProject({
          id: ProjectId.makeUnsafe("project-2"),
          name: "Archived-only project",
          updatedAt: "2026-03-09T10:00:00.000Z",
        }),
      ],
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-visible"),
          projectId: ProjectId.makeUnsafe("project-1"),
          updatedAt: "2026-03-09T10:02:00.000Z",
          archivedAt: null,
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-archived"),
          projectId: ProjectId.makeUnsafe("project-2"),
          updatedAt: "2026-03-09T10:10:00.000Z",
          archivedAt: "2026-03-09T10:11:00.000Z",
        }),
      ].filter((thread) => thread.archivedAt === null),
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.makeUnsafe("project-1"),
      ProjectId.makeUnsafe("project-2"),
    ]);
  });

  it("returns the project timestamp when no threads are present", () => {
    const timestamp = getProjectSortTimestamp(
      makeProject({ updatedAt: "2026-03-09T10:10:00.000Z" }),
      [],
      "updated_at",
    );

    expect(timestamp).toBe(Date.parse("2026-03-09T10:10:00.000Z"));
  });
});
