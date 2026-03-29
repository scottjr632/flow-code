import type { ProjectEntry, ThreadId } from "@t3tools/contracts";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileSearchIcon,
  FolderTreeIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { openInPreferredEditor } from "../editorPreferences";
import {
  projectDiagnosticsQueryOptions,
  projectLspStatusQueryOptions,
  projectListDirectoryQueryOptions,
  projectQueryKeys,
  projectSearchEntriesQueryOptions,
} from "../lib/projectReactQuery";
import { cn } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import {
  directoryAncestorsOf,
  isBufferDirty,
  useThreadWorkspaceEditorState,
  useWorkspaceEditorStore,
} from "../workspaceEditorStore";
import { buildFileWorkspaceTabId } from "../workspaceTabs";
import { basenameOfPath } from "../vscode-icons";
import { WorkspaceCodeEditor } from "./WorkspaceCodeEditor";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { Button } from "./ui/button";

interface ExplorerTreeNodeProps {
  depth?: number;
  entry: ProjectEntry;
  activeRelativePath: string | null;
  directoryEntriesByPath: ReadonlyMap<string, readonly ProjectEntry[]>;
  expandedDirectoryPaths: ReadonlySet<string>;
  loadingDirectoryPaths: ReadonlySet<string>;
  resolvedTheme: "light" | "dark";
  onToggleDirectory: (relativePath: string) => void;
  onOpenFile: (relativePath: string) => void;
}

