import {
  DiffIcon,
  FileCode2Icon,
  FolderTreeIcon,
  MessageSquareTextIcon,
  TerminalSquareIcon,
  type LucideIcon,
} from "lucide-react";
import { type ThreadTerminalGroup } from "./types";

export type WorkspaceTabId = string;
export const DEFAULT_CHAT_WORKSPACE_TAB_ID = "chat" as const;

export function buildThreadWorkspaceTabId(threadId: string): WorkspaceTabId {
  return `thread:${threadId}`;
}

export function isThreadWorkspaceTabId(tabId: WorkspaceTabId): boolean {
  return tabId.startsWith("thread:");
}

export interface WorkspaceFileTabState {
  relativePath: string;
  title: string;
  dirty: boolean;
}

export function buildTerminalWorkspaceTabId(groupId: string): WorkspaceTabId {
  return `terminal:${groupId}`;
}

export function buildFileWorkspaceTabId(relativePath: string): WorkspaceTabId {
  return `file:${relativePath}`;
}

export function isTerminalWorkspaceTabId(tabId: WorkspaceTabId): boolean {
  return tabId.startsWith("terminal:");
}

export function isFileWorkspaceTabId(tabId: WorkspaceTabId): boolean {
  return tabId.startsWith("file:");
}

function terminalTabTitle(groupIndex: number, splitCount: number, groupCount: number): string {
  const baseTitle = groupCount <= 1 ? "Terminal" : `Terminal ${groupIndex + 1}`;
  return splitCount > 1 ? `${baseTitle} (${splitCount})` : baseTitle;
}

export type WorkspaceTab =
  | {
      id: typeof DEFAULT_CHAT_WORKSPACE_TAB_ID;
      kind: "chat";
      title: string;
      closeable: false;
      icon: LucideIcon;
    }
  | {
      id: WorkspaceTabId;
      kind: "session";
      title: string;
      closeable: false;
      icon: LucideIcon;
      threadId: string;
      isDraft: boolean;
    }
  | {
      id: "diff";
      kind: "diff";
      title: string;
      closeable: boolean;
      icon: LucideIcon;
    }
  | {
      id: "files";
      kind: "files";
      title: string;
      closeable: boolean;
      icon: LucideIcon;
    }
  | {
      id: WorkspaceTabId;
      kind: "file";
      title: string;
      closeable: true;
      icon: LucideIcon;
      relativePath: string;
      dirty: boolean;
    }
  | {
      id: WorkspaceTabId;
      kind: "terminal";
      title: string;
      closeable: true;
      icon: LucideIcon;
      terminalGroupId: string;
      terminalIds: string[];
      primaryTerminalId: string;
      hasRunningProcess: boolean;
    };

function resolveSessionTabTitle(input: { isDraft: boolean; title: string }): string {
  if (input.isDraft && input.title === "New thread") {
    return "New session";
  }
  return input.title;
}

