import { DiffIcon, PlusIcon, SquarePenIcon, TerminalSquareIcon, XIcon } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { type WorkspaceTab, type WorkspaceTabId } from "~/workspaceTabs";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";

interface WorkspaceTabBarProps {
  tabs: readonly WorkspaceTab[];
  activeTabId: WorkspaceTabId;
  onSelectTab: (tabId: WorkspaceTabId) => void;
  onReorderTab: (draggedTabId: WorkspaceTabId, targetTabId: WorkspaceTabId) => void;
  onCloseTab: (tabId: WorkspaceTabId) => void;
  canCreateSession: boolean;
  canCreateTerminal: boolean;
  canOpenReview: boolean;
  onCreateSession: () => void;
  onCreateTerminal: () => void;
  onOpenReview: () => void;
}

export function WorkspaceTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onReorderTab,
  onCloseTab,
  canCreateSession,
  canCreateTerminal,
  canOpenReview,
  onCreateSession,
  onCreateTerminal,
  onOpenReview,
}: WorkspaceTabBarProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const [activeDragTabId, setActiveDragTabId] = useState<WorkspaceTabId | null>(null);
  const tabsById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab] as const)), [tabs]);
  const activeDragTab = activeDragTabId ? (tabsById.get(activeDragTabId) ?? null) : null;

  if (tabs.length === 0) {
    return null;
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragTabId(String(event.active.id));
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    setActiveDragTabId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
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
          collisionDetection={closestCenter}
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
  onCloseTab,
}: {
  tab: WorkspaceTab;
  isActive: boolean;
  onSelectTab: (tabId: WorkspaceTabId) => void;
  onCloseTab: (tabId: WorkspaceTabId) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: tab.id,
  });
  const Icon = tab.icon;
  const hasRunningProcess = tab.kind === "terminal" && tab.hasRunningProcess;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "group -mb-px inline-flex shrink-0 items-center gap-1 rounded-t-md border px-2 py-1.5 text-[11px] transition-[border-color,background-color,color,box-shadow]",
        isActive
          ? "border-border/60 border-b-background bg-background text-foreground shadow-[0_1px_0_rgba(255,255,255,0.04)]"
          : "border-transparent bg-transparent text-muted-foreground/80 hover:bg-foreground/[0.035] hover:text-foreground",
        isSortableDragging ? "z-10 opacity-0" : "",
      )}
    >
      <button
        type="button"
        className="-m-1 inline-flex min-h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-[inherit] px-1 py-1 touch-none"
        onClick={() => onSelectTab(tab.id)}
        aria-current={isActive ? "page" : undefined}
        {...attributes}
        {...listeners}
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
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
          aria-label={`Close ${tab.title}`}
        >
          <XIcon className="size-2.75" />
        </button>
      ) : null}
    </div>
  );
}

function WorkspaceTabGhost({ tab, isActive }: { tab: WorkspaceTab; isActive: boolean }) {
  const Icon = tab.icon;

  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-t-md border px-2 py-1.5 text-[11px] shadow-lg",
        isActive
          ? "border-border/60 border-b-background bg-background text-foreground"
          : "border-border/60 bg-background text-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{tab.title}</span>
      {tab.closeable ? <XIcon className="size-2.75 shrink-0 text-muted-foreground/70" /> : null}
    </div>
  );
}
