import { type FileDiffMetadata } from "@pierre/diffs/react";
import { useMemo, useState } from "react";

import { toReviewFileTreeEntries } from "../lib/reviewDiffFiles";
import { summarizeTurnDiffStats } from "../lib/turnDiffTree";

import { toFileTreeEntries } from "./FileTree";
import { SearchableFileTree } from "./SearchableFileTree";
import { DiffStatLabel, hasNonZeroStat } from "./chat/DiffStatLabel";

export function ReviewFileTree(props: {
  fileDiffs: ReadonlyArray<FileDiffMetadata>;
  resolvedTheme: "light" | "dark";
  selectedPath: string | null;
  onSelectFile: (filePath: string) => void;
}) {
  const { fileDiffs, onSelectFile, resolvedTheme, selectedPath } = props;
  const [filterValue, setFilterValue] = useState("");
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
        <span className="text-[12px] font-medium text-muted-foreground/80">{fileCountLabel}</span>
        {hasNonZeroStat(summaryStat) ? (
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
            <DiffStatLabel additions={summaryStat.additions} deletions={summaryStat.deletions} />
          </span>
        ) : null}
      </div>
      <SearchableFileTree
        entries={toFileTreeEntries(filteredEntries)}
        resolvedTheme={resolvedTheme}
        onSelectFile={onSelectFile}
        selectedPath={selectedPath}
        defaultDirectoriesExpanded
        textSize="compact"
        searchValue={filterValue}
        onSearchValueChange={setFilterValue}
        searchAriaLabel="Search review files"
        emptyLabel={
          normalizedFilterValue.length > 0 ? "No files match filter." : "No files in this review."
        }
      />
    </div>
  );
}
