import type { ProjectDiagnostic, ProjectEntry, ThreadId } from "@t3tools/contracts";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileSearchIcon,
  FolderTreeIcon,
  MessageSquareIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { openInPreferredEditor } from "../editorPreferences";
import { useSettings } from "../hooks/useSettings";
import {
  projectDiagnosticsQueryOptions,
  projectLspStatusQueryOptions,
  projectListDirectoryQueryOptions,
  projectSearchEntriesQueryOptions,
} from "../lib/projectReactQuery";
import { type DiffCommentDraft } from "../lib/diffCommentContext";
import { cn, randomUUID } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import {
  directoryAncestorsOf,
  DEFAULT_WORKSPACE_EXPLORER_WIDTH,
  isBufferDirty,
  useThreadWorkspaceEditorState,
  useWorkspaceEditorStore,
} from "../workspaceEditorStore";
import { buildFileWorkspaceTabId } from "../workspaceTabs";
import { basenameOfPath } from "../vscode-icons";
import { useComposerDraftStore } from "../composerDraftStore";
import { formatReviewCommentSubmitShortcutLabel } from "./DiffPanel.logic";
import { InlineCommentForm, InlinePendingComment } from "./InlineCommentWidgets";
import {
  WorkspaceCodeEditor,
  type InlineCommentAnnotation,
  type WorkspaceCodeCommentTarget,
} from "./WorkspaceCodeEditor";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

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
          "flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[12px] leading-snug transition-colors",
          isActive
            ? "bg-primary/12 text-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
        style={{ paddingLeft: `${10 + depth * 16}px` }}
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
            <ChevronDownIcon className="size-3.5 shrink-0" />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0" />
          )
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <VscodeEntryIcon
          pathValue={entry.path}
          kind={entry.kind}
          theme={resolvedTheme}
          className="size-4"
        />
        <span className="truncate">{basenameOfPath(entry.path)}</span>
        {isDirectory && loadingDirectoryPaths.has(entry.path) ? (
          <RefreshCwIcon className="ml-auto size-3.5 shrink-0 animate-spin text-muted-foreground/60" />
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

const WORKSPACE_EXPLORER_MIN_WIDTH = 200;
const WORKSPACE_EXPLORER_MAX_WIDTH = 520;

function clampWorkspaceExplorerWidth(width: number): number {
  return Math.min(
    Math.max(Math.round(width), WORKSPACE_EXPLORER_MIN_WIDTH),
    WORKSPACE_EXPLORER_MAX_WIDTH,
  );
}

interface ResizableWorkspaceExplorerPanelProps {
  children: React.ReactNode;
  width: number;
  onResize: (width: number) => void;
}

function ResizableWorkspaceExplorerPanel(props: ResizableWorkspaceExplorerPanelProps) {
  const { children, onResize, width } = props;
  const resizeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: width,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      const nextWidth = clampWorkspaceExplorerWidth(
        resizeState.startWidth + (event.clientX - resizeState.startX),
      );
      if (nextWidth !== width) {
        onResize(nextWidth);
      }
    },
    [onResize, width],
  );

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }
    resizeStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  return (
    <div
      className="relative flex min-h-0 shrink-0 flex-col border-r border-border/60 bg-muted/[0.16]"
      style={{ width: `${width}px` }}
    >
      <div className="min-h-0 flex-1">{children}</div>
      <div
        className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize border-r border-border/60 transition-colors hover:border-primary/50 active:border-primary"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      />
    </div>
  );
}

function absoluteFilePath(workspaceRoot: string, relativePath: string): string {
  return `${workspaceRoot.replace(/[\\/]+$/, "")}/${relativePath}`;
}

const EMPTY_DRAFT_DIFF_COMMENTS: ReadonlyArray<DiffCommentDraft> = [];

interface WorkspaceFileCommentSelection extends WorkspaceCodeCommentTarget {
  filePath: string;
  side: "lines";
}

