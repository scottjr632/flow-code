import {
  closestCorners,
  type CollisionDetection,
  type DragEndEvent,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type ProjectId,
  type ThreadId,
  type WorkItemId,
  type WorkItemStatus,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  CircleIcon,
  FolderGit2Icon,
  GitForkIcon,
  GripVerticalIcon,
  LayoutGridIcon,
  Link2Icon,
  ListIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { useWorkspaceCommandPalette } from "~/hooks/useWorkspaceCommandPalette";
import { useWorkItemActions, WorkItemLaunchLinkError } from "~/hooks/useWorkItemActions";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";
import type { WorkItem } from "~/types";
import { isUserProject } from "~/systemProject";
import {
  resolveDefaultWorkItemLaunchMode,
  type WorkItemLaunchMode,
} from "~/workItemLaunchPreferences";
import { buildWorkItemRankUpdates, sortWorkItems, WORK_ITEM_STATUS_ORDER } from "~/workItems.logic";
import { toastManager } from "./ui/toast";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "./ui/select";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";
import { Toggle, ToggleGroup } from "./ui/toggle-group";
import {
  deriveWorkItemEditorValues,
  WorkItemEditorDialog,
  type WorkItemDialogState,
  type WorkItemEditorValues,
} from "./WorkItemEditorDialog";
import {
  WorkspaceCommandPalette,
  type WorkspaceCommandPaletteItem,
} from "./WorkspaceCommandPalette";
import { isElectron } from "~/env";
import { buildWorkspaceCommandPaletteNavigationItems } from "~/workspaceCommandPaletteItems";

export type WorkSurfaceView = "board" | "list";

const STATUS_META: Record<
  WorkItemStatus,
  { label: string; description: string; badgeVariant: "outline" | "info" | "success" }
> = {
  todo: {
    label: "Todo",
    description: "Backlog and unstarted work",
    badgeVariant: "outline",
  },
  in_progress: {
    label: "In Progress",
    description: "Active execution",
    badgeVariant: "info",
  },
  done: {
    label: "Done",
    description: "Completed work",
    badgeVariant: "success",
  },
};

interface WorkSurfaceProps {
  view: WorkSurfaceView;
  selectedProjectId: ProjectId | null;
  onViewChange: (view: WorkSurfaceView) => void;
  onProjectFilterChange: (projectId: ProjectId | null) => void;
}

interface PendingLinkRepair {
  readonly threadId: ThreadId;
  readonly workspaceId: WorkItem["workspaceId"];
  readonly errorMessage: string;
}

interface WorkItemProjectSection {
  projectId: ProjectId;
  projectName: string;
  items: WorkItem[];
}

interface WorkItemStatusSection {
  status: WorkItemStatus;
  projects: WorkItemProjectSection[];
}

function statusSectionId(projectId: ProjectId, status: WorkItemStatus): string {
  return `work-item-section:${projectId}:${status}`;
}

function parseStatusSectionId(
  value: string,
): { projectId: ProjectId; status: WorkItemStatus } | null {
  const parts = value.split(":");
  if (parts.length !== 3 || parts[0] !== "work-item-section") {
    return null;
  }
  const status = parts[2];
  if (status !== "todo" && status !== "in_progress" && status !== "done") {
    return null;
  }
  return {
    projectId: parts[1] as ProjectId,
    status,
  };
}

function normalizeProjectSortKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function buildStatusSections(input: {
  readonly items: ReadonlyArray<WorkItem>;
  readonly projectIds: ReadonlyArray<ProjectId>;
  readonly projectNameById: ReadonlyMap<ProjectId, string>;
}): WorkItemStatusSection[] {
  return WORK_ITEM_STATUS_ORDER.map((status) => ({
    status,
    projects: input.projectIds.map((projectId) => ({
      projectId,
      projectName: input.projectNameById.get(projectId) ?? "Unknown Project",
      items: input.items.filter((item) => item.projectId === projectId && item.status === status),
    })),
  }));
}

function StatusIcon({ status, className }: { status: WorkItemStatus; className?: string }) {
  switch (status) {
    case "todo":
      return <CircleIcon className={cn("size-3.5 text-muted-foreground", className)} />;
    case "in_progress":
      return <CircleDotIcon className={cn("size-3.5 text-blue-400", className)} />;
    case "done":
      return <CheckCircle2Icon className={cn("size-3.5 text-emerald-400", className)} />;
  }
}

function ListDropZone({ id, children }: { id: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn("transition-colors", isOver && "bg-primary/4")}>
      {children}
    </div>
  );
}

