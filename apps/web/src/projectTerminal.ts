import { type ProjectId, ThreadId, type ThreadId as ThreadIdType } from "@t3tools/contracts";

const PROJECT_TERMINAL_OWNER_PREFIX = "__project_terminal__:";

export function projectTerminalOwnerId(projectId: ProjectId): ThreadIdType {
  return ThreadId.makeUnsafe(`${PROJECT_TERMINAL_OWNER_PREFIX}${projectId}`);
}

export function isProjectTerminalOwnerId(value: string | null | undefined): value is ThreadIdType {
  return typeof value === "string" && value.startsWith(PROJECT_TERMINAL_OWNER_PREFIX);
}
