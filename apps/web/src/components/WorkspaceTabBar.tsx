import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DiffIcon,
  FolderTreeIcon,
  PlusIcon,
  SquarePenIcon,
  TerminalSquareIcon,
  XIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { providerIconClassName } from "~/providerIcons";
import { type WorkspaceTab, type WorkspaceTabId } from "~/workspaceTabs";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";

interface WorkspaceTabBarProps {
  tabs: readonly WorkspaceTab[];
  activeTabId: WorkspaceTabId;
  onSelectTab: (tabId: WorkspaceTabId) => void;
  onOpenTabContextMenu?: (
    tab: WorkspaceTab,
    position: { x: number; y: number },
  ) => void | Promise<void>;
  onReorderTab: (draggedTabId: WorkspaceTabId, targetTabId: WorkspaceTabId) => void;
  onCloseTab: (tabId: WorkspaceTabId) => void;
  canCreateSession: boolean;
  canCreateTerminal: boolean;
  canOpenFiles: boolean;
  canOpenReview: boolean;
  onCreateSession: () => void;
  onCreateTerminal: () => void;
  onOpenFiles: () => void;
  onOpenReview: () => void;
}

export function WorkspaceTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onOpenTabContextMenu,
  onReorderTab,
  onCloseTab,
  canCreateSession,
  canCreateTerminal,
  canOpenFiles,
  canOpenReview,
  onCreateSession,
  onCreateTerminal,
  onOpenFiles,
  onOpenReview,
}: WorkspaceTabBarProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const dragInProgressRef = useRef(false);
  const suppressTabClickAfterDragRef = useRef(false);
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);
  const [activeDragTabId, setActiveDragTabId] = useState<WorkspaceTabId | null>(null);
  const tabsById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab] as const)), [tabs]);
  const activeDragTab = activeDragTabId ? (tabsById.get(activeDragTabId) ?? null) : null;

  if (tabs.length === 0) {
    return null;
  }

  const handleDragStart = (event: DragStartEvent) => {
    dragInProgressRef.current = true;
    suppressTabClickAfterDragRef.current = true;
    setActiveDragTabId(String(event.active.id));
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
    setActiveDragTabId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    dragInProgressRef.current = false;
    setActiveDragTabId(null);
    if (!over || active.id === over.id) {
      return;
    }
    onReorderTab(String(active.id), String(over.id));
  };

  return (
    <div className="px-3 pb-0 sm:px-5">
      <div className="flex min-w-0 items-end gap-1 border-b border-border/45">
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          modifiers={[restrictToHorizontalAxis]}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={tabs.map((tab) => tab.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tabs.map((tab) => (
                <SortableWorkspaceTab
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onSelectTab={onSelectTab}
                  dragInProgressRef={dragInProgressRef}
                  suppressTabClickAfterDragRef={suppressTabClickAfterDragRef}
                  {...(onOpenTabContextMenu ? { onOpenTabContextMenu } : {})}
                  onCloseTab={onCloseTab}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay adjustScale={false} dropAnimation={null}>
            {activeDragTab ? (
              <WorkspaceTabGhost tab={activeDragTab} isActive={activeDragTab.id === activeTabId} />
            ) : null}
          </DragOverlay>
        </DndContext>

        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                className="mb-1 inline-flex size-6.5 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                aria-label="New tab"
              />
            }
          >
            <PlusIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" side="bottom">
            <MenuItem disabled={!canCreateSession} onClick={onCreateSession}>
              <SquarePenIcon className="size-3.5" />
              New session
            </MenuItem>
            <MenuItem disabled={!canCreateTerminal} onClick={onCreateTerminal}>
              <TerminalSquareIcon className="size-3.5" />
              New terminal
            </MenuItem>
            <MenuItem disabled={!canOpenFiles} onClick={onOpenFiles}>
              <FolderTreeIcon className="size-3.5" />
              Browse files
            </MenuItem>
            <MenuItem disabled={!canOpenReview} onClick={onOpenReview}>
              <DiffIcon className="size-3.5" />
              Review changes
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}

function SortableWorkspaceTab({
  tab,
  isActive,
  onSelectTab,
  dragInProgressRef,
  suppressTabClickAfterDragRef,
  onOpenTabContextMenu,
  onCloseTab,
}: {
  tab: WorkspaceTab;
  isActive: boolean;
  onSelectTab: (tabId: WorkspaceTabId) => void;
  dragInProgressRef: MutableRefObject<boolean>;
  suppressTabClickAfterDragRef: MutableRefObject<boolean>;
  onOpenTabContextMenu?: (
    tab: WorkspaceTab,
    position: { x: number; y: number },
  ) => void | Promise<void>;
  onCloseTab: (tabId: WorkspaceTabId) => void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: tab.id,
  });
  const Icon = tab.icon;
  const hasRunningProcess = tab.kind === "terminal" && tab.hasRunningProcess;
  const providerIconClass =
    tab.kind === "session" ? providerIconClassName(tab.provider, "text-current") : null;
  const closeActionLabel = tab.kind === "session" ? "Archive" : "Close";
  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onOpenTabContextMenu) {
      return;
    }
    event.preventDefault();
    void onOpenTabContextMenu(tab, { x: event.clientX, y: event.clientY });
  };
  const handlePointerDownCapture = (_event: ReactPointerEvent<HTMLButtonElement>) => {
    suppressTabClickAfterDragRef.current = false;
  };
  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (dragInProgressRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (suppressTabClickAfterDragRef.current) {
      suppressTabClickAfterDragRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onSelectTab(tab.id);
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onContextMenu={handleContextMenu}
      className={cn(
        "group -mb-px inline-flex shrink-0 items-center gap-1 rounded-t-md border px-2 py-1.5 text-[11px] transition-[border-color,background-color,color,box-shadow]",
        isActive
          ? "border-border/60 border-b-background bg-background text-foreground shadow-[0_1px_0_rgba(255,255,255,0.04)]"
          : "border-transparent bg-transparent text-muted-foreground/80 hover:bg-foreground/[0.035] hover:text-foreground",
        isSortableDragging ? "z-10 opacity-0" : "",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="-m-1 inline-flex min-h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-[inherit] px-1 py-1 touch-none"
        onPointerDownCapture={handlePointerDownCapture}
        onClick={handleClick}
        aria-current={isActive ? "page" : undefined}
        {...attributes}
        {...listeners}
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            providerIconClass,
            hasRunningProcess && "animate-pulse text-teal-600 dark:text-teal-300/90",
          )}
        />
        <span className="truncate">{tab.title}</span>
      </button>

      {tab.closeable ? (
        <button
          type="button"
          className="-m-1 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onCloseTab(tab.id);
          }}
          aria-label={`${closeActionLabel} ${tab.title}`}
        >
          <XIcon className="size-2.75" />
        </button>
      ) : null}
    </div>
  );
}

function WorkspaceTabGhost({ tab, isActive }: { tab: WorkspaceTab; isActive: boolean }) {
  const Icon = tab.icon;
  const providerIconClass =
    tab.kind === "session" ? providerIconClassName(tab.provider, "text-current") : null;

  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-t-md border px-2 py-1.5 text-[11px] shadow-lg",
        isActive
          ? "border-border/60 border-b-background bg-background text-foreground"
          : "border-border/60 bg-background text-foreground",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", providerIconClass)} />
      <span className="truncate">{tab.title}</span>
      {tab.closeable ? <XIcon className="size-2.75 shrink-0 text-muted-foreground/70" /> : null}
    </div>
  );
}
