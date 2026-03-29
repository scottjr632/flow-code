import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import type { Thread, Workspace } from "../types";
import { cn } from "../lib/utils";
import {
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
} from "../session-logic";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export type SidebarNewThreadEnvMode = "local" | "worktree";
type SidebarProject = {
  id: string;
  name: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};
type SidebarThreadSortInput = Pick<Thread, "createdAt" | "updatedAt" | "messages">;
type SidebarWorkspaceInput = Pick<
  Workspace,
  "id" | "name" | "branch" | "worktreePath" | "createdAt" | "updatedAt"
>;
type ThreadTraversalInput = Pick<Thread, "id" | "createdAt" | "updatedAt" | "lastVisitedAt">;

export type ThreadTraversalDirection = "previous" | "next";

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

const THREAD_STATUS_PRIORITY: Record<ThreadStatusPill["label"], number> = {
  "Pending Approval": 5,
  "Awaiting Input": 4,
  Working: 3,
  Connecting: 3,
  "Plan Ready": 2,
  Completed: 1,
};

type ThreadStatusInput = Pick<
  Thread,
  "interactionMode" | "latestTurn" | "lastVisitedAt" | "proposedPlans" | "session"
>;

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export function resolveSidebarNewThreadEnvMode(input: {
  requestedEnvMode?: SidebarNewThreadEnvMode;
  defaultEnvMode: SidebarNewThreadEnvMode;
}): SidebarNewThreadEnvMode {
  return input.requestedEnvMode ?? input.defaultEnvMode;
}

function getThreadTraversalKey(thread: ThreadTraversalInput): {
  hasVisited: boolean;
  timestamp: number;
} {
  const lastVisitedAt = toSortableTimestamp(thread.lastVisitedAt);
  if (lastVisitedAt !== null) {
    return {
      hasVisited: true,
      timestamp: lastVisitedAt,
    };
  }

  return {
    hasVisited: false,
    timestamp:
      toSortableTimestamp(thread.updatedAt ?? thread.createdAt) ?? Number.NEGATIVE_INFINITY,
  };
}

export function getThreadIdsByMostRecentVisit<
  T extends Pick<Thread, "id" | "createdAt" | "updatedAt" | "lastVisitedAt">,
>(threads: readonly T[]): T["id"][] {
  return threads
    .toSorted((left, right) => {
      const rightKey = getThreadTraversalKey(right);
      const leftKey = getThreadTraversalKey(left);
      if (rightKey.hasVisited !== leftKey.hasVisited) {
        return rightKey.hasVisited ? 1 : -1;
      }
      const rightTimestamp = rightKey.timestamp;
      const leftTimestamp = leftKey.timestamp;
      const byTimestamp =
        rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
      if (byTimestamp !== 0) return byTimestamp;
      return right.id.localeCompare(left.id);
    })
    .map((thread) => thread.id);
}

export function getThreadIdsForKeyboardTraversal<
  T extends Pick<Thread, "id" | "createdAt" | "updatedAt" | "lastVisitedAt">,
>(threads: readonly T[], threadMruIds?: readonly T["id"][]): T["id"][] {
  const fallbackThreadIds = getThreadIdsByMostRecentVisit(threads);
  if (!threadMruIds || threadMruIds.length === 0) {
    return fallbackThreadIds;
  }

  const availableThreadIds = new Set(fallbackThreadIds);
  const orderedThreadIds: T["id"][] = [];
  for (const threadId of threadMruIds) {
    if (availableThreadIds.has(threadId) && !orderedThreadIds.includes(threadId)) {
      orderedThreadIds.push(threadId);
    }
  }

  for (const threadId of fallbackThreadIds) {
    if (!orderedThreadIds.includes(threadId)) {
      orderedThreadIds.push(threadId);
    }
  }

  return orderedThreadIds;
}

export function resolveThreadKeyboardTraversal<T>(input: {
  direction: ThreadTraversalDirection;
  threadIds: readonly T[];
  currentThreadId: T | null;
}): T | null {
  const { currentThreadId, direction, threadIds } = input;

  if (threadIds.length === 0) {
    return null;
  }

  if (threadIds.length === 1 && currentThreadId === threadIds[0]) {
    return null;
  }

  const currentIndex = threadIds.indexOf(currentThreadId as T);
  const seedIndex = currentIndex === -1 ? (direction === "next" ? -1 : 0) : currentIndex;
  const activeIndex =
    direction === "next"
      ? (seedIndex + 1) % threadIds.length
      : (seedIndex - 1 + threadIds.length) % threadIds.length;

  return threadIds[activeIndex] ?? null;
}

