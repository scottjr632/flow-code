import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  WorkspaceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);
const asWorkspaceId = (value: string): WorkspaceId => WorkspaceId.makeUnsafe(value);

describe("decider project scripts", () => {
  it("emits empty scripts on project.create", async () => {
    const now = new Date().toISOString();
    const readModel = createEmptyReadModel(now);

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-create-scripts"),
          projectId: asProjectId("project-scripts"),
          title: "Scripts",
          workspaceRoot: "/tmp/scripts",
          createdAt: now,
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("project.created");
    expect((event.payload as { scripts: unknown[] }).scripts).toEqual([]);
  });

  it("propagates scripts in project.meta.update payload", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const readModel = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-scripts"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-scripts"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-scripts"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-scripts"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-scripts"),
          title: "Scripts",
          workspaceRoot: "/tmp/scripts",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const scripts = [
      {
        id: "lint",
        name: "Lint",
        command: "bun run lint",
        icon: "lint",
        runOnWorktreeCreate: false,
      },
    ] as const;

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.makeUnsafe("cmd-project-update-scripts"),
          projectId: asProjectId("project-scripts"),
          scripts: Array.from(scripts),
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("project.meta-updated");
    expect((event.payload as { scripts?: unknown[] }).scripts).toEqual(scripts);
  });

  it("emits user message and turn-start-requested events for thread.turn.start", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          projectId: asProjectId("project-1"),
          workspaceId: null,
          title: "Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe("cmd-turn-start"),
          threadId: ThreadId.makeUnsafe("thread-1"),
          message: {
            messageId: asMessageId("message-user-1"),
            role: "user",
            text: "hello",
            attachments: [],
          },
          modelSelection: {
            provider: "codex",
            model: "gpt-5.3-codex",
            options: {
              reasoningEffort: "high",
              fastMode: true,
            },
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: now,
        },
        readModel,
      }),
    );

    expect(Array.isArray(result)).toBe(true);
    const events = Array.isArray(result) ? result : [result];
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("thread.message-sent");
    const turnStartEvent = events[1];
    expect(turnStartEvent?.type).toBe("thread.turn-start-requested");
    expect(turnStartEvent?.causationEventId).toBe(events[0]?.eventId ?? null);
    if (turnStartEvent?.type !== "thread.turn-start-requested") {
      return;
    }
    expect(turnStartEvent.payload).toMatchObject({
      threadId: ThreadId.makeUnsafe("thread-1"),
      messageId: asMessageId("message-user-1"),
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: {
          reasoningEffort: "high",
          fastMode: true,
        },
      },
      runtimeMode: "approval-required",
    });
  });

  it("emits thread.runtime-mode-set from thread.runtime-mode.set", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          projectId: asProjectId("project-1"),
          workspaceId: null,
          title: "Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.runtime-mode.set",
          commandId: CommandId.makeUnsafe("cmd-runtime-mode-set"),
          threadId: ThreadId.makeUnsafe("thread-1"),
          runtimeMode: "approval-required",
          createdAt: now,
        },
        readModel,
      }),
    );

    const singleResult = Array.isArray(result) ? null : result;
    if (singleResult === null) {
      throw new Error("Expected a single runtime-mode-set event.");
    }
    expect(singleResult).toMatchObject({
      type: "thread.runtime-mode-set",
      payload: {
        threadId: ThreadId.makeUnsafe("thread-1"),
        runtimeMode: "approval-required",
      },
    });
  });

  it("emits thread.interaction-mode-set from thread.interaction-mode.set", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          projectId: asProjectId("project-1"),
          workspaceId: null,
          title: "Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.interaction-mode.set",
          commandId: CommandId.makeUnsafe("cmd-interaction-mode-set"),
          threadId: ThreadId.makeUnsafe("thread-1"),
          interactionMode: "plan",
          createdAt: now,
        },
        readModel,
      }),
    );

    const singleResult = Array.isArray(result) ? null : result;
    if (singleResult === null) {
      throw new Error("Expected a single interaction-mode-set event.");
    }
    expect(singleResult).toMatchObject({
      type: "thread.interaction-mode-set",
      payload: {
        threadId: ThreadId.makeUnsafe("thread-1"),
        interactionMode: "plan",
      },
    });
  });

  it("reuses a deleted workspace id when creating a thread for the same worktree path", async () => {
    const now = new Date().toISOString();
    const workspacePath = "/tmp/project/.t3/worktrees/feature-reused";
    const deletedWorkspaceId = asWorkspaceId("workspace-deleted");
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-workspace-reuse"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-workspace-reuse"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-workspace-reuse"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const withDeletedWorkspace = await Effect.runPromise(
      projectEvent(
        await Effect.runPromise(
          projectEvent(withProject, {
            sequence: 2,
            eventId: asEventId("evt-workspace-create-workspace-reuse"),
            aggregateKind: "workspace",
            aggregateId: deletedWorkspaceId,
            type: "workspace.created",
            occurredAt: now,
            commandId: CommandId.makeUnsafe("cmd-workspace-create-workspace-reuse"),
            causationEventId: null,
            correlationId: CommandId.makeUnsafe("cmd-workspace-create-workspace-reuse"),
            metadata: {},
            payload: {
              workspaceId: deletedWorkspaceId,
              projectId: asProjectId("project-1"),
              title: "feature-reused",
              branch: "feature-reused",
              worktreePath: workspacePath,
              createdAt: now,
              updatedAt: now,
            },
          }),
        ),
        {
          sequence: 3,
          eventId: asEventId("evt-workspace-delete-workspace-reuse"),
          aggregateKind: "workspace",
          aggregateId: deletedWorkspaceId,
          type: "workspace.deleted",
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-workspace-delete-workspace-reuse"),
          causationEventId: null,
          correlationId: CommandId.makeUnsafe("cmd-workspace-delete-workspace-reuse"),
          metadata: {},
          payload: {
            workspaceId: deletedWorkspaceId,
            deletedAt: now,
          },
        },
      ),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-thread-create-workspace-reuse"),
          threadId: ThreadId.makeUnsafe("thread-workspace-reuse"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: "feature-reused",
          worktreePath: workspacePath,
          createdAt: now,
        },
        readModel: withDeletedWorkspace,
      }),
    );

    expect(Array.isArray(result)).toBe(true);
    const events = Array.isArray(result) ? result : [result];
    expect(events.map((event) => event.type)).toEqual(["workspace.created", "thread.created"]);

    const workspaceEvent = events[0];
    expect(workspaceEvent?.type).toBe("workspace.created");
    if (workspaceEvent?.type !== "workspace.created") {
      return;
    }
    expect(workspaceEvent.payload.workspaceId).toBe(deletedWorkspaceId);

    const threadEvent = events[1];
    expect(threadEvent?.type).toBe("thread.created");
    if (threadEvent?.type !== "thread.created") {
      return;
    }
    expect(threadEvent.payload.workspaceId).toBe(deletedWorkspaceId);
  });

  it("relinks thread.create to a live workspace when the workspace id is stale", async () => {
    const now = new Date().toISOString();
    const workspacePath = "/tmp/project/.t3/worktrees/feature-live";
    const liveWorkspaceId = asWorkspaceId("workspace-live");
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-workspace-live"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-workspace-live"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-workspace-live"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-workspace-create-workspace-live"),
        aggregateKind: "workspace",
        aggregateId: liveWorkspaceId,
        type: "workspace.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-workspace-create-workspace-live"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-workspace-create-workspace-live"),
        metadata: {},
        payload: {
          workspaceId: liveWorkspaceId,
          projectId: asProjectId("project-1"),
          title: "feature-live",
          branch: "feature-live",
          worktreePath: workspacePath,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-thread-create-workspace-live"),
          threadId: ThreadId.makeUnsafe("thread-workspace-live"),
          projectId: asProjectId("project-1"),
          workspaceId: asWorkspaceId("workspace-stale"),
          title: "Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: "feature-live",
          worktreePath: workspacePath,
          createdAt: now,
        },
        readModel,
      }),
    );

    expect(Array.isArray(result)).toBe(false);
    const singleResult = Array.isArray(result) ? null : result;
    if (singleResult === null) {
      throw new Error("Expected a single thread.created event.");
    }
    expect(singleResult).toMatchObject({
      type: "thread.created",
      payload: {
        workspaceId: liveWorkspaceId,
        worktreePath: workspacePath,
      },
    });
  });

  it("restores a deleted workspace during thread.meta.update when the workspace id is stale", async () => {
    const now = new Date().toISOString();
    const workspacePath = "/tmp/project/.t3/worktrees/feature-restore";
    const deletedWorkspaceId = asWorkspaceId("workspace-restore");
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-workspace-restore"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-workspace-restore"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-workspace-restore"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const withDeletedWorkspace = await Effect.runPromise(
      projectEvent(
        await Effect.runPromise(
          projectEvent(withProject, {
            sequence: 2,
            eventId: asEventId("evt-workspace-create-workspace-restore"),
            aggregateKind: "workspace",
            aggregateId: deletedWorkspaceId,
            type: "workspace.created",
            occurredAt: now,
            commandId: CommandId.makeUnsafe("cmd-workspace-create-workspace-restore"),
            causationEventId: null,
            correlationId: CommandId.makeUnsafe("cmd-workspace-create-workspace-restore"),
            metadata: {},
            payload: {
              workspaceId: deletedWorkspaceId,
              projectId: asProjectId("project-1"),
              title: "feature-restore",
              branch: "feature-restore",
              worktreePath: workspacePath,
              createdAt: now,
              updatedAt: now,
            },
          }),
        ),
        {
          sequence: 3,
          eventId: asEventId("evt-workspace-delete-workspace-restore"),
          aggregateKind: "workspace",
          aggregateId: deletedWorkspaceId,
          type: "workspace.deleted",
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-workspace-delete-workspace-restore"),
          causationEventId: null,
          correlationId: CommandId.makeUnsafe("cmd-workspace-delete-workspace-restore"),
          metadata: {},
          payload: {
            workspaceId: deletedWorkspaceId,
            deletedAt: now,
          },
        },
      ),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withDeletedWorkspace, {
        sequence: 4,
        eventId: asEventId("evt-thread-create-workspace-restore"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-restore"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-thread-create-workspace-restore"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-thread-create-workspace-restore"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-restore"),
          projectId: asProjectId("project-1"),
          workspaceId: null,
          title: "Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-thread-meta-update-workspace-restore"),
          threadId: ThreadId.makeUnsafe("thread-restore"),
          workspaceId: deletedWorkspaceId,
          branch: "feature-restore",
          worktreePath: workspacePath,
        },
        readModel,
      }),
    );

    expect(Array.isArray(result)).toBe(true);
    const events = Array.isArray(result) ? result : [result];
    expect(events.map((event) => event.type)).toEqual(["workspace.created", "thread.meta-updated"]);

    const workspaceEvent = events[0];
    expect(workspaceEvent?.type).toBe("workspace.created");
    if (workspaceEvent?.type !== "workspace.created") {
      return;
    }
    expect(workspaceEvent.payload.workspaceId).toBe(deletedWorkspaceId);

    const threadEvent = events[1];
    expect(threadEvent?.type).toBe("thread.meta-updated");
    if (threadEvent?.type !== "thread.meta-updated") {
      return;
    }
    expect(threadEvent.payload.workspaceId).toBe(deletedWorkspaceId);
    expect(threadEvent.payload.worktreePath).toBe(workspacePath);
  });
});
