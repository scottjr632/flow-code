import {
  DEFAULT_MODEL_BY_PROVIDER,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  markThreadUnread,
  markThreadVisited,
  recordThreadTraversal,
  reorderProjects,
  selectThreadMruIds,
  syncServerReadModel,
  type AppState,
} from "./store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

const PERSISTED_STATE_KEY = "flow:renderer-state:v8";

type MockStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

type MockWindow = {
  localStorage: MockStorage;
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  dispatch: (type: string) => void;
};

function createMockStorage(seed: Record<string, string> = {}): MockStorage {
  const entries = new Map(Object.entries(seed));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
    clear: () => {
      entries.clear();
    },
  };
}

function createMockWindow(seed: Record<string, string> = {}): MockWindow {
  const localStorage = createMockStorage(seed);
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  return {
    localStorage,
    addEventListener: (type, listener) => {
      const handlers = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      handlers.add(listener);
      listeners.set(type, handlers);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
    dispatch: (type) => {
      for (const listener of listeners.get(type) ?? []) {
        if (typeof listener === "function") {
          listener(new Event(type));
        } else {
          listener.handleEvent(new Event(type));
        }
      }
    },
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
      model: "gpt-5-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

function makeState(thread: Thread): AppState {
  return {
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        name: "Project",
        cwd: "/tmp/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        expanded: true,
        scripts: [],
      },
    ],
    workspaces: [],
    workItems: [],
    threads: [thread],
    threadsHydrated: true,
  };
}

function makeReadModelThread(overrides: Partial<OrchestrationReadModel["threads"][number]>) {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    workspaceId: null,
    title: "Thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5.3-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: null,
    ...overrides,
  } satisfies OrchestrationReadModel["threads"][number];
}

function makeReadModel(thread: OrchestrationReadModel["threads"][number]): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-02-27T00:00:00.000Z",
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5.3-codex",
        },
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
        deletedAt: null,
        scripts: [],
      },
    ],
    workspaces: [],
    workItems: [],
    threads: [thread],
  };
}

function makeReadModelProject(
  overrides: Partial<OrchestrationReadModel["projects"][number]>,
): OrchestrationReadModel["projects"][number] {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    title: "Project",
    workspaceRoot: "/tmp/project",
    defaultModelSelection: {
      provider: "codex",
      model: "gpt-5.3-codex",
    },
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    scripts: [],
    ...overrides,
  };
}

describe("store pure functions", () => {
  it("markThreadVisited records a newer visit timestamp for the active thread", () => {
    const initialState = makeState(
      makeThread({
        lastVisitedAt: "2026-02-25T12:30:00.000Z",
      }),
    );

    const next = markThreadVisited(
      initialState,
      ThreadId.makeUnsafe("thread-1"),
      "2026-02-25T12:35:00.000Z",
    );

    expect(next.threads[0]?.lastVisitedAt).toBe("2026-02-25T12:35:00.000Z");
    expect(next.threadMruIds).toBeUndefined();
  });

  it("recordThreadTraversal moves the departed thread to the front of the MRU stack", () => {
    const initialState: AppState = {
      ...makeState(
        makeThread({
          id: ThreadId.makeUnsafe("thread-1"),
        }),
      ),
      threads: [
        makeThread({ id: ThreadId.makeUnsafe("thread-1") }),
        makeThread({ id: ThreadId.makeUnsafe("thread-2") }),
        makeThread({ id: ThreadId.makeUnsafe("thread-3") }),
      ],
      threadMruIds: [
        ThreadId.makeUnsafe("thread-3"),
        ThreadId.makeUnsafe("thread-1"),
        ThreadId.makeUnsafe("thread-2"),
      ],
    };

    const next = recordThreadTraversal(
      initialState,
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-1"),
    );

    expect(next.threadMruIds).toEqual([
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-3"),
    ]);
  });

  it("selectThreadMruIds returns a stable empty fallback when MRU state is absent", () => {
    const first = selectThreadMruIds({});
    const second = selectThreadMruIds({});

    expect(first).toBe(second);
    expect(first).toEqual([]);
  });

  it("markThreadUnread moves lastVisitedAt before completion for a completed thread", () => {
    const latestTurnCompletedAt = "2026-02-25T12:30:00.000Z";
    const initialState = makeState(
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-02-25T12:28:00.000Z",
          startedAt: "2026-02-25T12:28:30.000Z",
          completedAt: latestTurnCompletedAt,
          assistantMessageId: null,
        },
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    const updatedThread = next.threads[0];
    expect(updatedThread).toBeDefined();
    expect(updatedThread?.lastVisitedAt).toBe("2026-02-25T12:29:59.999Z");
    expect(Date.parse(updatedThread?.lastVisitedAt ?? "")).toBeLessThan(
      Date.parse(latestTurnCompletedAt),
    );
  });

  it("markThreadUnread does not change a thread without a completed turn", () => {
    const initialState = makeState(
      makeThread({
        latestTurn: null,
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    expect(next).toEqual(initialState);
  });

  it("reorderProjects moves a project to a target index", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const state: AppState = {
      projects: [
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          expanded: true,
          scripts: [],
        },
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          expanded: true,
          scripts: [],
        },
        {
          id: project3,
          name: "Project 3",
          cwd: "/tmp/project-3",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          expanded: true,
          scripts: [],
        },
      ],
      workspaces: [],
      workItems: [],
      threads: [],
      threadsHydrated: true,
    };

    const next = reorderProjects(state, project1, project3);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project3, project1]);
  });
});

