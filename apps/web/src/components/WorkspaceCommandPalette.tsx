import { type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "./ui/command";

export interface WorkspaceCommandPaletteItem {
  id: string;
  group: "actions" | "terminals" | "sessions";
  title: string;
  subtitle?: string;
  keywords?: string;
  shortcut?: string;
  icon: LucideIcon;
  onSelect: () => void | Promise<void>;
}

interface WorkspaceCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly WorkspaceCommandPaletteItem[];
}

const GROUP_LABELS: Record<WorkspaceCommandPaletteItem["group"], string> = {
  actions: "Suggested",
  terminals: "Terminals",
  sessions: "Sessions",
};

function normalizeSearchValue(item: WorkspaceCommandPaletteItem): string {
  return [item.title, item.subtitle, item.keywords].filter(Boolean).join(" ").toLowerCase();
}

function dispatchPaletteNavigationKey(
  target: EventTarget | null,
  key: "ArrowDown" | "ArrowUp",
): void {
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
}

export function WorkspaceCommandPalette({
  open,
  onOpenChange,
  items,
}: WorkspaceCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlightedItemId(null);
    }
  }, [open]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length === 0) {
      return items;
    }
    return items.filter((item) => normalizeSearchValue(item).includes(normalizedQuery));
  }, [items, query]);
  const hasSearchQuery = query.trim().length > 0;

  const itemsByGroup = useMemo(() => {
    return {
      actions: filteredItems.filter((item) => item.group === "actions"),
      terminals: filteredItems.filter((item) => item.group === "terminals"),
      sessions: filteredItems.filter((item) => item.group === "sessions"),
    } satisfies Record<WorkspaceCommandPaletteItem["group"], WorkspaceCommandPaletteItem[]>;
  }, [filteredItems]);

  const itemById = useMemo(
    () => new Map(filteredItems.map((item) => [item.id, item] as const)),
    [filteredItems],
  );

  const executeItem = (item: WorkspaceCommandPaletteItem) => {
    onOpenChange(false);
    void item.onSelect();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup className="max-w-[30rem] rounded-[18px] border-border/60 bg-[#262626] text-foreground shadow-2xl/18 before:bg-transparent before:shadow-none">
        <Command
          autoHighlight="always"
          keepHighlight
          mode="none"
          value={query}
          onValueChange={setQuery}
          onItemHighlighted={(value) => {
            setHighlightedItemId(typeof value === "string" ? value : null);
          }}
        >
          <CommandPanel className="rounded-b-[18px] border-0 bg-transparent shadow-none before:hidden [clip-path:none]">
            <CommandInput
              className="border-b border-border/45 px-0 text-[12px]"
              placeholder="Type command or search threads"
              onKeyDown={(event) => {
                if (
                  event.ctrlKey &&
                  !event.metaKey &&
                  !event.altKey &&
                  !event.shiftKey &&
                  (event.key === "n" || event.key === "p")
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  dispatchPaletteNavigationKey(
                    event.currentTarget,
                    event.key === "n" ? "ArrowDown" : "ArrowUp",
                  );
                  return;
                }

                if (event.key !== "Enter") {
                  return;
                }
                const highlightedItem = highlightedItemId ? itemById.get(highlightedItemId) : null;
                if (!highlightedItem) {
                  return;
                }
                event.preventDefault();
                executeItem(highlightedItem);
              }}
            />
            <CommandList className="max-h-[min(48vh,22rem)] px-1.5 py-1.5">
              {hasSearchQuery ? (
                <CommandEmpty className="px-3 py-5 text-[12px] text-muted-foreground/80">
                  No matching terminal or session.
                </CommandEmpty>
              ) : null}
              {(["actions", "terminals", "sessions"] as const).map((group) => {
                const groupItems = itemsByGroup[group];
                if (groupItems.length === 0) {
                  return null;
                }
                return (
                  <CommandGroup key={group}>
                    <CommandGroupLabel className="px-2 py-0.5 pb-1 font-medium text-[10px] text-muted-foreground/55 uppercase tracking-[0.08em]">
                      {GROUP_LABELS[group]}
                    </CommandGroupLabel>
                    {groupItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <CommandItem
                          key={item.id}
                          value={item.id}
                          className="cursor-pointer gap-2 rounded-md px-2 py-1.5 text-[12px] data-highlighted:bg-white/[0.07] data-highlighted:text-foreground"
                          onMouseDown={(event) => {
                            event.preventDefault();
                          }}
                          onClick={() => {
                            executeItem(item);
                          }}
                        >
                          <Icon className="size-3.25 shrink-0 text-muted-foreground/80" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-[12px]">{item.title}</div>
                            {item.subtitle ? (
                              <div className="truncate text-[10px] text-muted-foreground/62">
                                {item.subtitle}
                              </div>
                            ) : null}
                          </div>
                          {item.shortcut ? (
                            <CommandShortcut className="rounded bg-white/[0.04] px-1 py-0.5 font-medium text-[9px] tracking-[0.08em] text-muted-foreground/58">
                              {item.shortcut}
                            </CommandShortcut>
                          ) : null}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </CommandPanel>
          <CommandFooter className="border-border/45 px-3.5 py-2 text-[10px] text-muted-foreground/55">
            <span>Quick switch</span>
            <span>Enter to open</span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
