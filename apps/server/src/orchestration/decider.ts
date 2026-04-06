import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationWorkItem,
  OrchestrationWorkspace,
  WorkspaceId,
} from "@t3tools/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { isSystemProject } from "../systemProject.ts";
import {
  findWorkspaceById,
  findWorkspaceByProjectAndWorktreePath,
  findWorkspaceByProjectAndWorktreePathIncludingDeleted,
  listWorkItemsByProjectId,
  requireProject,
  requireProjectAbsent,
  requireThread,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
  requireWorkItem,
  requireWorkItemAbsent,
  requireWorkspace,
  requireWorkspaceAbsent,
} from "./commandInvariants.ts";

const nowIso = () => new Date().toISOString();
const defaultMetadata: Omit<OrchestrationEvent, "sequence" | "type" | "payload"> = {
  eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
  aggregateKind: "thread",
  aggregateId: "" as OrchestrationEvent["aggregateId"],
  occurredAt: nowIso(),
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
};

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Omit<OrchestrationEvent, "sequence" | "type" | "payload"> {
  return {
    ...defaultMetadata,
    eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    correlationId: input.commandId,
    metadata: input.metadata ?? {},
  };
}

function invariantError(commandType: string, detail: string): OrchestrationCommandInvariantError {
  return new OrchestrationCommandInvariantError({ commandType, detail });
}

function deriveWorkspaceTitle(input: {
  readonly branch: string | null;
  readonly worktreePath: string;
}) {
  if (input.branch) {
    return input.branch;
  }
  const normalizedPath = input.worktreePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalizedPath.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? input.worktreePath;
}

function resolveWorkspaceBranch(
  workspace: OrchestrationWorkspace,
  branch: string | null | undefined,
): string | null {
  return branch === undefined ? workspace.branch : branch;
}

function nextWorkItemRank(
  readModel: OrchestrationReadModel,
  projectId: OrchestrationWorkItem["projectId"],
  status: OrchestrationWorkItem["status"],
): number {
  const ranks = listWorkItemsByProjectId(readModel, projectId)
    .filter((item) => item.deletedAt === null && item.status === status)
    .map((item) => item.rank);
  if (ranks.length === 0) {
    return 0;
  }
  return Math.max(...ranks) + 1;
}

function workItemUpdatedEvent(input: {
  readonly itemId: OrchestrationWorkItem["id"];
  readonly commandId: OrchestrationCommand["commandId"];
  readonly occurredAt: string;
  readonly title?: OrchestrationWorkItem["title"];
  readonly notes?: OrchestrationWorkItem["notes"];
  readonly status?: OrchestrationWorkItem["status"];
  readonly workspaceId?: OrchestrationWorkItem["workspaceId"];
  readonly linkedThreadId?: OrchestrationWorkItem["linkedThreadId"];
  readonly rank?: OrchestrationWorkItem["rank"];
}): Omit<OrchestrationEvent, "sequence"> {
  return {
    ...withEventBase({
      aggregateKind: "work-item",
      aggregateId: input.itemId,
      occurredAt: input.occurredAt,
      commandId: input.commandId,
    }),
    type: "work-item.updated",
    payload: {
      itemId: input.itemId,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      ...(input.linkedThreadId !== undefined ? { linkedThreadId: input.linkedThreadId } : {}),
      ...(input.rank !== undefined ? { rank: input.rank } : {}),
      updatedAt: input.occurredAt,
    },
  };
}

interface ThreadWorkspaceResolution {
  readonly workspaceId: WorkspaceId;
  readonly branch: string | null | undefined;
  readonly worktreePath: string;
  readonly events: Array<Omit<OrchestrationEvent, "sequence">>;
}

