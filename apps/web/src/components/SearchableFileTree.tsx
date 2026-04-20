import { SearchIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import { FileTree, type FileTreeEntry } from "./FileTree";

export function SearchableFileTree(props: {
  entries: ReadonlyArray<FileTreeEntry>;
  resolvedTheme: "light" | "dark";
  onSelectFile: (path: string) => void;
  selectedPath?: string | null;
  defaultDirectoriesExpanded?: boolean;
  emptyLabel?: string;
  textSize?: "default" | "compact";
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel: string;
  loading?: boolean;
  loadingLabel?: string;
  className?: string;
}) {
  const {
    className,
    defaultDirectoriesExpanded,
    emptyLabel,
    entries,
    loading = false,
    loadingLabel = "Loading…",
    onSearchValueChange,
    onSelectFile,
    resolvedTheme,
    searchAriaLabel,
    searchPlaceholder = "Search files…",
    searchValue,
    selectedPath,
    textSize = "compact",
  } = props;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
        <input
          type="search"
          value={searchValue}
          onChange={(event) => onSearchValueChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-6 w-full min-w-0 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40"
          aria-label={searchAriaLabel}
        />
        {searchValue.length > 0 ? (
          <button
            type="button"
            className="shrink-0 rounded-sm p-0.5 text-muted-foreground/50 hover:text-foreground"
            onClick={() => onSearchValueChange("")}
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1.5">
        {loading ? (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground/70">{loadingLabel}</div>
        ) : null}
        <FileTree
          entries={entries}
          resolvedTheme={resolvedTheme}
          onSelectFile={onSelectFile}
          selectedPath={selectedPath ?? null}
          {...(defaultDirectoriesExpanded !== undefined ? { defaultDirectoriesExpanded } : {})}
          textSize={textSize}
          {...(emptyLabel !== undefined ? { emptyLabel } : {})}
        />
      </div>
    </div>
  );
}