describe("store read model sync", () => {
  it("preserves claude model slugs without an active session", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
        },
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.modelSelection.model).toBe("claude-opus-4-6");
  });

  it("preserves explicit MRU order when syncing the read model", () => {
    const initialState: AppState = {
      ...makeState(makeThread({ id: ThreadId.makeUnsafe("thread-1") })),
      threads: [
        makeThread({ id: ThreadId.makeUnsafe("thread-1") }),
        makeThread({ id: ThreadId.makeUnsafe("thread-2") }),
      ],
      threadMruIds: [ThreadId.makeUnsafe("thread-2"), ThreadId.makeUnsafe("thread-1")],
    };
    const readModel: OrchestrationReadModel = {
      snapshotSequence: 1,
      updatedAt: "2026-02-27T00:00:00.000Z",
      projects: [
        makeReadModelProject({
          id: ProjectId.makeUnsafe("project-1"),
        }),
      ],
      workspaces: [],
      workItems: [],
      threads: [
        makeReadModelThread({
          id: ThreadId.makeUnsafe("thread-1"),
        }),
        makeReadModelThread({
          id: ThreadId.makeUnsafe("thread-2"),
          updatedAt: "2026-02-27T00:10:00.000Z",
        }),
      ],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threadMruIds).toEqual([
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-1"),
    ]);
  });

  it("does not seed lastVisitedAt from updatedAt when hydrating threads", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        id: ThreadId.makeUnsafe("thread-1"),
        updatedAt: "2026-02-27T00:10:00.000Z",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.lastVisitedAt).toBeUndefined();
  });

  it("resolves claude aliases when session provider is claudeAgent", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        modelSelection: {
          provider: "claudeAgent",
          model: "sonnet",
        },
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-02-27T00:00:00.000Z",
        },
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.modelSelection.model).toBe("claude-sonnet-4-6");
  });

  it("preserves project and thread updatedAt timestamps from the read model", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        updatedAt: "2026-02-27T00:05:00.000Z",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects[0]?.updatedAt).toBe("2026-02-27T00:00:00.000Z");
    expect(next.threads[0]?.updatedAt).toBe("2026-02-27T00:05:00.000Z");
  });

  it("maps archivedAt from the read model", () => {
    const initialState = makeState(makeThread());
    const archivedAt = "2026-02-28T00:00:00.000Z";
    const next = syncServerReadModel(
      initialState,
      makeReadModel(
        makeReadModelThread({
          archivedAt,
        }),
      ),
    );

    expect(next.threads[0]?.archivedAt).toBe(archivedAt);
  });

  it("preserves the current project order when syncing incoming read model updates", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const initialState: AppState = {
      projects: [
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          expanded: true,
          scripts: [],
        },
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          expanded: true,
          scripts: [],
        },
      ],
      workspaces: [],
      workItems: [],
      threads: [],
      threadsHydrated: true,
    };
    const readModel: OrchestrationReadModel = {
      snapshotSequence: 2,
      updatedAt: "2026-02-27T00:00:00.000Z",
      projects: [
        makeReadModelProject({
          id: project1,
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
        }),
        makeReadModelProject({
          id: project2,
          title: "Project 2",
          workspaceRoot: "/tmp/project-2",
        }),
        makeReadModelProject({
          id: project3,
          title: "Project 3",
          workspaceRoot: "/tmp/project-3",
        }),
      ],
      workspaces: [],
      workItems: [],
      threads: [],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project1, project3]);
  });
});

describe("store persisted visit state", () => {
  it("restores lastVisitedAt from persisted sidebar state on a cold start", async () => {
    vi.resetModules();
    const mockWindow = createMockWindow({
      [PERSISTED_STATE_KEY]: JSON.stringify({
        expandedProjectCwds: [],
        projectOrderCwds: [],
        threadMruIds: [],
        threadLastVisitedAtById: {
          "thread-1": "2026-02-27T00:09:00.000Z",
        },
      }),
    });
    vi.stubGlobal("window", mockWindow);

    try {
      const { syncServerReadModel: syncColdStartReadModel } = await import("./store");
      const next = syncColdStartReadModel(
        {
          projects: [],
          workspaces: [],
          workItems: [],
          threads: [],
          threadsHydrated: false,
          threadMruIds: [],
        },
        makeReadModel(
          makeReadModelThread({
            id: ThreadId.makeUnsafe("thread-1"),
            updatedAt: "2026-02-27T00:10:00.000Z",
          }),
        ),
      );

      expect(next.threads[0]?.lastVisitedAt).toBe("2026-02-27T00:09:00.000Z");
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("writes lastVisitedAt back to persisted sidebar state", async () => {
    vi.resetModules();
    const mockWindow = createMockWindow();
    vi.stubGlobal("window", mockWindow);

    try {
      const { useStore: isolatedStore } = await import("./store");
      isolatedStore.getState().syncServerReadModel(
        makeReadModel(
          makeReadModelThread({
            id: ThreadId.makeUnsafe("thread-1"),
          }),
        ),
      );
      isolatedStore
        .getState()
        .markThreadVisited(ThreadId.makeUnsafe("thread-1"), "2026-02-27T00:12:00.000Z");

      mockWindow.dispatch("beforeunload");

      expect(
        JSON.parse(mockWindow.localStorage.getItem(PERSISTED_STATE_KEY) ?? "{}"),
      ).toMatchObject({
        threadLastVisitedAtById: {
          "thread-1": "2026-02-27T00:12:00.000Z",
        },
      });
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