function workspaceCreatedEvent(input: {
  readonly workspaceId: WorkspaceId;
  readonly projectId: OrchestrationWorkspace["projectId"];
  readonly branch: string | null;
  readonly worktreePath: string;
  readonly occurredAt: string;
  readonly commandId: OrchestrationCommand["commandId"];
}): Omit<OrchestrationEvent, "sequence"> {
  return {
    ...withEventBase({
      aggregateKind: "workspace",
      aggregateId: input.workspaceId,
      occurredAt: input.occurredAt,
      commandId: input.commandId,
    }),
    type: "workspace.created",
    payload: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      title: deriveWorkspaceTitle({ branch: input.branch, worktreePath: input.worktreePath }),
      branch: input.branch,
      worktreePath: input.worktreePath,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    },
  };
}

function workspaceBranchUpdatedEvent(input: {
  readonly workspaceId: WorkspaceId;
  readonly branch: string | null;
  readonly occurredAt: string;
  readonly commandId: OrchestrationCommand["commandId"];
}): Omit<OrchestrationEvent, "sequence"> {
  return {
    ...withEventBase({
      aggregateKind: "workspace",
      aggregateId: input.workspaceId,
      occurredAt: input.occurredAt,
      commandId: input.commandId,
    }),
    type: "workspace.meta-updated",
    payload: {
      workspaceId: input.workspaceId,
      branch: input.branch,
      updatedAt: input.occurredAt,
    },
  };
}

function resolveWorkspaceByWorktreePath(input: {
  readonly readModel: OrchestrationReadModel;
  readonly projectId: OrchestrationWorkspace["projectId"];
  readonly branch: string | null | undefined;
  readonly worktreePath: string;
  readonly occurredAt: string;
  readonly commandId: OrchestrationCommand["commandId"];
  readonly preferredWorkspaceId?: WorkspaceId;
}): ThreadWorkspaceResolution {
  const existingWorkspace = findWorkspaceByProjectAndWorktreePath(
    input.readModel,
    input.projectId,
    input.worktreePath,
  );
  if (existingWorkspace) {
    const events =
      input.branch !== undefined && input.branch !== existingWorkspace.branch
        ? [
            workspaceBranchUpdatedEvent({
              workspaceId: existingWorkspace.id,
              branch: input.branch,
              occurredAt: input.occurredAt,
              commandId: input.commandId,
            }),
          ]
        : [];
    return {
      workspaceId: existingWorkspace.id,
      branch: input.branch,
      worktreePath: existingWorkspace.worktreePath,
      events,
    };
  }

  const deletedWorkspace = findWorkspaceByProjectAndWorktreePathIncludingDeleted(
    input.readModel,
    input.projectId,
    input.worktreePath,
  );
  const workspaceId =
    deletedWorkspace?.id ?? input.preferredWorkspaceId ?? (crypto.randomUUID() as WorkspaceId);
  const branch = deletedWorkspace
    ? resolveWorkspaceBranch(deletedWorkspace, input.branch)
    : (input.branch ?? null);

  return {
    workspaceId,
    branch,
    worktreePath: input.worktreePath,
    events: [
      workspaceCreatedEvent({
        workspaceId,
        projectId: input.projectId,
        branch,
        worktreePath: input.worktreePath,
        occurredAt: input.occurredAt,
        commandId: input.commandId,
      }),
    ],
  };
}

