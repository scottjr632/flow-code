import type { ProjectEntry } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { FileCode2Icon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import { basenameOfPath } from "~/vscode-icons";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "./ui/command";

interface WorkspaceFilePaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cwd: string | null;
  projectName?: string | null;
  resolvedTheme: "light" | "dark";
  onSelectFile?: ((relativePath: string) => void) | null;
  unavailableText?: string;
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

export function WorkspaceFilePalette(props: WorkspaceFilePaletteProps) {
  const { cwd, onOpenChange, onSelectFile, open, projectName, resolvedTheme, unavailableText } =
    props;
  const [query, setQuery] = useState("");
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [debouncedQuery, queryDebouncer] = useDebouncedValue(
    query,
    { wait: 120 },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlightedItemId(null);
    }
  }, [open]);

  const trimmedQuery = query.trim();
  const effectiveQuery = trimmedQuery.length > 0 ? debouncedQuery.trim() : "";
  const canOpenFiles = Boolean(cwd && onSelectFile);
  const searchEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd,
      query: effectiveQuery,
      enabled: open && canOpenFiles && effectiveQuery.length > 0,
      limit: 120,
    }),
  );
  const fileEntries = useMemo(
    () => (searchEntriesQuery.data?.entries ?? []).filter((entry) => entry.kind === "file"),
    [searchEntriesQuery.data?.entries],
  );
  const itemById = useMemo(
    () => new Map(fileEntries.map((entry) => [entry.path, entry] as const)),
    [fileEntries],
  );
  const statusText = unavailableText ?? "Open a session workspace to search project files.";
  const isSearching =
    canOpenFiles &&
    trimmedQuery.length > 0 &&
    (queryDebouncer.state.isPending ||
      searchEntriesQuery.isLoading ||
      searchEntriesQuery.isFetching);

  const executeEntry = (entry: ProjectEntry) => {
    if (!onSelectFile) {
      return;
    }
    onOpenChange(false);
    onSelectFile(entry.path);
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
              disabled={!canOpenFiles}
              placeholder={
                canOpenFiles
                  ? `Search files${projectName ? ` in ${projectName}` : ""}`
                  : "File search unavailable here"
              }
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
                executeEntry(highlightedItem);
              }}
            />
            <CommandList className="max-h-[min(48vh,22rem)] px-1.5 py-1.5">
              {!canOpenFiles ? (
                <div className="px-3 py-5 text-[12px] text-muted-foreground/80">{statusText}</div>
              ) : trimmedQuery.length === 0 ? (
                <div className="flex items-center gap-2 px-3 py-5 text-[12px] text-muted-foreground/75">
                  <SearchIcon className="size-3.5 shrink-0" />
                  <span>Type to search files{projectName ? ` in ${projectName}` : ""}.</span>
                </div>
              ) : isSearching ? (
                <div className="px-3 py-5 text-[12px] text-muted-foreground/80">Searching…</div>
              ) : fileEntries.length === 0 ? (
                <div className="px-3 py-5 text-[12px] text-muted-foreground/80">
                  No matching files.
                </div>
              ) : (
                <>
                  {fileEntries.map((entry) => (
                    <CommandItem
                      key={entry.path}
                      value={entry.path}
                      className="cursor-pointer gap-2 rounded-md px-2 py-1.5 text-[12px] data-highlighted:bg-white/[0.07] data-highlighted:text-foreground"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={() => {
                        executeEntry(entry);
                      }}
                    >
                      <VscodeEntryIcon
                        pathValue={entry.path}
                        kind={entry.kind}
                        theme={resolvedTheme}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-[12px]">
                          {basenameOfPath(entry.path)}
                        </div>
                        {entry.parentPath ? (
                          <div className="truncate text-[10px] text-muted-foreground/62">
                            {entry.parentPath}
                          </div>
                        ) : null}
                      </div>
                    </CommandItem>
                  ))}
                </>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter className="border-border/45 px-3.5 py-2 text-[10px] text-muted-foreground/55">
            <span>{canOpenFiles ? "Quick open" : "Workspace required"}</span>
            <span>{canOpenFiles ? "Enter to open" : "Cmd+K for threads and actions"}</span>
            {canOpenFiles ? (
              <CommandShortcut className="rounded bg-white/[0.04] px-1 py-0.5 font-medium text-[9px] tracking-[0.08em] text-muted-foreground/58">
                <FileCode2Icon className="mr-1 inline size-2.5" />
                Files
              </CommandShortcut>
            ) : null}
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