export function getVisibleSidebarThreadIds<TThreadId>(
  renderedProjects: readonly {
    renderedThreads: readonly { id: TThreadId }[];
    renderedWorkspaceRows: readonly {
      isExpanded: boolean;
      workspaceThreads: readonly { id: TThreadId }[];
    }[];
  }[],
): TThreadId[] {
  return renderedProjects.flatMap((renderedProject) => {
    const workspaceThreadIds = renderedProject.renderedWorkspaceRows.flatMap((row) =>
      row.isExpanded ? row.workspaceThreads.map((thread) => thread.id) : [],
    );
    const localThreadIds = renderedProject.renderedThreads.map((thread) => thread.id);
    return [...workspaceThreadIds, ...localThreadIds];
  });
}

export function resolveAdjacentThreadId<T>(input: {
  threadIds: readonly T[];
  currentThreadId: T | null;
  direction: ThreadTraversalDirection;
}): T | null {
  const { currentThreadId, direction, threadIds } = input;

  if (threadIds.length === 0) {
    return null;
  }

  if (currentThreadId === null) {
    return direction === "previous" ? (threadIds.at(-1) ?? null) : (threadIds[0] ?? null);
  }

  const currentIndex = threadIds.indexOf(currentThreadId);
  if (currentIndex === -1) {
    return null;
  }

  if (direction === "previous") {
    return currentIndex > 0 ? (threadIds[currentIndex - 1] ?? null) : null;
  }

  return currentIndex < threadIds.length - 1 ? (threadIds[currentIndex + 1] ?? null) : null;
}

export function isContextMenuPointerDown(input: {
  button: number;
  ctrlKey: boolean;
  isMac: boolean;
}): boolean {
  if (input.button === 2) return true;
  return input.isMac && input.button === 0 && input.ctrlKey;
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName =
    "h-7 w-full translate-x-0 cursor-pointer justify-start px-2 text-left select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  if (input.isSelected && input.isActive) {
    return cn(
      baseClassName,
      "bg-primary/22 text-foreground font-medium hover:bg-primary/26 hover:text-foreground dark:bg-primary/30 dark:hover:bg-primary/36",
    );
  }

  if (input.isSelected) {
    return cn(
      baseClassName,
      "bg-primary/15 text-foreground hover:bg-primary/19 hover:text-foreground dark:bg-primary/22 dark:hover:bg-primary/28",
    );
  }

  if (input.isActive) {
    return cn(
      baseClassName,
      "bg-accent/85 text-foreground font-medium hover:bg-accent hover:text-foreground dark:bg-accent/55 dark:hover:bg-accent/70",
    );
  }

  return cn(baseClassName, "text-muted-foreground hover:bg-accent hover:text-foreground");
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
}): ThreadStatusPill | null {
  const { hasPendingApprovals, hasPendingUserInput, thread } = input;

  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    hasActionableProposedPlan(
      findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null),
    );
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<ThreadStatusPill | null>,
): ThreadStatusPill | null {
  let highestPriorityStatus: ThreadStatusPill | null = null;

  for (const status of statuses) {
    if (status === null) continue;
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }

  return highestPriorityStatus;
}

export function getVisibleThreadsForProject(input: {
  threads: readonly Thread[];
  activeThreadId: Thread["id"] | undefined;
  isThreadListExpanded: boolean;
  previewLimit: number;
}): {
  hasHiddenThreads: boolean;
  visibleThreads: Thread[];
} {
  const { activeThreadId, isThreadListExpanded, previewLimit, threads } = input;
  const hasHiddenThreads = threads.length > previewLimit;

  if (!hasHiddenThreads || isThreadListExpanded) {
    return {
      hasHiddenThreads,
      visibleThreads: [...threads],
    };
  }

  const previewThreads = threads.slice(0, previewLimit);
  if (!activeThreadId || previewThreads.some((thread) => thread.id === activeThreadId)) {
    return {
      hasHiddenThreads: true,
      visibleThreads: previewThreads,
    };
  }

  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  if (!activeThread) {
    return {
      hasHiddenThreads: true,
      visibleThreads: previewThreads,
    };
  }

  const visibleThreadIds = new Set([...previewThreads, activeThread].map((thread) => thread.id));

  return {
    hasHiddenThreads: true,
    visibleThreads: threads.filter((thread) => visibleThreadIds.has(thread.id)),
  };
}

