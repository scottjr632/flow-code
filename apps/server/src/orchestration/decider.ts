import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationWorkspace,
  WorkspaceId,
} from "@t3tools/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  findWorkspaceByProjectAndWorktreePath,
  requireProject,
  requireProjectAbsent,
  requireThread,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
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
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
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
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "project.deleted",
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
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
      ];
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
        if (worktreePath !== null && worktreePath !== workspace.worktreePath) {
          return yield* invariantError(
            command.type,
            `Workspace '${command.workspaceId}' path does not match thread worktree path.`,
          );
        }
        workspaceId = workspace.id;
        branch = resolveWorkspaceBranch(workspace, branch);
        worktreePath = workspace.worktreePath;
      } else if (worktreePath !== null) {
        const existingWorkspace = findWorkspaceByProjectAndWorktreePath(
          readModel,
          command.projectId,
          worktreePath,
        );
        if (existingWorkspace) {
          workspaceId = existingWorkspace.id;
          if (branch !== undefined && branch !== existingWorkspace.branch) {
            events.push({
              ...withEventBase({
                aggregateKind: "workspace",
                aggregateId: existingWorkspace.id,
                occurredAt: command.createdAt,
                commandId: command.commandId,
              }),
              type: "workspace.meta-updated",
              payload: {
                workspaceId: existingWorkspace.id,
                branch,
                updatedAt: command.createdAt,
              },
            });
          }
        } else {
          workspaceId = crypto.randomUUID() as WorkspaceId;
          events.push({
            ...withEventBase({
              aggregateKind: "workspace",
              aggregateId: workspaceId,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            }),
            type: "workspace.created",
            payload: {
              workspaceId,
              projectId: command.projectId,
              title: deriveWorkspaceTitle({ branch, worktreePath }),
              branch,
              worktreePath,
              createdAt: command.createdAt,
              updatedAt: command.createdAt,
            },
          });
        }
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
        type: "thread.deleted",
        payload: {
          threadId: command.threadId,
          deletedAt: occurredAt,
        },
      };
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
        const workspace =
          command.workspaceId === null
            ? null
            : yield* requireWorkspace({
                readModel,
                command,
                workspaceId: command.workspaceId,
              });
        if (workspace) {
          if (workspace.projectId !== existingThread.projectId) {
            return yield* invariantError(
              command.type,
              `Workspace '${command.workspaceId}' does not belong to thread project '${existingThread.projectId}'.`,
            );
          }
          if (worktreePath !== undefined && worktreePath !== workspace.worktreePath) {
            return yield* invariantError(
              command.type,
              `Workspace '${command.workspaceId}' path does not match thread worktree path.`,
            );
          }
          workspaceId = workspace.id;
          branch = resolveWorkspaceBranch(workspace, branch);
          worktreePath = workspace.worktreePath;
        }
      } else if (worktreePath !== undefined && worktreePath !== null) {
        const existingWorkspace = findWorkspaceByProjectAndWorktreePath(
          readModel,
          existingThread.projectId,
          worktreePath,
        );
        if (existingWorkspace) {
          workspaceId = existingWorkspace.id;
          if (branch !== undefined && branch !== existingWorkspace.branch) {
            events.push({
              ...withEventBase({
                aggregateKind: "workspace",
                aggregateId: existingWorkspace.id,
                occurredAt,
                commandId: command.commandId,
              }),
              type: "workspace.meta-updated",
              payload: {
                workspaceId: existingWorkspace.id,
                branch,
                updatedAt: occurredAt,
              },
            });
          }
        } else {
          workspaceId = crypto.randomUUID() as WorkspaceId;
          events.push({
            ...withEventBase({
              aggregateKind: "workspace",
              aggregateId: workspaceId,
              occurredAt,
              commandId: command.commandId,
            }),
            type: "workspace.created",
            payload: {
              workspaceId,
              projectId: existingThread.projectId,
              title: deriveWorkspaceTitle({ branch: branch ?? null, worktreePath }),
              branch: branch ?? null,
              worktreePath,
              createdAt: occurredAt,
              updatedAt: occurredAt,
            },
          });
        }
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
