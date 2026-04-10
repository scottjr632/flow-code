import { type ProjectId, type ThreadId } from "@t3tools/contracts";
import {
  FolderIcon,
  ListTodoIcon,
  MessageSquareTextIcon,
  PlusIcon,
  SquarePenIcon,
} from "lucide-react";

import type { WorkspaceCommandPaletteItem } from "~/components/WorkspaceCommandPalette";

interface WorkspaceCommandPaletteProjectItem {
  readonly id: ProjectId;
  readonly name: string;
}

interface WorkspaceCommandPaletteThreadItem {
  readonly id: ThreadId;
  readonly title: string;
  readonly projectId: ProjectId;
  readonly archivedAt: string | null;
}

interface BuildWorkspaceCommandPaletteNavigationItemsOptions {
  readonly projects: ReadonlyArray<WorkspaceCommandPaletteProjectItem>;
  readonly threads: ReadonlyArray<WorkspaceCommandPaletteThreadItem>;
  readonly selectedProjectId: ProjectId | null;
  readonly activeThreadId?: ThreadId | null;
  readonly newThreadShortcutLabel?: string;
  readonly onOpenNewThread: () => void;
  readonly onOpenNewWorkItem?: (projectId: ProjectId | null) => void;
  readonly onOpenWorkSurface: (projectId: ProjectId | null) => void;
  readonly onSelectProject: (projectId: ProjectId) => void;
  readonly onSelectThread: (threadId: ThreadId) => void;
}

export function buildWorkspaceCommandPaletteNavigationItems(
  options: BuildWorkspaceCommandPaletteNavigationItemsOptions,
): WorkspaceCommandPaletteItem[] {
  const projectNameById = new Map(
    options.projects.map((project) => [project.id, project.name] as const),
  );
  const items: WorkspaceCommandPaletteItem[] = [
    {
      id: "action:new-thread",
      group: "actions",
      title: "New thread",
      keywords: "new thread create thread draft",
      icon: SquarePenIcon,
      ...(options.newThreadShortcutLabel ? { shortcut: options.newThreadShortcutLabel } : {}),
      onSelect: () => {
        options.onOpenNewThread();
      },
    },
    {
      id: "action:work",
      group: "actions",
      title: "Work",
      keywords: "work tasks board list backlog",
      icon: ListTodoIcon,
      ...(options.selectedProjectId
        ? { subtitle: projectNameById.get(options.selectedProjectId) ?? "Selected project" }
        : {}),
      onSelect: () => {
        options.onOpenWorkSurface(options.selectedProjectId);
      },
    },
  ];

  if (options.onOpenNewWorkItem && options.projects.length > 0) {
    const selectedProjectName =
      options.selectedProjectId !== null
        ? (projectNameById.get(options.selectedProjectId) ?? null)
        : null;

    items.push({
      id: "action:new-work-item",
      group: "actions",
      title: "New work item",
      keywords: "new work item create task todo backlog issue",
      icon: PlusIcon,
      ...(selectedProjectName ? { subtitle: selectedProjectName } : {}),
      onSelect: () => {
        options.onOpenNewWorkItem?.(options.selectedProjectId);
      },
    });
  }

  options.projects.forEach((project) => {
    const isSelectedProject = project.id === options.selectedProjectId;
    items.push({
      id: `project:${project.id}`,
      group: "projects",
      title: project.name,
      ...(isSelectedProject ? { subtitle: "Selected project" } : {}),
      keywords: `${project.name} project repository repo workspace`.toLowerCase(),
      icon: FolderIcon,
      onSelect: () => {
        options.onSelectProject(project.id);
      },
    });
  });

  options.threads
    .filter((thread) => thread.archivedAt === null)
    .forEach((thread) => {
      const isCurrentThread = thread.id === options.activeThreadId;
      const projectName = projectNameById.get(thread.projectId);
      items.push({
        id: `thread:${thread.id}`,
        group: "sessions",
        title: thread.title,
        subtitle: [projectName, isCurrentThread ? "Current session" : null]
          .filter(Boolean)
          .join(" · "),
        keywords: `${thread.title} ${projectName ?? ""}`.trim(),
        icon: MessageSquareTextIcon,
        onSelect: () => {
          options.onSelectThread(thread.id);
        },
      });
    });

  return items;
}
