import { type ProviderKind } from "@t3tools/contracts";
import {
  DiffIcon,
  FileCode2Icon,
  FolderTreeIcon,
  MessageSquareTextIcon,
  TerminalSquareIcon,
  type LucideIcon,
} from "lucide-react";
import { getProviderIcon } from "./providerIcons";
import { resolveTerminalGroupTitle } from "./terminalLabels";
import { type ThreadTerminalGroup } from "./types";
import { type Icon } from "./components/Icons";

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

export type WorkspaceTab =
  | {
      id: typeof DEFAULT_CHAT_WORKSPACE_TAB_ID;
      kind: "chat";
      title: string;
      closeable: false;
      icon: LucideIcon | Icon;
    }
  | {
      id: WorkspaceTabId;
      kind: "session";
      title: string;
      closeable: false;
      icon: LucideIcon | Icon;
      threadId: string;
      isDraft: boolean;
      provider: ProviderKind;
    }
  | {
      id: "diff";
      kind: "diff";
      title: string;
      closeable: boolean;
      icon: LucideIcon | Icon;
    }
  | {
      id: "files";
      kind: "files";
      title: string;
      closeable: boolean;
      icon: LucideIcon | Icon;
    }
  | {
      id: WorkspaceTabId;
      kind: "file";
      title: string;
      closeable: true;
      icon: LucideIcon | Icon;
      relativePath: string;
      dirty: boolean;
    }
  | {
      id: WorkspaceTabId;
      kind: "terminal";
      title: string;
      closeable: true;
      icon: LucideIcon | Icon;
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
  chatProvider?: ProviderKind | null;
  sessionTabs?: ReadonlyArray<{
    threadId: string;
    title: string;
    isDraft: boolean;
    provider: ProviderKind;
  }>;
  diffOpen?: boolean;
  fileTabs?: readonly WorkspaceFileTabState[];
  terminalOpen: boolean;
  terminalGroups: readonly ThreadTerminalGroup[];
  terminalNamesById?: Readonly<Record<string, string>>;
  runningTerminalIds?: readonly string[];
}): WorkspaceTab[] {
  const tabs: WorkspaceTab[] =
    input.sessionTabs && input.sessionTabs.length > 0
      ? input.sessionTabs.map((tab) => ({
          id: buildThreadWorkspaceTabId(tab.threadId),
          kind: "session",
          title: resolveSessionTabTitle(tab),
          closeable: false,
          icon: getProviderIcon(tab.provider),
          threadId: tab.threadId,
          isDraft: tab.isDraft,
          provider: tab.provider,
        }))
      : [
          {
            id: DEFAULT_CHAT_WORKSPACE_TAB_ID,
            kind: "chat",
            title: "Chat",
            closeable: false,
            icon: input.chatProvider ? getProviderIcon(input.chatProvider) : MessageSquareTextIcon,
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
    const allTerminalIds = normalizedTerminalGroups.flatMap(
      (terminalGroup) => terminalGroup.terminalIds,
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
        title: resolveTerminalGroupTitle({
          groupIndex,
          terminalIds: group.terminalIds,
          allTerminalIds,
          ...(input.terminalNamesById ? { terminalNamesById: input.terminalNamesById } : {}),
          groupCount: normalizedTerminalGroups.length,
        }),
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

export function getAdjacentWorkspaceTabId(input: {
  activeTabId: WorkspaceTabId | null;
  tabs: readonly WorkspaceTab[];
  direction: "previous" | "next";
}): WorkspaceTabId | null {
  const { tabs, direction } = input;
  if (tabs.length === 0) {
    return null;
  }

  const resolvedActiveTabId = resolveWorkspaceTabId(input.activeTabId, tabs);
  const activeIndex = tabs.findIndex((tab) => tab.id === resolvedActiveTabId);
  if (activeIndex === -1) {
    return tabs[0]?.id ?? null;
  }

  const delta = direction === "previous" ? -1 : 1;
  return tabs[(activeIndex + delta + tabs.length) % tabs.length]?.id ?? null;
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