function WorkItemDropSection({
  id,
  emptyLabel,
  children,
  className,
}: {
  id: string;
  emptyLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  const childCount = Array.isArray(children) ? children.length : children ? 1 : 0;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border border-dashed border-border/50 bg-muted/10 p-1.5 transition-colors",
        isOver && "border-primary/48 bg-primary/6",
        className,
      )}
    >
      <div className="space-y-1.5">
        {children}
        {childCount === 0 ? (
          <div className="rounded-md px-2 py-3 text-center text-[11px] text-muted-foreground/50">
            {emptyLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SortableWorkItemCard({
  item,
  projectName,
  workspaceName,
  preferredLaunchMode,
  pendingLinkRepair,
  busy,
  showProject,
  onEdit,
  onDelete,
  onLaunch,
  onOpenThread,
  onRetryLink,
}: {
  item: WorkItem;
  projectName: string;
  workspaceName: string | null;
  preferredLaunchMode: WorkItemLaunchMode;
  pendingLinkRepair: PendingLinkRepair | null;
  busy: boolean;
  showProject: boolean;
  onEdit: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
  onLaunch: (item: WorkItem, mode: WorkItemLaunchMode) => void;
  onOpenThread: (threadId: ThreadId) => void;
  onRetryLink: (item: WorkItem, repair: PendingLinkRepair) => void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const launchButtons = (
    <div className="flex items-center gap-1.5">
      <Button
        size="xs"
        variant={preferredLaunchMode === "local" ? "default" : "outline"}
        disabled={busy}
        onClick={() => onLaunch(item, "local")}
        className="h-6 gap-1 px-2 text-[11px]"
      >
        <PlayIcon className="size-3" />
        Local
      </Button>
      <Button
        size="xs"
        variant={preferredLaunchMode === "workspace" ? "default" : "outline"}
        disabled={busy}
        onClick={() => onLaunch(item, "workspace")}
        className="h-6 gap-1 px-2 text-[11px]"
      >
        <GitForkIcon className="size-3" />
        Workspace
      </Button>
    </div>
  );

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "group/card rounded-lg border border-border/60 bg-card px-2.5 py-2 transition-shadow",
        busy && "opacity-80",
        isDragging && "z-20 opacity-0 shadow-lg/10",
      )}
    >
      <div className="flex items-start gap-1.5">
        <button
          ref={setActivatorNodeRef}
          className="mt-px inline-flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-foreground active:cursor-grabbing"
          aria-label={`Reorder ${item.title}`}
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-3.5" />
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-1.5">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium leading-5 text-foreground">
                {item.title}
              </div>
              {item.notes ? (
                <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                  {item.notes}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/card:opacity-100">
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => onEdit(item)}
                aria-label={`Edit ${item.title}`}
                className="size-5"
              >
                <PencilIcon className="size-3" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => onDelete(item)}
                aria-label={`Delete ${item.title}`}
                className="size-5"
              >
                <Trash2Icon className="size-3" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="secondary" size="sm" className="h-4.5 px-1.5 text-[10px]">
              {item.source === "agent" ? "Agent" : "Manual"}
            </Badge>
            {showProject ? (
              <Badge variant="outline" size="sm" className="h-4.5 px-1.5 text-[10px]">
                {projectName}
              </Badge>
            ) : null}
            {workspaceName ? (
              <Badge variant="outline" size="sm" className="h-4.5 gap-1 px-1.5 text-[10px]">
                <FolderGit2Icon className="size-2.5" />
                {workspaceName}
              </Badge>
            ) : null}
          </div>

          {pendingLinkRepair ? (
            <Alert variant="warning" className="rounded-md px-2 py-1.5 text-[11px]">
              <AlertTriangleIcon />
              <AlertTitle className="text-[11px]">Link failed</AlertTitle>
              <AlertDescription className="text-[11px]">
                {pendingLinkRepair.errorMessage}
              </AlertDescription>
              <AlertAction className="gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => onOpenThread(pendingLinkRepair.threadId)}
                  className="h-5 gap-1 px-1.5 text-[10px]"
                >
                  <Link2Icon className="size-2.5" />
                  Thread
                </Button>
                <Button
                  size="xs"
                  onClick={() => onRetryLink(item, pendingLinkRepair)}
                  className="h-5 gap-1 px-1.5 text-[10px]"
                >
                  <RefreshCcwIcon className="size-2.5" />
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          ) : item.linkedThreadId ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => onOpenThread(item.linkedThreadId!)}
              className="h-6 gap-1 px-2 text-[11px]"
            >
              <Link2Icon className="size-3" />
              Open thread
            </Button>
          ) : (
            launchButtons
          )}
        </div>
      </div>
    </article>
  );
}