export function buildWorkspaceTabs(input: {
  sessionTabs?: ReadonlyArray<{
    threadId: string;
    title: string;
    isDraft: boolean;
  }>;
  diffOpen?: boolean;
  fileTabs?: readonly WorkspaceFileTabState[];
  terminalOpen: boolean;
  terminalGroups: readonly ThreadTerminalGroup[];
  runningTerminalIds?: readonly string[];
}): WorkspaceTab[] {
  const tabs: WorkspaceTab[] =
    input.sessionTabs && input.sessionTabs.length > 0
      ? input.sessionTabs.map((tab) => ({
          id: buildThreadWorkspaceTabId(tab.threadId),
          kind: "session",
          title: resolveSessionTabTitle(tab),
          closeable: false,
          icon: MessageSquareTextIcon,
          threadId: tab.threadId,
          isDraft: tab.isDraft,
        }))
      : [
          {
            id: DEFAULT_CHAT_WORKSPACE_TAB_ID,
            kind: "chat",
            title: "Chat",
            closeable: false,
            icon: MessageSquareTextIcon,
          },
        ];

  tabs.push({
    id: "files",
    kind: "files",
    title: "Files",
    closeable: false,
    icon: FolderTreeIcon,
  });

  tabs.push({
    id: "diff",
    kind: "diff",
    title: "Review",
    closeable: false,
    icon: DiffIcon,
  });

  (input.fileTabs ?? []).forEach((fileTab) => {
    tabs.push({
      id: buildFileWorkspaceTabId(fileTab.relativePath),
      kind: "file",
      title: fileTab.title,
      closeable: true,
      icon: FileCode2Icon,
      relativePath: fileTab.relativePath,
      dirty: fileTab.dirty,
    });
  });

  if (input.terminalOpen) {
    const normalizedTerminalGroups = input.terminalGroups.filter(
      (group) => group.terminalIds.length > 0,
    );
    const runningSet = new Set(input.runningTerminalIds ?? []);
    normalizedTerminalGroups.forEach((group, groupIndex) => {
      const primaryTerminalId = group.terminalIds[0];
      if (!primaryTerminalId) {
        return;
      }
      tabs.push({
        id: buildTerminalWorkspaceTabId(group.id),
        kind: "terminal",
        title: terminalTabTitle(
          groupIndex,
          group.terminalIds.length,
          normalizedTerminalGroups.length,
        ),
        closeable: true,
        icon: TerminalSquareIcon,
        terminalGroupId: group.id,
        terminalIds: [...group.terminalIds],
        primaryTerminalId,
        hasRunningProcess: group.terminalIds.some((id) => runningSet.has(id)),
      });
    });
  }

  return tabs;
}

export function resolveWorkspaceTabId(
  preferredTabId: WorkspaceTabId | null,
  tabs: readonly WorkspaceTab[],
): WorkspaceTabId {
  if (preferredTabId && tabs.some((tab) => tab.id === preferredTabId)) {
    return preferredTabId;
  }
  return tabs[0]?.id ?? DEFAULT_CHAT_WORKSPACE_TAB_ID;
}

export function sortWorkspaceTabsByOrder(
  tabs: readonly WorkspaceTab[],
  orderedTabIds: readonly WorkspaceTabId[] | undefined,
): WorkspaceTab[] {
  if (!orderedTabIds || orderedTabIds.length === 0) {
    return [...tabs];
  }

  const rankByTabId = new Map(orderedTabIds.map((tabId, index) => [tabId, index] as const));

  return [...tabs].toSorted((left, right) => {
    const leftRank = rankByTabId.get(left.id);
    const rightRank = rankByTabId.get(right.id);

    if (leftRank === undefined && rightRank === undefined) {
      return 0;
    }
    if (leftRank === undefined) {
      return 1;
    }
    if (rightRank === undefined) {
      return -1;
    }
    return leftRank - rightRank;
  });
}

export function reorderWorkspaceTabIds(
  tabIds: readonly WorkspaceTabId[],
  draggedTabId: WorkspaceTabId,
  targetTabId: WorkspaceTabId,
): WorkspaceTabId[] {
  if (draggedTabId === targetTabId) {
    return [...tabIds];
  }

  const draggedIndex = tabIds.indexOf(draggedTabId);
  const targetIndex = tabIds.indexOf(targetTabId);
  if (draggedIndex === -1 || targetIndex === -1) {
    return [...tabIds];
  }

  const nextTabIds = [...tabIds];
  const [next] = nextTabIds.splice(draggedIndex, 1);
  if (!next) {
    return nextTabIds;
  }
  const nextTargetIndex = nextTabIds.indexOf(targetTabId);
  if (nextTargetIndex === -1) {
    nextTabIds.push(next);
    return nextTabIds;
  }
  nextTabIds.splice(nextTargetIndex, 0, next);

  return nextTabIds;
}
