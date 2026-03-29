import { DiffIcon, PlusIcon, TerminalSquareIcon, XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { type WorkspaceTab, type WorkspaceTabId } from "~/workspaceTabs";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";

interface WorkspaceTabBarProps {
  tabs: readonly WorkspaceTab[];
  activeTabId: WorkspaceTabId;
  onSelectTab: (tabId: WorkspaceTabId) => void;
  onCloseTab: (tabId: WorkspaceTabId) => void;
  canCreateTerminal: boolean;
  canOpenReview: boolean;
  onCreateTerminal: () => void;
  onOpenReview: () => void;
}

export function WorkspaceTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  canCreateTerminal,
  canOpenReview,
  onCreateTerminal,
  onOpenReview,
}: WorkspaceTabBarProps) {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="px-3 pb-0 sm:px-5">
      <div className="flex min-w-0 items-end gap-1 border-b border-border/45">
        <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const Icon = tab.icon;

            return (
              <div
                key={tab.id}
                className={cn(
                  "group -mb-px inline-flex shrink-0 items-center gap-1 rounded-t-md border px-2 py-1.5 text-[11px] transition-[border-color,background-color,color,box-shadow]",
                  isActive
                    ? "border-border/60 border-b-background bg-background text-foreground shadow-[0_1px_0_rgba(255,255,255,0.04)]"
                    : "border-transparent bg-transparent text-muted-foreground/80 hover:bg-foreground/[0.035] hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  className="inline-flex min-w-0 cursor-pointer items-center gap-1.5"
                  onClick={() => onSelectTab(tab.id)}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{tab.title}</span>
                </button>

                {tab.closeable ? (
                  <button
                    type="button"
                    className="inline-flex size-3.5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                    onClick={() => onCloseTab(tab.id)}
                    aria-label={`Close ${tab.title}`}
                  >
                    <XIcon className="size-2.75" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

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