function SortableListRow({
  item,
  projectName,
  workspaceName,
  preferredLaunchMode,
  pendingLinkRepair,
  busy,
  showProject,
  onEdit,
  onDelete,
  onLaunch,
  onOpenThread,
  onRetryLink,
}: {
  item: WorkItem;
  projectName: string;
  workspaceName: string | null;
  preferredLaunchMode: WorkItemLaunchMode;
  pendingLinkRepair: PendingLinkRepair | null;
  busy: boolean;
  showProject: boolean;
  onEdit: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
  onLaunch: (item: WorkItem, mode: WorkItemLaunchMode) => void;
  onOpenThread: (threadId: ThreadId) => void;
  onRetryLink: (item: WorkItem, repair: PendingLinkRepair) => void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "group/row flex items-center gap-2 border-b border-border/20 px-3 py-1.5 transition-colors hover:bg-muted/10",
        busy && "opacity-60",
        isDragging && "z-20 opacity-0 bg-card shadow-lg/10",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        className="inline-flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/30 opacity-0 transition-opacity hover:text-foreground active:cursor-grabbing group-hover/row:opacity-100"
        aria-label={`Reorder ${item.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-3" />
      </button>

      <StatusIcon status={item.status} className="shrink-0" />

      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{item.title}</span>

      <div className="flex shrink-0 items-center gap-2">
        {showProject ? (
          <span className="text-[11px] text-muted-foreground">{projectName}</span>
        ) : null}
        {workspaceName ? (
          <Badge variant="outline" size="sm" className="h-4.5 gap-1 px-1.5 text-[10px]">
            <FolderGit2Icon className="size-2.5" />
            {workspaceName}
          </Badge>
        ) : null}

        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
          {pendingLinkRepair ? (
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => onOpenThread(pendingLinkRepair.threadId)}
                className="size-6"
                aria-label="Open thread"
              >
                <Link2Icon className="size-3" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => onRetryLink(item, pendingLinkRepair)}
                className="size-6"
                aria-label="Retry link"
              >
                <RefreshCcwIcon className="size-3" />
              </Button>
            </>
          ) : item.linkedThreadId ? (
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => onOpenThread(item.linkedThreadId!)}
              className="size-6"
              aria-label="Open thread"
            >
              <Link2Icon className="size-3" />
            </Button>
          ) : (
            <>
              <Button
                size="icon-xs"
                variant={preferredLaunchMode === "local" ? "default" : "ghost"}
                disabled={busy}
                onClick={() => onLaunch(item, "local")}
                className="size-6"
                aria-label="Start local"
              >
                <PlayIcon className="size-3" />
              </Button>
              <Button
                size="icon-xs"
                variant={preferredLaunchMode === "workspace" ? "default" : "ghost"}
                disabled={busy}
                onClick={() => onLaunch(item, "workspace")}
                className="size-6"
                aria-label="Start workspace"
              >
                <GitForkIcon className="size-3" />
              </Button>
            </>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => onEdit(item)}
            className="size-6"
            aria-label={`Edit ${item.title}`}
          >
            <PencilIcon className="size-3" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => onDelete(item)}
            className="size-6"
            aria-label={`Delete ${item.title}`}
          >
            <Trash2Icon className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function WorkItemCardDragOverlay({
  item,
  projectName,
  workspaceName,
  showProject,
}: {
  item: WorkItem;
  projectName: string;
  workspaceName: string | null;
  showProject: boolean;
}) {
  return (
    <article className="w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border/60 bg-card px-2.5 py-2 shadow-lg shadow-black/20">
      <div className="flex items-start gap-1.5">
        <div className="mt-px inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/40">
          <GripVerticalIcon className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium leading-5 text-foreground">
              {item.title}
            </div>
            {item.notes ? (
              <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                {item.notes}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="secondary" size="sm" className="h-4.5 px-1.5 text-[10px]">
              {item.source === "agent" ? "Agent" : "Manual"}
            </Badge>
            {showProject ? (
              <Badge variant="outline" size="sm" className="h-4.5 px-1.5 text-[10px]">
                {projectName}
              </Badge>
            ) : null}
            {workspaceName ? (
              <Badge variant="outline" size="sm" className="h-4.5 gap-1 px-1.5 text-[10px]">
                <FolderGit2Icon className="size-2.5" />
                {workspaceName}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function WorkItemListRowDragOverlay({
  item,
  projectName,
  workspaceName,
  showProject,
}: {
  item: WorkItem;
  projectName: string;
  workspaceName: string | null;
  showProject: boolean;
}) {
  return (
    <div className="flex w-[min(36rem,calc(100vw-2rem))] items-center gap-2 rounded-md border border-border/50 bg-card px-3 py-1.5 shadow-lg shadow-black/20">
      <div className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/30">
        <GripVerticalIcon className="size-3" />
      </div>
      <StatusIcon status={item.status} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{item.title}</span>
      <div className="flex shrink-0 items-center gap-2">
        {showProject ? (
          <span className="text-[11px] text-muted-foreground">{projectName}</span>
        ) : null}
        {workspaceName ? (
          <Badge variant="outline" size="sm" className="h-4.5 gap-1 px-1.5 text-[10px]">
            <FolderGit2Icon className="size-2.5" />
            {workspaceName}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

export function WorkSurface({
  view,
  selectedProjectId,
  onViewChange,
  onProjectFilterChange,
}: WorkSurfaceProps) {
  const navigate = useNavigate();
  const { isOpen: isWorkspaceCommandPaletteOpen, setIsOpen: setIsWorkspaceCommandPaletteOpen } =
    useWorkspaceCommandPalette();
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const workspaces = useStore((store) => store.workspaces);
  const workItems = useStore((store) => store.workItems);
  const {
    applyRankUpdates,
    createWorkItem,
    deleteWorkItem,
    launchFromWorkItem,
    retryLinkWorkItem,
    updateWorkItem,
  } = useWorkItemActions();
  const [dialogState, setDialogState] = useState<WorkItemDialogState | null>(null);
  const [editorValues, setEditorValues] = useState<WorkItemEditorValues>(() =>
    deriveWorkItemEditorValues(null, null),
  );
  const [busyItemId, setBusyItemId] = useState<WorkItemId | null>(null);
  const [activeDragItemId, setActiveDragItemId] = useState<WorkItemId | null>(null);
  const [pendingLinkRepairs, setPendingLinkRepairs] = useState<Record<string, PendingLinkRepair>>(
    {},
  );

  const userProjects = useMemo(
    () =>
      projects
        .filter(isUserProject)
        .toSorted((left, right) => left.name.localeCompare(right.name))
        .map((project) => ({ id: project.id, name: project.name, cwd: project.cwd })),
    [projects],
  );
  const projectNameById = useMemo(
    () => new Map(userProjects.map((project) => [project.id, project.name] as const)),
    [userProjects],
  );
  const workspaceNameById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name] as const)),
    [workspaces],
  );
  const activeProjectId =
    selectedProjectId && projectNameById.has(selectedProjectId) ? selectedProjectId : null;
  const visibleProjectIds = useMemo(
    () => (activeProjectId ? [activeProjectId] : userProjects.map((project) => project.id)),
    [activeProjectId, userProjects],
  );
  const visibleItems = useMemo(
    () =>
      sortWorkItems(
        workItems.filter(
          (item) =>
            item.deletedAt === null &&
            projectNameById.has(item.projectId) &&
            (activeProjectId === null || item.projectId === activeProjectId),
        ),
        (projectId) => normalizeProjectSortKey(projectNameById.get(projectId) ?? projectId),
      ),
    [activeProjectId, projectNameById, workItems],
  );
  const statusSections = useMemo(
    () =>
      buildStatusSections({
        items: visibleItems,
        projectIds: visibleProjectIds,
        projectNameById,
      }),
    [projectNameById, visibleItems, visibleProjectIds],
  );
  const projectWorkspaceOptions = useMemo(
    () =>
      workspaces
        .filter((workspace) => workspace.projectId === editorValues.projectId)
        .toSorted((left, right) => left.name.localeCompare(right.name))
        .map((workspace) => ({ id: workspace.id, name: workspace.name })),
    [editorValues.projectId, workspaces],
  );
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  const openCreateDialog = useCallback(() => {
    const nextValues = deriveWorkItemEditorValues(
      { mode: "create", item: null },
      activeProjectId ?? userProjects[0]?.id ?? null,
    );
    setDialogState({ mode: "create", item: null });
    setEditorValues(nextValues);
  }, [activeProjectId, userProjects]);

  const workspaceCommandPaletteItems = useMemo<WorkspaceCommandPaletteItem[]>(() => {
    const items = buildWorkspaceCommandPaletteNavigationItems({
      projects: userProjects,
      threads,
      selectedProjectId: activeProjectId,
      onOpenNewThread: () => {
        void navigate({
          to: "/",
          ...(activeProjectId ? { search: { projectId: activeProjectId } } : {}),
        });
      },
      onOpenWorkSurface: (projectId) => {
        void navigate({
          to: "/work",
          ...(projectId ? { search: { view, projectId } } : { search: { view } }),
        });
      },
      onSelectProject: (projectId) => {
        onProjectFilterChange(projectId);
      },
      onSelectThread: (threadId) => {
        void navigate({
          to: "/$threadId",
          params: { threadId },
        });
      },
    });

    if (userProjects.length === 0) {
      return items;
    }

    items.push({
      id: "action:new-work-item",
      group: "actions",
      title: "New work item",
      keywords: "new work item create task todo backlog issue",
      icon: PlusIcon,
      ...(activeProjectId
        ? { subtitle: projectNameById.get(activeProjectId) ?? "Selected project" }
        : {}),
      onSelect: () => {
        openCreateDialog();
      },
    });

    return items;
  }, [
    activeProjectId,
    navigate,
    onProjectFilterChange,
    openCreateDialog,
    projectNameById,
    threads,
    userProjects,
    view,
  ]);

  const openEditDialog = useCallback((item: WorkItem) => {
    setDialogState({ mode: "edit", item });
    setEditorValues(deriveWorkItemEditorValues({ mode: "edit", item }, item.projectId));
  }, []);

  const closeDialog = (open: boolean) => {
    if (open) {
      return;
    }
    setDialogState(null);
  };

  const handleSubmitDialog = () => {
    if (!dialogState || !editorValues.projectId) {
      return;
    }

    const title = editorValues.title.trim();
    if (title.length === 0) {
      return;
    }

    const notes = editorValues.notes.trim();
    const task = async () => {
      if (dialogState.mode === "create") {
        await createWorkItem({
          projectId: editorValues.projectId!,
          title,
          notes: notes.length > 0 ? notes : null,
          workspaceId: editorValues.workspaceId,
          status: editorValues.status,
          source: "manual",
        });
      } else if (dialogState.item) {
        await updateWorkItem(dialogState.item.id, {
          title,
          notes: notes.length > 0 ? notes : null,
          status: editorValues.status,
          workspaceId: editorValues.workspaceId,
        });
      }
      setDialogState(null);
    };

    void task().catch((error) => {
      toastManager.add({
        type: "error",
        title:
          dialogState.mode === "create" ? "Failed to create work item" : "Failed to save work item",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    });
  };

  const handleDeleteItem = (item: WorkItem) => {
    if (!window.confirm(`Delete "${item.title}"?`)) {
      return;
    }
    void deleteWorkItem(item.id).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Failed to delete work item",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    });
  };

  const handleLaunch = (item: WorkItem, mode: WorkItemLaunchMode) => {
    setBusyItemId(item.id);
    void launchFromWorkItem({ item, mode })
      .then(() => {
        setPendingLinkRepairs((current) => {
          if (!Object.hasOwn(current, item.id)) {
            return current;
          }
          const next = { ...current };
          delete next[item.id];
          return next;
        });
      })
      .catch((error) => {
        if (error instanceof WorkItemLaunchLinkError) {
          setPendingLinkRepairs((current) => ({
            ...current,
            [item.id]: {
              threadId: error.threadId as ThreadId,
              workspaceId: error.workspaceId,
              errorMessage: error.message,
            },
          }));
          toastManager.add({
            type: "warning",
            title: "Thread started but item link failed",
            description: error.message,
          });
          return;
        }
        toastManager.add({
          type: "error",
          title: "Failed to launch work item",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      })
      .finally(() => {
        setBusyItemId((current) => (current === item.id ? null : current));
      });
  };

  const handleRetryLink = (item: WorkItem, repair: PendingLinkRepair) => {
    setBusyItemId(item.id);
    void retryLinkWorkItem({
      itemId: item.id,
      threadId: repair.threadId,
      workspaceId: repair.workspaceId,
    })
      .then(() => {
        setPendingLinkRepairs((current) => {
          if (!Object.hasOwn(current, item.id)) {
            return current;
          }
          const next = { ...current };
          delete next[item.id];
          return next;
        });
      })
      .catch((error) => {
        toastManager.add({
          type: "error",
          title: "Failed to retry work item link",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      })
      .finally(() => {
        setBusyItemId((current) => (current === item.id ? null : current));
      });
  };

  const openThread = useCallback(
    (threadId: ThreadId) => {
      void navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [navigate],
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragItemId(String(event.active.id) as WorkItemId);
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    setActiveDragItemId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id) as WorkItemId;
    setActiveDragItemId(null);
    const movingItem = visibleItems.find((item) => item.id === activeId);
    if (!movingItem || !event.over) {
      return;
    }

    const overId = String(event.over.id);
    const overItem = visibleItems.find((item) => item.id === overId);
    const overSection = overItem ? null : parseStatusSectionId(overId);
    const targetProjectId = overItem?.projectId ?? overSection?.projectId ?? null;
    const targetStatus = overItem?.status ?? overSection?.status ?? null;

    if (!targetProjectId || !targetStatus || targetProjectId !== movingItem.projectId) {
      return;
    }

    const updates = buildWorkItemRankUpdates({
      items: visibleItems,
      itemId: movingItem.id,
      targetStatus,
      overItemId: overItem?.id ?? null,
    });
    if (updates.length === 0) {
      return;
    }

    void applyRankUpdates(updates).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Failed to reorder work items",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    });
  };
  const activeDragItem = activeDragItemId
    ? (visibleItems.find((item) => item.id === activeDragItemId) ?? null)
    : null;
  const activeDragProjectName = activeDragItem
    ? (projectNameById.get(activeDragItem.projectId) ?? "Unknown Project")
    : null;
  const activeDragWorkspaceName = activeDragItem?.workspaceId
    ? (workspaceNameById.get(activeDragItem.workspaceId) ?? null)
    : null;

  const content =
    visibleItems.length === 0 ? (
      <Empty className="min-h-0 flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CheckCircle2Icon className="size-4.5" />
          </EmptyMedia>
          <EmptyTitle>No work items yet</EmptyTitle>
          <EmptyDescription>
            Capture work before you open a thread, then start execution from here when you are
            ready.
          </EmptyDescription>
        </EmptyHeader>
        <Button onClick={openCreateDialog}>
          <PlusIcon className="size-4" />
          New work item
        </Button>
      </Empty>
    ) : view === "board" ? (
      <div className="flex min-h-0 flex-1">
        {statusSections.map((section, sectionIndex) => {
          const itemCount = section.projects.reduce(
            (count, project) => count + project.items.length,
            0,
          );
          return (
            <section
              key={section.status}
              className={cn(
                "flex min-w-0 flex-1 flex-col",
                sectionIndex < statusSections.length - 1 && "border-r border-border/30",
              )}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {STATUS_META[section.status].label}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground/60">
                  {itemCount}
                </span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
                {section.projects.map((projectSection) => (
                  <div key={`${section.status}:${projectSection.projectId}`}>
                    {activeProjectId === null && projectSection.items.length > 0 ? (
                      <div className="px-1 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/40">
                        {projectSection.projectName}
                      </div>
                    ) : null}
                    <SortableContext
                      items={projectSection.items.map((item) => item.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <WorkItemDropSection
                        id={statusSectionId(projectSection.projectId, section.status)}
                        emptyLabel={
                          projectSection.items.length === 0 && section.projects.length === 1
                            ? `Drop ${STATUS_META[section.status].label.toLocaleLowerCase()} work here`
                            : ""
                        }
                      >
                        {projectSection.items.map((item) => {
                          const pendingLinkRepair = item.linkedThreadId
                            ? null
                            : (pendingLinkRepairs[item.id] ?? null);
                          const preferredLaunchMode = resolveDefaultWorkItemLaunchMode({
                            projectId: item.projectId,
                            hasWorkspace: item.workspaceId !== null,
                          });
                          return (
                            <SortableWorkItemCard
                              key={item.id}
                              item={item}
                              projectName={projectSection.projectName}
                              workspaceName={
                                item.workspaceId
                                  ? (workspaceNameById.get(item.workspaceId) ?? null)
                                  : null
                              }
                              preferredLaunchMode={preferredLaunchMode}
                              pendingLinkRepair={pendingLinkRepair}
                              busy={busyItemId === item.id}
                              showProject={activeProjectId === null}
                              onEdit={openEditDialog}
                              onDelete={handleDeleteItem}
                              onLaunch={handleLaunch}
                              onOpenThread={openThread}
                              onRetryLink={handleRetryLink}
                            />
                          );
                        })}
                      </WorkItemDropSection>
                    </SortableContext>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    ) : (
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col">
          {statusSections.map((section) => {
            const sectionItemCount = section.projects.reduce(
              (count, project) => count + project.items.length,
              0,
            );
            return (
              <section key={section.status}>
                <div className="flex items-center gap-2 border-b border-border/40 bg-muted/15 px-4 py-1.5">
                  <StatusIcon status={section.status} />
                  <span className="text-[13px] font-medium text-foreground">
                    {STATUS_META[section.status].label}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground/60">
                    {sectionItemCount}
                  </span>
                </div>
                {section.projects.map((projectSection) => (
                  <div key={`${section.status}:${projectSection.projectId}`}>
                    <SortableContext
                      items={projectSection.items.map((item) => item.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <ListDropZone id={statusSectionId(projectSection.projectId, section.status)}>
                        {projectSection.items.map((item) => {
                          const pendingLinkRepair = item.linkedThreadId
                            ? null
                            : (pendingLinkRepairs[item.id] ?? null);
                          const preferredLaunchMode = resolveDefaultWorkItemLaunchMode({
                            projectId: item.projectId,
                            hasWorkspace: item.workspaceId !== null,
                          });
                          return (
                            <SortableListRow
                              key={item.id}
                              item={item}
                              projectName={projectSection.projectName}
                              workspaceName={
                                item.workspaceId
                                  ? (workspaceNameById.get(item.workspaceId) ?? null)
                                  : null
                              }
                              preferredLaunchMode={preferredLaunchMode}
                              pendingLinkRepair={pendingLinkRepair}
                              busy={busyItemId === item.id}
                              showProject={activeProjectId === null}
                              onEdit={openEditDialog}
                              onDelete={handleDeleteItem}
                              onLaunch={handleLaunch}
                              onOpenThread={openThread}
                              onRetryLink={handleRetryLink}
                            />
                          );
                        })}
                      </ListDropZone>
                    </SortableContext>
                  </div>
                ))}
                {sectionItemCount === 0 ? (
                  <div className="px-4 py-3 text-[11px] text-muted-foreground/40">
                    No {STATUS_META[section.status].label.toLocaleLowerCase()} items
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </ScrollArea>
    );

  const headerToolbar = (
    <div className="ms-auto flex items-center gap-1.5">
      <ToggleGroup
        variant="outline"
        size="xs"
        value={[view]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "board" || next === "list") {
            onViewChange(next);
          }
        }}
      >
        <Toggle aria-label="Board view" value="board">
          <LayoutGridIcon className="size-3.5" />
        </Toggle>
        <Toggle aria-label="List view" value="list">
          <ListIcon className="size-3.5" />
        </Toggle>
      </ToggleGroup>
      <Select
        value={activeProjectId ?? "__all__"}
        onValueChange={(value) => {
          onProjectFilterChange(value === "__all__" ? null : (value as ProjectId));
        }}
        items={[
          { value: "__all__", label: "All projects" },
          ...userProjects.map((project) => ({ value: project.id, label: project.name })),
        ]}
      >
        <SelectTrigger size="xs" className="min-w-36">
          {activeProjectId ? projectNameById.get(activeProjectId) : "All projects"}
        </SelectTrigger>
        <SelectPopup align="end">
          <SelectItem value="__all__">All projects</SelectItem>
          {userProjects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Button size="xs" onClick={openCreateDialog} disabled={userProjects.length === 0}>
        <PlusIcon className="size-3.5" />
        New
      </Button>
    </div>
  );

  return (
    <SidebarInset className="h-full min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron ? (
          <header className="border-b border-border px-3 py-1.5 sm:px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <span className="text-xs font-medium text-foreground">Work</span>
              {headerToolbar}
            </div>
          </header>
        ) : (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">Work</span>
            {headerToolbar}
          </div>
        )}

        <WorkspaceCommandPalette
          open={isWorkspaceCommandPaletteOpen}
          onOpenChange={setIsWorkspaceCommandPaletteOpen}
          items={workspaceCommandPaletteItems}
          placeholder="Type command"
          emptyText="No matching work action."
        />

        {userProjects.length === 0 ? (
          <Empty className="min-h-0 flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderGit2Icon className="size-4.5" />
              </EmptyMedia>
              <EmptyTitle>No projects available</EmptyTitle>
              <EmptyDescription>
                Add a real project first. Work items are project-owned and cannot live in Home.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragCancel={handleDragCancel}
            onDragEnd={handleDragEnd}
          >
            {content}
            <DragOverlay adjustScale={false} dropAnimation={null}>
              {activeDragItem && activeDragProjectName ? (
                view === "board" ? (
                  <WorkItemCardDragOverlay
                    item={activeDragItem}
                    projectName={activeDragProjectName}
                    workspaceName={activeDragWorkspaceName}
                    showProject={activeProjectId === null}
                  />
                ) : (
                  <WorkItemListRowDragOverlay
                    item={activeDragItem}
                    projectName={activeDragProjectName}
                    workspaceName={activeDragWorkspaceName}
                    showProject={activeProjectId === null}
                  />
                )
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <WorkItemEditorDialog
        open={dialogState !== null}
        mode={dialogState?.mode ?? "create"}
        values={editorValues}
        projects={userProjects.map((project) => ({ id: project.id, name: project.name }))}
        workspaces={projectWorkspaceOptions}
        onOpenChange={closeDialog}
        onValuesChange={setEditorValues}
        onSubmit={handleSubmitDialog}
      />
    </SidebarInset>
  );
}
