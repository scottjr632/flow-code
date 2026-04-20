import { ChevronRightIcon, FolderClosedIcon, FolderIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import { buildTurnDiffTree, type TurnDiffTreeNode } from "../lib/turnDiffTree";
import { cn } from "~/lib/utils";

import { DiffStatLabel, hasNonZeroStat } from "./chat/DiffStatLabel";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";

export interface FileTreeEntry {
  path: string;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export function toFileTreeEntries(
  entries: ReadonlyArray<{
    path: string;
    additions?: number | undefined;
    deletions?: number | undefined;
  }>,
): FileTreeEntry[] {
  return entries.map((entry) => ({
    path: entry.path,
    ...(entry.additions !== undefined ? { additions: entry.additions } : {}),
    ...(entry.deletions !== undefined ? { deletions: entry.deletions } : {}),
  }));
}

export const FileTree = memo(function FileTree(props: {
  entries: ReadonlyArray<FileTreeEntry>;
  resolvedTheme: "light" | "dark";
  onSelectFile: (path: string) => void;
  selectedPath?: string | null;
  allDirectoriesExpanded?: boolean;
  defaultDirectoriesExpanded?: boolean;
  emptyLabel?: string;
  textSize?: "default" | "compact";
  className?: string;
}) {
  const {
    allDirectoriesExpanded,
    className,
    defaultDirectoriesExpanded = false,
    emptyLabel = "No files.",
    entries,
    onSelectFile,
    resolvedTheme,
    selectedPath = null,
    textSize = "default",
  } = props;
  const labelTextClass = textSize === "compact" ? "text-[11px]" : "text-sm";
  const statTextClass = textSize === "compact" ? "text-[11px]" : "text-xs";
  const treeNodes = useMemo(() => buildTurnDiffTree(entries), [entries]);
  const directoryPaths = useMemo(() => collectDirectoryPaths(treeNodes), [treeNodes]);
  const allDirectoryExpansionState = useMemo(
    () =>
      buildDirectoryExpansionState(
        directoryPaths,
        allDirectoriesExpanded ?? defaultDirectoriesExpanded,
      ),
    [allDirectoriesExpanded, defaultDirectoriesExpanded, directoryPaths],
  );
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>(() =>
    buildDirectoryExpansionState(
      directoryPaths,
      allDirectoriesExpanded ?? defaultDirectoriesExpanded,
    ),
  );

  useEffect(() => {
    if (typeof allDirectoriesExpanded === "boolean") {
      setExpandedDirectories(allDirectoryExpansionState);
      return;
    }

    setExpandedDirectories((current) =>
      mergeDirectoryExpansionState(current, directoryPaths, defaultDirectoriesExpanded),
    );
  }, [
    allDirectoriesExpanded,
    allDirectoryExpansionState,
    defaultDirectoriesExpanded,
    directoryPaths,
  ]);

  if (treeNodes.length === 0) {
    return (
      <div
        className={cn(
          "px-2 py-3 text-muted-foreground/70",
          textSize === "compact" ? "text-[11px]" : "text-xs",
          className,
        )}
      >
        {emptyLabel}
      </div>
    );
  }

  const toggleDirectory = (pathValue: string) => {
    setExpandedDirectories((current) => ({
      ...current,
      [pathValue]: !(current[pathValue] ?? defaultDirectoriesExpanded),
    }));
  };

  const renderTreeNode = (node: TurnDiffTreeNode, depth: number) => {
    const leftPadding = 6 + depth * 16;
    if (node.kind === "directory") {
      const isExpanded = expandedDirectories[node.path] ?? defaultDirectoriesExpanded;
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            className="group flex w-full cursor-pointer items-center gap-1.5 rounded-sm py-1 pr-2 text-left hover:bg-background/80"
            style={{ paddingLeft: `${leftPadding}px` }}
            onClick={() => toggleDirectory(node.path)}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:text-foreground/80",
                isExpanded && "rotate-90",
              )}
            />
            {isExpanded ? (
              <FolderIcon className="size-4 shrink-0 text-muted-foreground/70" />
            ) : (
              <FolderClosedIcon className="size-4 shrink-0 text-muted-foreground/70" />
            )}
            <span
              className={cn(
                "truncate font-mono leading-snug text-muted-foreground/90 group-hover:text-foreground/90",
                labelTextClass,
              )}
            >
              {node.name}
            </span>
            {hasNonZeroStat(node.stat) ? (
              <span
                className={cn("ml-auto shrink-0 font-mono tabular-nums opacity-70", statTextClass)}
              >
                <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
              </span>
            ) : null}
          </button>
          {isExpanded
            ? node.children.map((childNode) => renderTreeNode(childNode, depth + 1))
            : null}
        </div>
      );
    }

    const isSelected = selectedPath === node.path;
    return (
      <button
        key={`file:${node.path}`}
        type="button"
        className={cn(
          "group flex w-full cursor-pointer items-center gap-1.5 rounded-sm py-1 pr-2 text-left transition-colors hover:bg-background/80",
          isSelected && "bg-accent text-accent-foreground hover:bg-accent",
        )}
        style={{ paddingLeft: `${leftPadding}px` }}
        onClick={() => onSelectFile(node.path)}
        aria-current={isSelected ? "page" : undefined}
      >
        <span aria-hidden="true" className="size-4 shrink-0" />
        <VscodeEntryIcon
          pathValue={node.path}
          kind="file"
          theme={resolvedTheme}
          className="size-4 shrink-0 text-muted-foreground/70"
        />
        <span
          className={cn(
            "truncate font-mono leading-snug text-muted-foreground/80 group-hover:text-foreground/90",
            labelTextClass,
            isSelected && "text-accent-foreground",
          )}
        >
          {node.name}
        </span>
        {node.stat ? (
          <span className={cn("ml-auto shrink-0 font-mono tabular-nums opacity-70", statTextClass)}>
            <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
          </span>
        ) : null}
      </button>
    );
  };

  return <div className={className}>{treeNodes.map((node) => renderTreeNode(node, 0))}</div>;
});

function collectDirectoryPaths(nodes: ReadonlyArray<TurnDiffTreeNode>): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children));
  }
  return paths;
}

function buildDirectoryExpansionState(
  directoryPaths: ReadonlyArray<string>,
  expanded: boolean,
): Record<string, boolean> {
  const expandedState: Record<string, boolean> = {};
  for (const directoryPath of directoryPaths) {
    expandedState[directoryPath] = expanded;
  }
  return expandedState;
}

function mergeDirectoryExpansionState(
  current: Readonly<Record<string, boolean>>,
  directoryPaths: ReadonlyArray<string>,
  defaultExpanded: boolean,
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const directoryPath of directoryPaths) {
    next[directoryPath] = current[directoryPath] ?? defaultExpanded;
  }
  return next;
}