export interface SidebarWorkspaceSection<
  TThread extends Pick<Thread, "id" | "workspaceId">,
  TWorkspace extends SidebarWorkspaceInput,
> {
  key: string;
  workspace: TWorkspace | null;
  threads: TThread[];
}

export function groupThreadsForSidebarProject<
  TThread extends Pick<Thread, "id" | "workspaceId">,
  TWorkspace extends SidebarWorkspaceInput,
>(
  threads: readonly TThread[],
  workspaces: readonly TWorkspace[],
): SidebarWorkspaceSection<TThread, TWorkspace>[] {
  const sections: SidebarWorkspaceSection<TThread, TWorkspace>[] = [];
  const sectionByKey = new Map<string, SidebarWorkspaceSection<TThread, TWorkspace>>();
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace] as const));

  for (const thread of threads) {
    const workspace = thread.workspaceId ? (workspaceById.get(thread.workspaceId) ?? null) : null;
    const key = workspace ? `workspace:${workspace.id}` : "workspace:local";
    const existing = sectionByKey.get(key);
    if (existing) {
      existing.threads.push(thread);
      continue;
    }

    const section: SidebarWorkspaceSection<TThread, TWorkspace> = {
      key,
      workspace,
      threads: [thread],
    };
    sectionByKey.set(key, section);
    sections.push(section);
  }

  return sections;
}

function basenameOfWorkspacePath(worktreePath: string): string {
  const normalized = worktreePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? worktreePath;
}

export function deriveDefaultWorkspaceTitle(workspace: SidebarWorkspaceInput): string {
  return workspace.branch ?? basenameOfWorkspacePath(workspace.worktreePath);
}

export function isWorkspaceTitleCustomized(workspace: SidebarWorkspaceInput): boolean {
  return workspace.name !== deriveDefaultWorkspaceTitle(workspace);
}

const WORKSPACE_DISPLAY_TITLE_MAX_LENGTH = 60;

export function deriveWorkspaceDisplayTitle(
  workspace: SidebarWorkspaceInput,
  workspaceThreads: readonly Pick<Thread, "messages" | "createdAt">[],
): string {
  if (isWorkspaceTitleCustomized(workspace)) {
    return workspace.name;
  }

  // Find the earliest first-user-message across all workspace threads
  let earliest: { text: string; createdAt: string } | null = null;
  for (const thread of workspaceThreads) {
    const firstUserMsg = thread.messages.find((m) => m.role === "user");
    if (!firstUserMsg) continue;
    if (!earliest || thread.createdAt < earliest.createdAt) {
      earliest = { text: firstUserMsg.text, createdAt: thread.createdAt };
    }
  }

  if (earliest) {
    const firstLine = earliest.text.split("\n")[0]?.trim() ?? "";
    if (firstLine.length > 0) {
      return firstLine.length > WORKSPACE_DISPLAY_TITLE_MAX_LENGTH
        ? firstLine.slice(0, WORKSPACE_DISPLAY_TITLE_MAX_LENGTH - 3) + "..."
        : firstLine;
    }
  }

  return deriveDefaultWorkspaceTitle(workspace);
}