export function WorkspaceProblemsPanel(props: {
  diagnostics: readonly ProjectDiagnostic[];
  activeRelativePath: string | null;
  open: boolean;
  onToggleOpen: () => void;
  onSelectDiagnostic: (relativePath: string) => void;
}) {
  const diagnosticsCount = props.diagnostics.length;

  return (
    <div className="shrink-0 border-t border-border/60 bg-muted/[0.12]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-accent/20"
        aria-expanded={props.open}
        aria-label={props.open ? "Collapse problems panel" : "Expand problems panel"}
        onClick={props.onToggleOpen}
      >
        {props.open ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        )}
        <span>Problems</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground/70">
          {diagnosticsCount} problem{diagnosticsCount === 1 ? "" : "s"}
        </span>
      </button>

      {props.open ? (
        <div className="max-h-48 overflow-y-auto px-1.5 py-1.5">
          {diagnosticsCount === 0 ? (
            <div className="px-2.5 py-2.5 text-[13px] text-muted-foreground/60">
              No problems found.
            </div>
          ) : (
            <div>
              {props.diagnostics.map((diagnostic) => (
                <button
                  key={`${diagnostic.relativePath}:${diagnostic.startLine}:${diagnostic.startColumn}:${diagnostic.code ?? diagnostic.message}`}
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-2 rounded-sm px-2 py-1 text-left transition-colors",
                    diagnostic.relativePath === props.activeRelativePath
                      ? "bg-primary/8"
                      : "hover:bg-accent/30",
                  )}
                  onClick={() => props.onSelectDiagnostic(diagnostic.relativePath)}
                >
                  <TriangleAlertIcon
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      diagnostic.severity === "warning"
                        ? "text-amber-500"
                        : diagnostic.severity === "info"
                          ? "text-sky-500"
                          : "text-rose-500",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[13px] text-foreground">
                      <span className="truncate font-medium">{diagnostic.relativePath}</span>
                      <span className="shrink-0 text-xs text-muted-foreground/60">
                        {diagnostic.startLine}:{diagnostic.startColumn}
                      </span>
                    </div>
                    <div className="text-xs leading-snug text-muted-foreground/80">
                      {diagnostic.message}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
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
  const [explorerQuery, setExplorerQuery] = useState("");
  const [currentCommentTarget, setCurrentCommentTarget] =
    useState<WorkspaceFileCommentSelection | null>(null);
  const [activeCommentSelection, setActiveCommentSelection] =
    useState<WorkspaceFileCommentSelection | null>(null);
  const [activeCommentBody, setActiveCommentBody] = useState("");
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
  const setExplorerWidth = useWorkspaceEditorStore((state) => state.setExplorerWidth);
  const setProblemsOpen = useWorkspaceEditorStore((state) => state.setProblemsOpen);
  const vimMode = useSettings((settings) => settings.vimMode);
  const addComposerDiffComment = useComposerDraftStore((state) => state.addDiffComment);
  const removeComposerDiffComment = useComposerDraftStore((state) => state.removeDiffComment);
  const submittedThreadDiffComments = useComposerDraftStore(
    (state) => state.draftsByThreadId[threadId]?.diffComments ?? EMPTY_DRAFT_DIFF_COMMENTS,
  );
  const reviewCommentSubmitShortcutLabel = useMemo(
    () => formatReviewCommentSubmitShortcutLabel(),
    [],
  );

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
  const submittedCommentsForActiveFile = useMemo(
    () =>
      activeRelativePath
        ? submittedThreadDiffComments.filter((comment) => comment.filePath === activeRelativePath)
        : EMPTY_DRAFT_DIFF_COMMENTS,
    [activeRelativePath, submittedThreadDiffComments],
  );
  const canCommentOnActiveFile = Boolean(
    activeRelativePath &&
    activeBuffer &&
    activeBuffer.status === "ready" &&
    !activeBuffer.binary &&
    !activeBuffer.tooLarge &&
    currentCommentTarget,
  );

  const clearCommentComposer = useCallback(() => {
    setActiveCommentSelection(null);
    setActiveCommentBody("");
  }, []);

  const openCommentComposer = useCallback(() => {
    if (!currentCommentTarget) {
      return;
    }
    setActiveCommentSelection(currentCommentTarget);
    setActiveCommentBody("");
  }, [currentCommentTarget]);

  const addSelectedCommentToDraft = useCallback(() => {
    if (!activeCommentSelection) {
      return;
    }
    const body = activeCommentBody.trim();
    if (body.length === 0) {
      return;
    }

    addComposerDiffComment(threadId, {
      id: randomUUID(),
      threadId,
      filePath: activeCommentSelection.filePath,
      lineStart: activeCommentSelection.lineStart,
      lineEnd: activeCommentSelection.lineEnd,
      side: "lines",
      body,
      excerpt: activeCommentSelection.excerpt,
      createdAt: new Date().toISOString(),
    } satisfies DiffCommentDraft);
    clearCommentComposer();
  }, [
    activeCommentBody,
    activeCommentSelection,
    addComposerDiffComment,
    clearCommentComposer,
    threadId,
  ]);

  // Build inline comment annotations for the CodeMirror editor.
  const inlineComments: InlineCommentAnnotation[] = useMemo(() => {
    const annotations: InlineCommentAnnotation[] = [];
    for (const comment of submittedCommentsForActiveFile) {
      annotations.push({
        kind: "draft-comment",
        id: comment.id,
        lineEnd: comment.lineEnd,
        lineStart: comment.lineStart,
      });
    }
    if (activeCommentSelection) {
      annotations.push({
        kind: "draft-form",
        id: "active-comment-form",
        lineEnd: activeCommentSelection.lineEnd,
        lineStart: activeCommentSelection.lineStart,
      });
    }
    return annotations;
  }, [activeCommentSelection, submittedCommentsForActiveFile]);

  const renderInlineComment = useCallback(
    (annotation: InlineCommentAnnotation) => {
      if (annotation.kind === "draft-form" && activeCommentSelection) {
        return (
          <InlineCommentForm
            filePath={activeCommentSelection.filePath}
            lineStart={activeCommentSelection.lineStart}
            lineEnd={activeCommentSelection.lineEnd}
            body={activeCommentBody}
            submitShortcutLabel={reviewCommentSubmitShortcutLabel}
            onBodyChange={setActiveCommentBody}
            onSubmit={addSelectedCommentToDraft}
            onCancel={clearCommentComposer}
          />
        );
      }
      if (annotation.kind === "draft-comment") {
        const comment = submittedCommentsForActiveFile.find((c) => c.id === annotation.id);
        if (!comment) {
          return null;
        }
        return (
          <InlinePendingComment
            comment={comment}
            onRemove={() => removeComposerDiffComment(threadId, comment.id)}
          />
        );
      }
      return null;
    },
    [
      activeCommentBody,
      activeCommentSelection,
      addSelectedCommentToDraft,
      clearCommentComposer,
      removeComposerDiffComment,
      reviewCommentSubmitShortcutLabel,
      submittedCommentsForActiveFile,
      threadId,
    ],
  );

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

  useEffect(() => {
    setCurrentCommentTarget(null);
    clearCommentComposer();
  }, [activeRelativePath, clearCommentComposer]);

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

  const searchResults = searchEntriesQuery.data?.entries ?? [];
  return (
    <div className="h-full flex overflow-hidden">
      {editorState.explorerOpen ? (
        <ResizableWorkspaceExplorerPanel
          width={clampWorkspaceExplorerWidth(
            editorState.explorerWidth || DEFAULT_WORKSPACE_EXPLORER_WIDTH,
          )}
          onResize={(nextWidth) => setExplorerWidth(threadId, nextWidth)}
        >
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
            <input
              value={explorerQuery}
              onChange={(event) => setExplorerQuery(event.target.value)}
              placeholder="Search files…"
              className="h-6 w-full min-w-0 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40"
            />
            {explorerQuery.length > 0 ? (
              <button
                type="button"
                className="shrink-0 rounded-sm p-0.5 text-muted-foreground/50 hover:text-foreground"
                onClick={() => setExplorerQuery("")}
              >
                <XIcon className="size-3" />
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1.5">
            {explorerQuery.trim().length > 0 ? (
              <div>
                {searchResults.map((entry) => (
                  <button
                    key={`${entry.kind}:${entry.path}`}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[12px] leading-snug text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
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
                      className="size-4"
                    />
                    <span className="truncate">{basenameOfPath(entry.path)}</span>
                    {entry.parentPath ? (
                      <span className="ml-auto truncate text-[11px] text-muted-foreground/50">
                        {entry.parentPath}
                      </span>
                    ) : null}
                  </button>
                ))}
                {searchEntriesQuery.isFetching ? (
                  <div className="px-2 py-1.5 text-[12px] text-muted-foreground/70">Searching…</div>
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
        </ResizableWorkspaceExplorerPanel>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border/60 bg-background px-3 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <button
              type="button"
              className={cn(
                "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm transition-colors",
                editorState.explorerOpen
                  ? "text-foreground hover:bg-accent/50"
                  : "text-muted-foreground/50 hover:text-foreground",
              )}
              onClick={() => setExplorerOpen(props.threadId, !editorState.explorerOpen)}
              aria-label={
                editorState.explorerOpen ? "Collapse file explorer" : "Expand file explorer"
              }
              title={editorState.explorerOpen ? "Collapse file explorer" : "Expand file explorer"}
            >
              {editorState.explorerOpen ? (
                <PanelLeftCloseIcon className="size-4" />
              ) : (
                <PanelLeftIcon className="size-4" />
              )}
            </button>
            <span className="truncate text-sm font-medium text-foreground">
              {props.activeRelativePath ?? "No file open"}
            </span>
            {props.activeRelativePath && activeBuffer ? (
              <span className="shrink-0 text-xs text-muted-foreground/60">
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
              <span className="shrink-0 text-xs text-muted-foreground/60">
                {totalDiagnosticsCount} problem{totalDiagnosticsCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {activeRelativePath && activeFileDiagnosticsCount > 0 ? (
              <span className="shrink-0 text-xs text-muted-foreground/60">
                {activeFileDiagnosticsCount} file problem
                {activeFileDiagnosticsCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "relative inline-flex size-6 shrink-0 items-center justify-center rounded-sm transition-colors",
                      activeCommentSelection
                        ? "cursor-pointer text-primary hover:bg-primary/10"
                        : canCommentOnActiveFile
                          ? "cursor-pointer text-muted-foreground/70 hover:text-foreground hover:bg-accent/50"
                          : "text-muted-foreground/30 cursor-not-allowed",
                    )}
                    disabled={!canCommentOnActiveFile}
                    onClick={openCommentComposer}
                    aria-label="Add comment at selection"
                  >
                    <MessageSquareIcon className="size-4" />
                    {submittedCommentsForActiveFile.length > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-medium leading-none text-primary-foreground">
                        {submittedCommentsForActiveFile.length}
                      </span>
                    ) : null}
                  </button>
                }
              />
              <TooltipPopup side="bottom">
                Add an inline comment on the selected lines to include with your next message
              </TooltipPopup>
            </Tooltip>
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
          {!props.activeRelativePath ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="text-center text-sm text-muted-foreground/60">
                <FolderTreeIcon className="mx-auto mb-2.5 size-6 text-muted-foreground/40" />
                Open a file to start editing
              </div>
            </div>
          ) : !activeBuffer || activeBuffer.status === "loading" ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground/60">
              Loading…
            </div>
          ) : activeBuffer.status === "error" ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="text-center text-sm">
                <AlertCircleIcon className="mx-auto mb-2.5 size-6 text-rose-500/60" />
                <div className="font-medium text-foreground">Unable to open file</div>
                <p className="mt-1 text-muted-foreground/70">{activeBuffer.error}</p>
              </div>
            </div>
          ) : activeBuffer.binary || activeBuffer.tooLarge ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="text-center text-sm">
                <FileSearchIcon className="mx-auto mb-2.5 size-6 text-muted-foreground/40" />
                <div className="font-medium text-foreground">
                  {activeBuffer.binary ? "Binary file" : "File too large"}
                </div>
                <p className="mt-1 text-muted-foreground/70">
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
              vimMode={vimMode}
              autoFocus
              inlineComments={inlineComments}
              renderInlineComment={renderInlineComment}
              onCommentTargetChange={(target) => {
                if (!props.activeRelativePath || !target) {
                  setCurrentCommentTarget(null);
                  return;
                }

                setCurrentCommentTarget({
                  filePath: props.activeRelativePath,
                  lineStart: target.lineStart,
                  lineEnd: target.lineEnd,
                  side: "lines",
                  excerpt: target.excerpt,
                });
              }}
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

        <WorkspaceProblemsPanel
          diagnostics={workspaceDiagnosticsQuery.data?.diagnostics ?? []}
          activeRelativePath={props.activeRelativePath}
          open={editorState.problemsOpen}
          onToggleOpen={() => setProblemsOpen(props.threadId, !editorState.problemsOpen)}
          onSelectDiagnostic={handleOpenFile}
        />
      </div>
    </div>
  );
}