function resolveExplicitWorkspaceReference(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: OrchestrationWorkspace["projectId"];
  readonly workspaceId: WorkspaceId;
  readonly branch: string | null | undefined;
  readonly worktreePath: string | null | undefined;
  readonly occurredAt: string;
}): Effect.Effect<ThreadWorkspaceResolution, OrchestrationCommandInvariantError> {
  const workspace = findWorkspaceById(input.readModel, input.workspaceId);

  if (workspace && workspace.deletedAt === null) {
    if (workspace.projectId !== input.projectId) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Workspace '${input.workspaceId}' does not belong to project '${input.projectId}'.`,
        ),
      );
    }
    if (input.worktreePath !== null && input.worktreePath !== undefined) {
      if (input.worktreePath !== workspace.worktreePath) {
        return Effect.fail(
          invariantError(
            input.command.type,
            `Workspace '${input.workspaceId}' path does not match thread worktree path.`,
          ),
        );
      }
    }
    return Effect.succeed({
      workspaceId: workspace.id,
      branch: resolveWorkspaceBranch(workspace, input.branch),
      worktreePath: workspace.worktreePath,
      events: [],
    });
  }

  if (workspace) {
    if (workspace.projectId !== input.projectId) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Workspace '${input.workspaceId}' does not belong to project '${input.projectId}'.`,
        ),
      );
    }
    if (input.worktreePath === null || input.worktreePath === undefined) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Workspace '${input.workspaceId}' does not exist for command '${input.command.type}'.`,
        ),
      );
    }
    if (input.worktreePath !== workspace.worktreePath) {
      return Effect.fail(
        invariantError(
          input.command.type,
          `Workspace '${input.workspaceId}' path does not match thread worktree path.`,
        ),
      );
    }
    const branch = resolveWorkspaceBranch(workspace, input.branch);
    return Effect.succeed({
      workspaceId: workspace.id,
      branch,
      worktreePath: workspace.worktreePath,
      events: [
        workspaceCreatedEvent({
          workspaceId: workspace.id,
          projectId: input.projectId,
          branch,
          worktreePath: workspace.worktreePath,
          occurredAt: input.occurredAt,
          commandId: input.command.commandId,
        }),
      ],
    });
  }

  if (input.worktreePath === null || input.worktreePath === undefined) {
    return Effect.fail(
      invariantError(
        input.command.type,
        `Workspace '${input.workspaceId}' does not exist for command '${input.command.type}'.`,
      ),
    );
  }

  return Effect.succeed(
    resolveWorkspaceByWorktreePath({
      readModel: input.readModel,
      projectId: input.projectId,
      branch: input.branch,
      worktreePath: input.worktreePath,
      occurredAt: input.occurredAt,
      commandId: input.command.commandId,
      preferredWorkspaceId: input.workspaceId,
    }),
  );
}

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  Omit<OrchestrationEvent, "sequence"> | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
  OrchestrationCommandInvariantError
> {
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });

      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          defaultModelSelection: command.defaultModelSelection ?? null,
          scripts: [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      const project = yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      if (isSystemProject(project)) {
        return yield* invariantError(
          command.type,
          `System project '${command.projectId}' cannot be modified.`,
        );
      }
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "project.delete": {
      const project = yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      if (isSystemProject(project)) {
        return yield* invariantError(
          command.type,
          `System project '${command.projectId}' cannot be deleted.`,
        );
      }
      const occurredAt = nowIso();
      const workItemDeleteEvents = listWorkItemsByProjectId(readModel, command.projectId)
        .filter((item) => item.deletedAt === null)
        .map((item) => {
          const eventBase = withEventBase({
            aggregateKind: "work-item" as const,
            aggregateId: item.id,
            occurredAt,
            commandId: command.commandId,
          });

          return {
            eventId: eventBase.eventId,
            aggregateKind: eventBase.aggregateKind,
            aggregateId: eventBase.aggregateId,
            occurredAt: eventBase.occurredAt,
            commandId: eventBase.commandId,
            causationEventId: eventBase.causationEventId,
            correlationId: eventBase.correlationId,
            metadata: eventBase.metadata,
            type: "work-item.deleted" as const,
            payload: {
              itemId: item.id,
              deletedAt: occurredAt,
            },
          };
        });
      return [
        {
          ...withEventBase({
            aggregateKind: "project",
            aggregateId: command.projectId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "project.deleted" as const,
          payload: {
            projectId: command.projectId,
            deletedAt: occurredAt,
          },
        },
        ...workItemDeleteEvents,
      ];
    }

    case "workspace.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireWorkspaceAbsent({
        readModel,
        command,
        workspaceId: command.workspaceId,
      });
      return {
        ...withEventBase({
          aggregateKind: "workspace",
          aggregateId: command.workspaceId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "workspace.created",
        payload: {
          workspaceId: command.workspaceId,
          projectId: command.projectId,
          title: command.title,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "workspace.meta.update": {
      yield* requireWorkspace({
        readModel,
        command,
        workspaceId: command.workspaceId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "workspace",
          aggregateId: command.workspaceId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "workspace.meta-updated",
        payload: {
          workspaceId: command.workspaceId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.branch !== undefined ? { branch: command.branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "workspace.delete": {
      yield* requireWorkspace({
        readModel,
        command,
        workspaceId: command.workspaceId,
      });
      const occurredAt = nowIso();
      const detachEvents = readModel.threads
        .filter((thread) => thread.deletedAt === null && thread.workspaceId === command.workspaceId)
        .map((thread) => {
          const eventBase = withEventBase({
            aggregateKind: "thread" as const,
            aggregateId: thread.id,
            occurredAt,
            commandId: command.commandId,
          });
          return {
            eventId: eventBase.eventId,
            aggregateKind: eventBase.aggregateKind,
            aggregateId: eventBase.aggregateId,
            occurredAt: eventBase.occurredAt,
            commandId: eventBase.commandId,
            causationEventId: eventBase.causationEventId,
            correlationId: eventBase.correlationId,
            metadata: eventBase.metadata,
            type: "thread.meta-updated" as const,
            payload: {
              threadId: thread.id,
              workspaceId: null,
              updatedAt: occurredAt,
            },
          };
        });
      const detachWorkItemEvents = readModel.workItems
        .filter((item) => item.deletedAt === null && item.workspaceId === command.workspaceId)
        .map((item) =>
          workItemUpdatedEvent({
            itemId: item.id,
            commandId: command.commandId,
            occurredAt,
            workspaceId: null,
          }),
        );
      return [
        {
          ...withEventBase({
            aggregateKind: "workspace",
            aggregateId: command.workspaceId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "workspace.deleted",
          payload: {
            workspaceId: command.workspaceId,
            deletedAt: occurredAt,
          },
        },
        ...detachEvents,
        ...detachWorkItemEvents,
      ];
    }

    case "work-item.create": {
      yield* requireWorkItemAbsent({
        readModel,
        command,
        itemId: command.itemId,
      });
      const project = yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      if (isSystemProject(project)) {
        return yield* invariantError(
          command.type,
          `System project '${command.projectId}' cannot own work items.`,
        );
      }

      let workspaceId: WorkspaceId | null = null;
      if (command.workspaceId !== undefined && command.workspaceId !== null) {
        const workspace = yield* requireWorkspace({
          readModel,
          command,
          workspaceId: command.workspaceId,
        });
        if (workspace.projectId !== command.projectId) {
          return yield* invariantError(
            command.type,
            `Workspace '${command.workspaceId}' does not belong to project '${command.projectId}'.`,
          );
        }
        workspaceId = workspace.id;
      }

      let linkedThreadId: OrchestrationWorkItem["linkedThreadId"] = null;
      if (command.linkedThreadId !== undefined && command.linkedThreadId !== null) {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.linkedThreadId,
        });
        if (thread.projectId !== command.projectId) {
          return yield* invariantError(
            command.type,
            `Thread '${command.linkedThreadId}' does not belong to project '${command.projectId}'.`,
          );
        }
        linkedThreadId = thread.id;
      }

      const rank = command.rank ?? nextWorkItemRank(readModel, command.projectId, command.status);

      return {
        ...withEventBase({
          aggregateKind: "work-item",
          aggregateId: command.itemId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "work-item.created",
        payload: {
          itemId: command.itemId,
          projectId: command.projectId,
          title: command.title,
          notes: command.notes ?? null,
          status: command.status,
          source: command.source,
          workspaceId,
          linkedThreadId,
          rank,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "work-item.update": {
      const existingItem = yield* requireWorkItem({
        readModel,
        command,
        itemId: command.itemId,
      });
      const occurredAt = nowIso();

      let workspaceId = existingItem.workspaceId;
      if (command.workspaceId === null) {
        workspaceId = null;
      } else if (command.workspaceId !== undefined) {
        const workspace = yield* requireWorkspace({
          readModel,
          command,
          workspaceId: command.workspaceId,
        });
        if (workspace.projectId !== existingItem.projectId) {
          return yield* invariantError(
            command.type,
            `Workspace '${command.workspaceId}' does not belong to project '${existingItem.projectId}'.`,
          );
        }
        workspaceId = workspace.id;
      }

      let linkedThreadId = existingItem.linkedThreadId;
      if (command.linkedThreadId === null) {
        linkedThreadId = null;
      } else if (command.linkedThreadId !== undefined) {
        const thread = yield* requireThread({
          readModel,
          command,
          threadId: command.linkedThreadId,
        });
        if (thread.projectId !== existingItem.projectId) {
          return yield* invariantError(
            command.type,
            `Thread '${command.linkedThreadId}' does not belong to project '${existingItem.projectId}'.`,
          );
        }
        linkedThreadId = thread.id;
      }

      const nextStatus = command.status ?? existingItem.status;
      const rank =
        command.rank ??
        (command.status !== undefined && command.status !== existingItem.status
          ? nextWorkItemRank(readModel, existingItem.projectId, nextStatus)
          : existingItem.rank);

      return workItemUpdatedEvent({
        itemId: command.itemId,
        commandId: command.commandId,
        occurredAt,
        ...(command.title !== undefined ? { title: command.title } : {}),
        ...(command.notes !== undefined ? { notes: command.notes } : {}),
        ...(command.status !== undefined ? { status: nextStatus } : {}),
        ...(command.workspaceId !== undefined ? { workspaceId } : {}),
        ...(command.linkedThreadId !== undefined ? { linkedThreadId } : {}),
        ...(command.rank !== undefined || command.status !== undefined ? { rank } : {}),
      });
    }

    case "work-item.delete": {
      yield* requireWorkItem({
        readModel,
        command,
        itemId: command.itemId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "work-item",
          aggregateId: command.itemId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "work-item.deleted",
        payload: {
          itemId: command.itemId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });
      let workspaceId: WorkspaceId | null = null;
      let branch = command.branch;
      let worktreePath = command.worktreePath;
      const events: Array<Omit<OrchestrationEvent, "sequence">> = [];

      if (command.workspaceId !== undefined && command.workspaceId !== null) {
        const resolvedWorkspace = yield* resolveExplicitWorkspaceReference({
          readModel,
          command,
          projectId: command.projectId,
          workspaceId: command.workspaceId,
          branch,
          worktreePath,
          occurredAt: command.createdAt,
        });
        workspaceId = resolvedWorkspace.workspaceId;
        branch = resolvedWorkspace.branch ?? null;
        worktreePath = resolvedWorkspace.worktreePath;
        events.push(...resolvedWorkspace.events);
      } else if (worktreePath !== null) {
        const resolvedWorkspace = resolveWorkspaceByWorktreePath({
          readModel,
          projectId: command.projectId,
          branch,
          worktreePath,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        });
        workspaceId = resolvedWorkspace.workspaceId;
        branch = resolvedWorkspace.branch ?? null;
        worktreePath = resolvedWorkspace.worktreePath;
        events.push(...resolvedWorkspace.events);
      }

      events.push({
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          workspaceId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch,
          worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      });
      return events.length === 1 ? events[0]! : events;
    }

    case "thread.delete": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      const detachWorkItemEvents = readModel.workItems
        .filter((item) => item.deletedAt === null && item.linkedThreadId === thread.id)
        .map((item) =>
          workItemUpdatedEvent({
            itemId: item.id,
            commandId: command.commandId,
            occurredAt,
            linkedThreadId: null,
          }),
        );
      return [
        {
          ...withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          }),
          type: "thread.deleted",
          payload: {
            threadId: command.threadId,
            deletedAt: occurredAt,
          },
        },
        ...detachWorkItemEvents,
      ];
    }

    case "thread.archive": {
      yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.archived",
        payload: {
          threadId: command.threadId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.unarchive": {
      yield* requireThreadArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.unarchived",
        payload: {
          threadId: command.threadId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.meta.update": {
      const existingThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      let workspaceId = existingThread.workspaceId;
      let branch = command.branch;
      let worktreePath = command.worktreePath;
      const events: Array<Omit<OrchestrationEvent, "sequence">> = [];

      if (command.workspaceId === null || command.worktreePath === null) {
        workspaceId = null;
      } else if (command.workspaceId !== undefined) {
        const resolvedWorkspace = yield* resolveExplicitWorkspaceReference({
          readModel,
          command,
          projectId: existingThread.projectId,
          workspaceId: command.workspaceId,
          branch,
          worktreePath,
          occurredAt,
        });
        workspaceId = resolvedWorkspace.workspaceId;
        branch = resolvedWorkspace.branch;
        worktreePath = resolvedWorkspace.worktreePath;
        events.push(...resolvedWorkspace.events);
      } else if (worktreePath !== undefined && worktreePath !== null) {
        const resolvedWorkspace = resolveWorkspaceByWorktreePath({
          readModel,
          projectId: existingThread.projectId,
          branch,
          worktreePath,
          occurredAt,
          commandId: command.commandId,
        });
        workspaceId = resolvedWorkspace.workspaceId;
        branch = resolvedWorkspace.branch;
        worktreePath = resolvedWorkspace.worktreePath;
        events.push(...resolvedWorkspace.events);
      }

      events.push({
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.workspaceId !== undefined || command.worktreePath !== undefined
            ? { workspaceId }
            : {}),
          ...(branch !== undefined ? { branch } : {}),
          ...(worktreePath !== undefined ? { worktreePath } : {}),
          updatedAt: occurredAt,
        },
      });
      return events.length === 1 ? events[0]! : events;
    }

    case "thread.runtime-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.runtime-mode-set",
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.interaction-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.interaction-mode-set",
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.turn.start": {
      const targetThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceThread = sourceProposedPlan
        ? yield* requireThread({
            readModel,
            command,
            threadId: sourceProposedPlan.threadId,
          })
        : null;
      const sourcePlan =
        sourceProposedPlan && sourceThread
          ? sourceThread.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId)
          : null;
      if (sourceProposedPlan && !sourcePlan) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`,
        });
      }
      if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
        });
      }
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: targetThread.runtimeMode,
          interactionMode: targetThread.interactionMode,
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          createdAt: command.createdAt,
        },
      };
      return [userMessageEvent, turnStartRequestedEvent];
    }

    case "thread.turn.interrupt": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.approval.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        }),
        type: "thread.approval-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.user-input.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        }),
        type: "thread.user-input-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.checkpoint.revert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        }),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
        },
      };
    }

    case "thread.message.assistant.delta": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId ?? null,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: "",
          turnId: command.turnId ?? null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.proposed-plan.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: command.threadId,
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "thread.turn.diff.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.turn-diff-completed",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.revert.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.reverted",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
        },
      };
    }

    case "thread.activity.append": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestId =
        typeof command.activity.payload === "object" &&
        command.activity.payload !== null &&
        "requestId" in command.activity.payload &&
        typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
          ? ((command.activity.payload as { requestId: string })
              .requestId as OrchestrationEvent["metadata"]["requestId"])
          : undefined;
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        }),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: command.activity,
        },
      };
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
