import { type FileDiffMetadata } from "@pierre/diffs/react";
import { SearchIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { toReviewFileTreeEntries } from "../lib/reviewDiffFiles";
import { summarizeTurnDiffStats } from "../lib/turnDiffTree";

import { FileTree, toFileTreeEntries } from "./FileTree";
import { DiffStatLabel, hasNonZeroStat } from "./chat/DiffStatLabel";

export function ReviewFileTree(props: {
  fileDiffs: ReadonlyArray<FileDiffMetadata>;
  resolvedTheme: "light" | "dark";
  selectedPath: string | null;
  onSelectFile: (filePath: string) => void;
}) {
  const { fileDiffs, onSelectFile, resolvedTheme, selectedPath } = props;
  const [filterValue, setFilterValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const reviewEntries = useMemo(() => toReviewFileTreeEntries(fileDiffs), [fileDiffs]);
  const normalizedFilterValue = filterValue.trim().toLocaleLowerCase();
  const filteredEntries = useMemo(() => {
    if (normalizedFilterValue.length === 0) {
      return reviewEntries;
    }
    return reviewEntries.filter((entry) =>
      entry.path.toLocaleLowerCase().includes(normalizedFilterValue),
    );
  }, [normalizedFilterValue, reviewEntries]);
  const summaryStat = useMemo(() => summarizeTurnDiffStats(filteredEntries), [filteredEntries]);
  const fileCountLabel = `${filteredEntries.length} file${filteredEntries.length === 1 ? "" : "s"}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5">
        <span className="text-[13px] font-medium text-muted-foreground/80">{fileCountLabel}</span>
        {hasNonZeroStat(summaryStat) ? (
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
            <DiffStatLabel additions={summaryStat.additions} deletions={summaryStat.deletions} />
          </span>
        ) : null}
      </div>
      <div className="border-b border-border/40 px-2 py-1">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50" />
          <input
            ref={inputRef}
            type="search"
            value={filterValue}
            onChange={(event) => setFilterValue(event.target.value)}
            placeholder="Filter..."
            className="h-7 w-full rounded-sm border border-border/50 bg-background/60 pl-6 pr-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:border-border focus:outline-none"
            aria-label="Filter review files"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 py-0.5">
        <FileTree
          entries={toFileTreeEntries(filteredEntries)}
          resolvedTheme={resolvedTheme}
          onSelectFile={onSelectFile}
          selectedPath={selectedPath}
          emptyLabel={
            normalizedFilterValue.length > 0 ? "No files match filter." : "No files in this review."
          }
        />
      </div>
    </div>
  );
}
