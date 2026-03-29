import { DiffIcon, MessageSquareTextIcon, TerminalSquareIcon, type LucideIcon } from "lucide-react";
import { type ThreadTerminalGroup } from "./types";

export type WorkspaceTabId = string;

export function buildTerminalWorkspaceTabId(groupId: string): WorkspaceTabId {
  return `terminal:${groupId}`;
}

export function isTerminalWorkspaceTabId(tabId: WorkspaceTabId): boolean {
  return tabId.startsWith("terminal:");
}

function terminalTabTitle(groupIndex: number, splitCount: number, groupCount: number): string {
  const baseTitle = groupCount <= 1 ? "Terminal" : `Terminal ${groupIndex + 1}`;
  return splitCount > 1 ? `${baseTitle} (${splitCount})` : baseTitle;
}

export type WorkspaceTab =
  | {
      id: "chat";
      kind: "chat";
      title: string;
      closeable: false;
      icon: LucideIcon;
    }
  | {
      id: "diff";
      kind: "diff";
      title: string;
      closeable: true;
      icon: LucideIcon;
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
    };

export function buildWorkspaceTabs(input: {
  diffOpen: boolean;
  terminalOpen: boolean;
  terminalGroups: readonly ThreadTerminalGroup[];
}): WorkspaceTab[] {
  const tabs: WorkspaceTab[] = [
    {
      id: "chat",
      kind: "chat",
      title: "Chat",
      closeable: false,
      icon: MessageSquareTextIcon,
    },
  ];

  if (input.diffOpen) {
    tabs.push({
      id: "diff",
      kind: "diff",
      title: "Review",
      closeable: true,
      icon: DiffIcon,
    });
  }

  if (input.terminalOpen) {
    const normalizedTerminalGroups = input.terminalGroups.filter(
      (group) => group.terminalIds.length > 0,
    );
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
  return tabs[0]?.id ?? "chat";
}