function ExplorerTreeNode({
  depth = 0,
  entry,
  activeRelativePath,
  directoryEntriesByPath,
  expandedDirectoryPaths,
  loadingDirectoryPaths,
  resolvedTheme,
  onToggleDirectory,
  onOpenFile,
}: ExplorerTreeNodeProps) {
  const isDirectory = entry.kind === "directory";
  const isExpanded = isDirectory && expandedDirectoryPaths.has(entry.path);
  const childEntries = isDirectory ? (directoryEntriesByPath.get(entry.path) ?? []) : [];
  const isActive = activeRelativePath === entry.path;

  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-[11px] leading-tight transition-colors",
          isActive
            ? "bg-primary/12 text-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => {
          if (isDirectory) {
            onToggleDirectory(entry.path);
            return;
          }
          onOpenFile(entry.path);
        }}
      >
        {isDirectory ? (
          isExpanded ? (
            <ChevronDownIcon className="size-3 shrink-0" />
          ) : (
            <ChevronRightIcon className="size-3 shrink-0" />
          )
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <VscodeEntryIcon
          pathValue={entry.path}
          kind={entry.kind}
          theme={resolvedTheme}
          className="size-3"
        />
        <span className="truncate">{basenameOfPath(entry.path)}</span>
        {isDirectory && loadingDirectoryPaths.has(entry.path) ? (
          <RefreshCwIcon className="ml-auto size-3 shrink-0 animate-spin text-muted-foreground/60" />
        ) : null}
      </button>

      {isDirectory && isExpanded ? (
        <div>
          {childEntries.map((childEntry) => (
            <ExplorerTreeNode
              key={childEntry.path}
              depth={depth + 1}
              entry={childEntry}
              activeRelativePath={activeRelativePath}
              directoryEntriesByPath={directoryEntriesByPath}
              expandedDirectoryPaths={expandedDirectoryPaths}
              loadingDirectoryPaths={loadingDirectoryPaths}
              resolvedTheme={resolvedTheme}
              onToggleDirectory={onToggleDirectory}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function absoluteFilePath(workspaceRoot: string, relativePath: string): string {
  return `${workspaceRoot.replace(/[\\/]+$/, "")}/${relativePath}`;
}

export function WorkspaceEditorSurface(props: {
  threadId: ThreadId;
  workspaceRoot: string;
  resolvedTheme: "light" | "dark";
  activeRelativePath: string | null;
  onSelectWorkspaceTab: (tabId: string) => void;
}) {
  const { activeRelativePath, onSelectWorkspaceTab, resolvedTheme, threadId, workspaceRoot } =
    props;
  const queryClient = useQueryClient();
  const [explorerQuery, setExplorerQuery] = useState("");
  const [lspActionPending, setLspActionPending] = useState(false);
  const lspOpenedPathsRef = useRef(new Set<string>());
  const lspSyncedContentsRef = useRef(new Map<string, string>());
  const editorState = useThreadWorkspaceEditorState(threadId);
  const openFile = useWorkspaceEditorStore((state) => state.openFile);
  const setBufferState = useWorkspaceEditorStore((state) => state.setBufferState);
  const setBufferContents = useWorkspaceEditorStore((state) => state.setBufferContents);
  const markBufferSaved = useWorkspaceEditorStore((state) => state.markBufferSaved);
  const toggleDirectoryExpanded = useWorkspaceEditorStore((state) => state.toggleDirectoryExpanded);
  const ensureDirectoriesExpanded = useWorkspaceEditorStore(
    (state) => state.ensureDirectoriesExpanded,
  );
  const setExplorerOpen = useWorkspaceEditorStore((state) => state.setExplorerOpen);

  const activeBuffer = activeRelativePath
    ? (editorState.buffersByPath[activeRelativePath] ?? null)
    : null;
  const rootDirectoryPaths = useMemo(
    () => [
      "",
      ...editorState.expandedDirectoryPaths.toSorted((left, right) => left.localeCompare(right)),
    ],
    [editorState.expandedDirectoryPaths],
  );
  const directoryQueries = useQueries({
    queries: rootDirectoryPaths.map((relativePath) =>
      projectListDirectoryQueryOptions({
        cwd: workspaceRoot,
        relativePath,
        enabled: editorState.explorerOpen,
      }),
    ),
  });
  const searchEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: workspaceRoot,
      query: explorerQuery,
      enabled: editorState.explorerOpen && explorerQuery.trim().length > 0,
      limit: 120,
    }),
  );
  const workspaceDiagnosticsQuery = useQuery(
    projectDiagnosticsQueryOptions({
      cwd: workspaceRoot,
    }),
  );
  const activeFileDiagnosticsQuery = useQuery(
    projectDiagnosticsQueryOptions({
      cwd: workspaceRoot,
      relativePath: activeRelativePath,
      enabled: activeRelativePath !== null,
    }),
  );
  const lspStatusQuery = useQuery(
    projectLspStatusQueryOptions({
      cwd: workspaceRoot,
    }),
  );

  const directoryEntriesByPath = useMemo(() => {
    const nextEntriesByPath = new Map<string, readonly ProjectEntry[]>();
    rootDirectoryPaths.forEach((relativePath, index) => {
      nextEntriesByPath.set(relativePath, directoryQueries[index]?.data?.entries ?? []);
    });
    return nextEntriesByPath;
  }, [directoryQueries, rootDirectoryPaths]);
  const loadingDirectoryPaths = useMemo(() => {
    const nextPaths = new Set<string>();
    rootDirectoryPaths.forEach((relativePath, index) => {
      if (directoryQueries[index]?.isLoading || directoryQueries[index]?.isFetching) {
        nextPaths.add(relativePath);
      }
    });
    return nextPaths;
  }, [directoryQueries, rootDirectoryPaths]);
  const expandedDirectoryPaths = useMemo(
    () => new Set(editorState.expandedDirectoryPaths),
    [editorState.expandedDirectoryPaths],
  );
  const activeDiagnostics = activeFileDiagnosticsQuery.data?.diagnostics ?? [];
  const activeFileDiagnosticsCount = activeDiagnostics.length;
  const totalDiagnosticsCount = workspaceDiagnosticsQuery.data?.diagnostics.length ?? 0;
  const lspStatus = lspStatusQuery.data;
  const lspLabel =
    lspStatus?.server?.label ?? lspStatus?.availableServers[0]?.label ?? "Language server";
  const lspStatusText =
    lspStatus?.state === "running"
      ? `${lspLabel} ready`
      : lspStatus?.state === "starting"
        ? `Starting ${lspLabel}`
        : lspStatus?.state === "error"
          ? (lspStatus.detail?.trim() ?? `${lspLabel} failed`)
          : lspStatus?.state === "unavailable"
            ? (lspStatus.detail?.trim() ?? "LSP unavailable")
            : `${lspLabel} stopped`;

  useEffect(() => {
    if (!activeRelativePath) {
      return;
    }
    ensureDirectoriesExpanded(threadId, directoryAncestorsOf(activeRelativePath));
  }, [activeRelativePath, ensureDirectoriesExpanded, threadId]);

  useEffect(() => {
    if (lspStatus?.state === "running") {
      return;
    }
    lspOpenedPathsRef.current.clear();
    lspSyncedContentsRef.current.clear();
  }, [lspStatus?.state]);

  const loadFile = useCallback(
    async (relativePath: string, force = false) => {
      const existingBuffer = editorState.buffersByPath[relativePath] ?? null;
      if (
        !force &&
        existingBuffer &&
        (existingBuffer.status === "ready" || existingBuffer.status === "saving")
      ) {
        return;
      }
      setBufferState(props.threadId, relativePath, (current) => ({
        relativePath,
        contents: force ? (current?.savedContents ?? "") : (current?.contents ?? ""),
        savedContents: force ? (current?.savedContents ?? "") : (current?.savedContents ?? ""),
        status: "loading",
        error: null,
        binary: current?.binary ?? false,
        tooLarge: current?.tooLarge ?? false,
        byteLength: current?.byteLength ?? 0,
        maxBytes: current?.maxBytes ?? 0,
        mtimeMs: current?.mtimeMs ?? null,
      }));

      try {
        const api = readNativeApi();
        if (!api) {
          throw new Error("Native API not found.");
        }
        const result = await api.projects.readFile({
          cwd: props.workspaceRoot,
          relativePath,
        });
        setBufferState(props.threadId, relativePath, (current) => ({
          relativePath,
          contents:
            current && isBufferDirty(current) && !force ? current.contents : result.contents,
          savedContents: result.contents,
          status: "ready",
          error: null,
          binary: result.binary,
          tooLarge: result.tooLarge,
          byteLength: result.byteLength,
          maxBytes: result.maxBytes,
          mtimeMs: result.mtimeMs,
        }));
      } catch (error) {
        setBufferState(props.threadId, relativePath, (current) => ({
          relativePath,
          contents: current?.contents ?? "",
          savedContents: current?.savedContents ?? "",
          status: "error",
          error: error instanceof Error ? error.message : "Unable to read file.",
          binary: current?.binary ?? false,
          tooLarge: current?.tooLarge ?? false,
          byteLength: current?.byteLength ?? 0,
          maxBytes: current?.maxBytes ?? 0,
          mtimeMs: current?.mtimeMs ?? null,
        }));
      }
    },
    [editorState.buffersByPath, props.threadId, props.workspaceRoot, setBufferState],
  );

  useEffect(() => {
    if (!props.activeRelativePath) {
      return;
    }
    const buffer = editorState.buffersByPath[props.activeRelativePath];
    if (buffer) {
      return;
    }
    void loadFile(props.activeRelativePath);
  }, [editorState.buffersByPath, loadFile, props.activeRelativePath]);

  useEffect(() => {
    if (lspStatus?.state !== "running") {
      return;
    }

    const api = readNativeApi();
    if (!api) {
      return;
    }

    const nextEligiblePaths = new Set<string>();
    for (const relativePath of editorState.openFilePaths) {
      const buffer = editorState.buffersByPath[relativePath];
      if (!buffer || buffer.status !== "ready" || buffer.binary || buffer.tooLarge) {
        continue;
      }

      nextEligiblePaths.add(relativePath);
      if (lspOpenedPathsRef.current.has(relativePath)) {
        continue;
      }

      const contents = buffer.contents;
      void api.projects
        .syncLspDocument({
          cwd: workspaceRoot,
          relativePath,
          event: "open",
          contents,
        })
        .then((result) => {
          if (!result.accepted) {
            return;
          }
          lspOpenedPathsRef.current.add(relativePath);
          lspSyncedContentsRef.current.set(relativePath, contents);
          if (props.activeRelativePath === relativePath) {
            void activeFileDiagnosticsQuery.refetch();
          }
        })
        .catch(() => {
          // Ignore sync failures and keep compiler diagnostics as the fallback.
        });
    }

    for (const relativePath of lspOpenedPathsRef.current) {
      if (nextEligiblePaths.has(relativePath)) {
        continue;
      }
      lspOpenedPathsRef.current.delete(relativePath);
      lspSyncedContentsRef.current.delete(relativePath);
    }
  }, [
    activeFileDiagnosticsQuery,
    editorState.buffersByPath,
    editorState.openFilePaths,
    lspStatus?.state,
    props.activeRelativePath,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (
      lspStatus?.state !== "running" ||
      !activeRelativePath ||
      !activeBuffer ||
      activeBuffer.status !== "ready" ||
      activeBuffer.binary ||
      activeBuffer.tooLarge ||
      !lspOpenedPathsRef.current.has(activeRelativePath)
    ) {
      return;
    }

    if (lspSyncedContentsRef.current.get(activeRelativePath) === activeBuffer.contents) {
      return;
    }

    const api = readNativeApi();
    if (!api) {
      return;
    }

    const nextContents = activeBuffer.contents;
    const timeoutId = window.setTimeout(() => {
      void api.projects
        .syncLspDocument({
          cwd: workspaceRoot,
          relativePath: activeRelativePath,
          event: "change",
          contents: nextContents,
        })
        .then((result) => {
          if (!result.accepted) {
            return;
          }
          lspSyncedContentsRef.current.set(activeRelativePath, nextContents);
          void activeFileDiagnosticsQuery.refetch();
        })
        .catch(() => {
          // Ignore sync failures and keep compiler diagnostics as the fallback.
        });
    }, 450);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeBuffer,
    activeFileDiagnosticsQuery,
    activeRelativePath,
    lspStatus?.state,
    workspaceRoot,
  ]);

  const handleOpenFile = useCallback(
    (relativePath: string) => {
      openFile(threadId, relativePath);
      ensureDirectoriesExpanded(threadId, directoryAncestorsOf(relativePath));
      onSelectWorkspaceTab(buildFileWorkspaceTabId(relativePath));
    },
    [ensureDirectoriesExpanded, onSelectWorkspaceTab, openFile, threadId],
  );

  const handleSaveFile = useCallback(
    async (relativePath: string) => {
      const buffer = editorState.buffersByPath[relativePath];
      if (!buffer || buffer.status === "saving" || buffer.binary || buffer.tooLarge) {
        return;
      }

      setBufferState(props.threadId, relativePath, (current) => ({
        ...(current ?? buffer),
        status: "saving",
        error: null,
      }));

      try {
        const api = readNativeApi();
        if (!api) {
          throw new Error("Native API not found.");
        }
        const result = await api.projects.writeFile({
          cwd: props.workspaceRoot,
          relativePath,
          contents: buffer.contents,
        });
        if (lspStatus?.state === "running") {
          const syncResult = await api.projects.syncLspDocument({
            cwd: props.workspaceRoot,
            relativePath,
            event: "save",
            contents: buffer.contents,
          });
          if (syncResult.accepted) {
            lspOpenedPathsRef.current.add(relativePath);
            lspSyncedContentsRef.current.set(relativePath, buffer.contents);
          }
        }
        markBufferSaved(props.threadId, relativePath, {
          contents: buffer.contents,
          mtimeMs: result.mtimeMs,
        });
        await Promise.all([
          workspaceDiagnosticsQuery.refetch(),
          activeFileDiagnosticsQuery.refetch(),
        ]);
      } catch (error) {
        setBufferState(props.threadId, relativePath, (current) => ({
          ...(current ?? buffer),
          status: "error",
          error: error instanceof Error ? error.message : "Unable to save file.",
        }));
      }
    },
    [
      activeFileDiagnosticsQuery,
      editorState.buffersByPath,
      lspStatus?.state,
      markBufferSaved,
      props.threadId,
      props.workspaceRoot,
      setBufferState,
      workspaceDiagnosticsQuery,
    ],
  );

  const handleLoadOrRestartLsp = useCallback(async () => {
    const api = readNativeApi();
    if (!api) {
      return;
    }

    setLspActionPending(true);
    try {
      if (lspStatus?.state === "running") {
        await api.projects.stopLsp({
          cwd: workspaceRoot,
        });
        lspOpenedPathsRef.current.clear();
        lspSyncedContentsRef.current.clear();
      }

      await api.projects.startLsp({
        cwd: workspaceRoot,
      });
      await queryClient.invalidateQueries({
        queryKey: projectQueryKeys.lspStatus(workspaceRoot),
      });
    } finally {
      setLspActionPending(false);
      void lspStatusQuery.refetch();
      void workspaceDiagnosticsQuery.refetch();
      void activeFileDiagnosticsQuery.refetch();
    }
  }, [
    activeFileDiagnosticsQuery,
    lspStatus?.state,
    lspStatusQuery,
    queryClient,
    workspaceDiagnosticsQuery,
    workspaceRoot,
  ]);

  const searchResults = searchEntriesQuery.data?.entries ?? [];
  const openEditors = editorState.openFilePaths.map((relativePath) => ({
    relativePath,
    title: basenameOfPath(relativePath),
    dirty: isBufferDirty(editorState.buffersByPath[relativePath]),
  }));

  return (
    <div className="h-full flex overflow-hidden">
      {editorState.explorerOpen ? (
        <div className="flex min-h-0 w-56 shrink-0 flex-col border-r border-border/60 bg-muted/[0.16]">
          <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1">
            <SearchIcon className="size-3 shrink-0 text-muted-foreground/50" />
            <input
              value={explorerQuery}
              onChange={(event) => setExplorerQuery(event.target.value)}
              placeholder="Search files…"
              className="h-5 w-full min-w-0 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/40"
            />
            {explorerQuery.length > 0 ? (
              <button
                type="button"
                className="shrink-0 rounded-sm p-0.5 text-muted-foreground/50 hover:text-foreground"
                onClick={() => setExplorerQuery("")}
              >
                <XIcon className="size-2.5" />
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
            {openEditors.length > 0 ? (
              <div className="mb-1.5">
                <div className="px-2 pb-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground/50">
                  Open
                </div>
                <div>
                  {openEditors.map((editor) => (
                    <button
                      key={editor.relativePath}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-[11px] leading-tight transition-colors",
                        props.activeRelativePath === editor.relativePath
                          ? "bg-primary/12 text-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                      onClick={() =>
                        props.onSelectWorkspaceTab(buildFileWorkspaceTabId(editor.relativePath))
                      }
                    >
                      <VscodeEntryIcon
                        pathValue={editor.relativePath}
                        kind="file"
                        theme={resolvedTheme}
                        className="size-3"
                      />
                      <span className="truncate">{editor.title}</span>
                      {editor.dirty ? (
                        <span className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {explorerQuery.trim().length > 0 ? (
              <div>
                {searchResults.map((entry) => (
                  <button
                    key={`${entry.kind}:${entry.path}`}
                    type="button"
                    className="flex w-full items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-[11px] leading-tight text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                    onClick={() => {
                      if (entry.kind === "directory") {
                        ensureDirectoriesExpanded(props.threadId, [entry.path]);
                        setExplorerQuery("");
                        return;
                      }
                      handleOpenFile(entry.path);
                    }}
                  >
                    <VscodeEntryIcon
                      pathValue={entry.path}
                      kind={entry.kind}
                      theme={resolvedTheme}
                      className="size-3"
                    />
                    <span className="truncate">{basenameOfPath(entry.path)}</span>
                    {entry.parentPath ? (
                      <span className="ml-auto truncate text-[9px] text-muted-foreground/50">
                        {entry.parentPath}
                      </span>
                    ) : null}
                  </button>
                ))}
                {searchEntriesQuery.isFetching ? (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground/70">Searching…</div>
                ) : null}
              </div>
            ) : (
              <div>
                {(directoryEntriesByPath.get("") ?? []).map((entry) => (
                  <ExplorerTreeNode
                    key={entry.path}
                    entry={entry}
                    activeRelativePath={props.activeRelativePath}
                    directoryEntriesByPath={directoryEntriesByPath}
                    expandedDirectoryPaths={expandedDirectoryPaths}
                    loadingDirectoryPaths={loadingDirectoryPaths}
                    resolvedTheme={resolvedTheme}
                    onToggleDirectory={(relativePath) =>
                      toggleDirectoryExpanded(props.threadId, relativePath)
                    }
                    onOpenFile={handleOpenFile}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border/60 bg-background px-2 py-1">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-[12px] font-medium text-foreground">
              {props.activeRelativePath ?? "No file open"}
            </span>
            {props.activeRelativePath && activeBuffer ? (
              <span className="shrink-0 text-[10px] text-muted-foreground/60">
                {activeBuffer.binary
                  ? "binary"
                  : activeBuffer.tooLarge
                    ? "too large"
                    : isBufferDirty(activeBuffer)
                      ? "modified"
                      : ""}
              </span>
            ) : null}
            {totalDiagnosticsCount > 0 ? (
              <span className="shrink-0 text-[10px] text-muted-foreground/60">
                {totalDiagnosticsCount} problem{totalDiagnosticsCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {activeRelativePath ? (
              <span className="shrink-0 text-[10px] text-muted-foreground/60">
                {activeFileDiagnosticsCount} file problem
                {activeFileDiagnosticsCount === 1 ? "" : "s"}
              </span>
            ) : null}
            <span className="shrink-0 text-[10px] text-muted-foreground/60">{lspStatusText}</span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className={cn(
                "inline-flex h-5 items-center rounded-sm px-1.5 text-[10px] font-medium transition-colors",
                lspStatus?.state === "unavailable"
                  ? "cursor-not-allowed text-muted-foreground/35"
                  : lspStatus?.state === "running"
                    ? "bg-primary/12 text-foreground hover:bg-primary/16"
                    : "text-muted-foreground/70 hover:bg-accent/50 hover:text-foreground",
              )}
              onClick={() => void handleLoadOrRestartLsp()}
              disabled={lspActionPending || lspStatus?.state === "unavailable"}
            >
              {lspActionPending
                ? "Loading LSP..."
                : lspStatus?.state === "running"
                  ? "Restart LSP"
                  : "Load LSP"}
            </button>
            {!editorState.explorerOpen ? (
              <button
                type="button"
                className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground/50 transition-colors hover:text-foreground"
                onClick={() => setExplorerOpen(props.threadId, true)}
              >
                <FolderTreeIcon className="size-3" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
          {!props.activeRelativePath ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="text-center text-[12px] text-muted-foreground/60">
                <FolderTreeIcon className="mx-auto mb-2 size-5 text-muted-foreground/40" />
                Open a file to start editing
              </div>
            </div>
          ) : !activeBuffer || activeBuffer.status === "loading" ? (
            <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground/60">
              Loading…
            </div>
          ) : activeBuffer.status === "error" ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="text-center text-[12px]">
                <AlertCircleIcon className="mx-auto mb-2 size-5 text-rose-500/60" />
                <div className="font-medium text-foreground">Unable to open file</div>
                <p className="mt-0.5 text-muted-foreground/70">{activeBuffer.error}</p>
              </div>
            </div>
          ) : activeBuffer.binary || activeBuffer.tooLarge ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="text-center text-[12px]">
                <FileSearchIcon className="mx-auto mb-2 size-5 text-muted-foreground/40" />
                <div className="font-medium text-foreground">
                  {activeBuffer.binary ? "Binary file" : "File too large"}
                </div>
                <p className="mt-0.5 text-muted-foreground/70">
                  {activeBuffer.binary
                    ? "Open in an external editor."
                    : `Max ${Math.round(activeBuffer.maxBytes / 1024)} KB.`}
                </p>
                <div className="mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      const api = readNativeApi();
                      if (!api) {
                        return;
                      }
                      if (!props.activeRelativePath) {
                        return;
                      }
                      await openInPreferredEditor(
                        api,
                        absoluteFilePath(props.workspaceRoot, props.activeRelativePath),
                      );
                    }}
                  >
                    Open in external editor
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <WorkspaceCodeEditor
              relativePath={props.activeRelativePath ?? ""}
              value={activeBuffer.contents}
              diagnostics={activeDiagnostics}
              resolvedTheme={resolvedTheme}
              vimMode={editorState.vimMode}
              autoFocus
              onChange={(nextValue) => {
                if (!props.activeRelativePath) {
                  return;
                }
                setBufferContents(props.threadId, props.activeRelativePath, nextValue);
              }}
              onSave={() => {
                if (!props.activeRelativePath) {
                  return;
                }
                void handleSaveFile(props.activeRelativePath);
              }}
            />
          )}
        </div>

        {editorState.problemsOpen ? (
          <div className="shrink-0 border-t border-border/60 bg-muted/[0.12]">
            <div className="max-h-40 overflow-y-auto px-1 py-1">
              {(workspaceDiagnosticsQuery.data?.diagnostics.length ?? 0) === 0 ? (
                <div className="px-2 py-2 text-[11px] text-muted-foreground/60">
                  No problems found.
                </div>
              ) : (
                <div>
                  {(workspaceDiagnosticsQuery.data?.diagnostics ?? []).map((diagnostic) => (
                    <button
                      key={`${diagnostic.relativePath}:${diagnostic.startLine}:${diagnostic.startColumn}:${diagnostic.code ?? diagnostic.message}`}
                      type="button"
                      className={cn(
                        "flex w-full items-start gap-1.5 rounded-sm px-1.5 py-0.5 text-left transition-colors",
                        diagnostic.relativePath === props.activeRelativePath
                          ? "bg-primary/8"
                          : "hover:bg-accent/30",
                      )}
                      onClick={() => handleOpenFile(diagnostic.relativePath)}
                    >
                      <TriangleAlertIcon
                        className={cn(
                          "mt-px size-3 shrink-0",
                          diagnostic.severity === "warning"
                            ? "text-amber-500"
                            : diagnostic.severity === "info"
                              ? "text-sky-500"
                              : "text-rose-500",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[11px] text-foreground">
                          <span className="truncate font-medium">{diagnostic.relativePath}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground/60">
                            {diagnostic.startLine}:{diagnostic.startColumn}
                          </span>
                        </div>
                        <div className="text-[10px] leading-tight text-muted-foreground/80">
                          {diagnostic.message}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