function toSortableTimestamp(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function getLatestUserMessageTimestamp(thread: SidebarThreadSortInput): number {
  let latestUserMessageTimestamp: number | null = null;

  for (const message of thread.messages) {
    if (message.role !== "user") continue;
    const messageTimestamp = toSortableTimestamp(message.createdAt);
    if (messageTimestamp === null) continue;
    latestUserMessageTimestamp =
      latestUserMessageTimestamp === null
        ? messageTimestamp
        : Math.max(latestUserMessageTimestamp, messageTimestamp);
  }

  if (latestUserMessageTimestamp !== null) {
    return latestUserMessageTimestamp;
  }

  return toSortableTimestamp(thread.updatedAt ?? thread.createdAt) ?? Number.NEGATIVE_INFINITY;
}

function getThreadSortTimestamp(
  thread: SidebarThreadSortInput,
  sortOrder: SidebarThreadSortOrder | Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (sortOrder === "created_at") {
    return toSortableTimestamp(thread.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return getLatestUserMessageTimestamp(thread);
}

export function sortThreadsForSidebar<
  T extends Pick<Thread, "id" | "createdAt" | "updatedAt" | "messages">,
>(threads: readonly T[], sortOrder: SidebarThreadSortOrder): T[] {
  return threads.toSorted((left, right) => {
    const rightTimestamp = getThreadSortTimestamp(right, sortOrder);
    const leftTimestamp = getThreadSortTimestamp(left, sortOrder);
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return right.id.localeCompare(left.id);
  });
}

export function getFallbackThreadIdAfterDelete<
  T extends Pick<Thread, "id" | "projectId" | "createdAt" | "updatedAt" | "messages">,
>(input: {
  threads: readonly T[];
  deletedThreadId: T["id"];
  sortOrder: SidebarThreadSortOrder;
  deletedThreadIds?: ReadonlySet<T["id"]>;
}): T["id"] | null {
  const { deletedThreadId, deletedThreadIds, sortOrder, threads } = input;
  const deletedThread = threads.find((thread) => thread.id === deletedThreadId);
  if (!deletedThread) {
    return null;
  }

  return (
    sortThreadsForSidebar(
      threads.filter(
        (thread) =>
          thread.projectId === deletedThread.projectId &&
          thread.id !== deletedThreadId &&
          !deletedThreadIds?.has(thread.id),
      ),
      sortOrder,
    )[0]?.id ?? null
  );
}

export function getProjectSortTimestamp(
  project: SidebarProject,
  projectThreads: readonly SidebarThreadSortInput[],
  sortOrder: Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (projectThreads.length > 0) {
    return projectThreads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }

  if (sortOrder === "created_at") {
    return toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

export function getWorkspaceSortTimestamp(
  workspace: SidebarWorkspaceInput,
  workspaceThreads: readonly SidebarThreadSortInput[],
  sortOrder: SidebarThreadSortOrder,
): number {
  if (workspaceThreads.length > 0) {
    return workspaceThreads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }

  if (sortOrder === "created_at") {
    return toSortableTimestamp(workspace.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return (
    toSortableTimestamp(workspace.updatedAt ?? workspace.createdAt) ?? Number.NEGATIVE_INFINITY
  );
}

export function sortWorkspacesForSidebar<
  TWorkspace extends SidebarWorkspaceInput,
  TThread extends Pick<Thread, "workspaceId" | "createdAt" | "updatedAt" | "messages">,
>(
  workspaces: readonly TWorkspace[],
  threads: readonly TThread[],
  sortOrder: SidebarThreadSortOrder,
): TWorkspace[] {
  const threadsByWorkspaceId = new Map<string, TThread[]>();
  for (const thread of threads) {
    if (!thread.workspaceId) continue;
    const existing = threadsByWorkspaceId.get(thread.workspaceId) ?? [];
    existing.push(thread);
    threadsByWorkspaceId.set(thread.workspaceId, existing);
  }

  return [...workspaces].toSorted((left, right) => {
    const rightTimestamp = getWorkspaceSortTimestamp(
      right,
      threadsByWorkspaceId.get(right.id) ?? [],
      sortOrder,
    );
    const leftTimestamp = getWorkspaceSortTimestamp(
      left,
      threadsByWorkspaceId.get(left.id) ?? [],
      sortOrder,
    );
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}

export function sortProjectsForSidebar<TProject extends SidebarProject, TThread extends Thread>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  if (sortOrder === "manual") {
    return [...projects];
  }

  const threadsByProjectId = new Map<string, TThread[]>();
  for (const thread of threads) {
    const existing = threadsByProjectId.get(thread.projectId) ?? [];
    existing.push(thread);
    threadsByProjectId.set(thread.projectId, existing);
  }

  return [...projects].toSorted((left, right) => {
    const rightTimestamp = getProjectSortTimestamp(
      right,
      threadsByProjectId.get(right.id) ?? [],
      sortOrder,
    );
    const leftTimestamp = getProjectSortTimestamp(
      left,
      threadsByProjectId.get(left.id) ?? [],
      sortOrder,
    );
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}
