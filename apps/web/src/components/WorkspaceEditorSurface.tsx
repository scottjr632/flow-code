import type { ThreadId } from "@t3tools/contracts";
import type { SelectedLineRange } from "@pierre/diffs";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  FileSearchIcon,
  FolderTreeIcon,
  MessageSquareIcon,
  PanelRightCloseIcon,
  PanelRightIcon,
  SearchIcon,
} from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { openInPreferredEditor } from "../editorPreferences";
import {
  projectLspStatusQueryOptions,
  projectSearchEntriesQueryOptions,
  projectWorkspaceFileTreeQueryOptions,
} from "../lib/projectReactQuery";
import { type DiffCommentDraft } from "../lib/diffCommentContext";
import { cn, randomUUID } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import {
  DEFAULT_WORKSPACE_EXPLORER_WIDTH,
  isBufferDirty,
  useThreadWorkspaceEditorState,
  useWorkspaceEditorStore,
} from "../workspaceEditorStore";
import { buildFileWorkspaceTabId } from "../workspaceTabs";
import { useComposerDraftStore } from "../composerDraftStore";
import { formatReviewCommentSubmitShortcutLabel } from "./DiffPanel.logic";
import { FileTree, toFileTreeEntries } from "./FileTree";
import { Button } from "./ui/button";
import { Toggle, ToggleGroup } from "./ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import type {
  WorkspaceReviewFileViewerLineAnnotation,
  WorkspaceReviewFileViewerSelection,
} from "./WorkspaceReviewFileViewer";

const WorkspaceMonacoEditor = lazy(() =>
  import("./WorkspaceMonacoEditor").then((module) => ({
    default: module.WorkspaceMonacoEditor,
  })),
);
const WorkspaceReviewFileViewer = lazy(() =>
  import("./WorkspaceReviewFileViewer").then((module) => ({
    default: module.WorkspaceReviewFileViewer,
  })),
);

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
        resizeState.startWidth - (event.clientX - resizeState.startX),
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
      className="relative flex min-h-0 shrink-0 flex-col border-l border-border/60 bg-muted/[0.16]"
      style={{ width: `${width}px` }}
    >
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <div
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize border-l border-border/60 transition-colors hover:border-primary/50 active:border-primary"
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

interface WorkspaceFileCommentSelection {
  filePath: string;
  excerpt: string;
  lineEnd: number;
  lineStart: number;
  side: "lines";
}

function buildWorkspaceCommentSelection(
  filePath: string,
  contents: string,
  range: SelectedLineRange | null,
): WorkspaceFileCommentSelection | null {
  if (!range) {
    return null;
  }

  const lineStart = Math.max(1, Math.min(range.start, range.end));
  const lineEnd = Math.max(lineStart, Math.max(range.start, range.end));
  const lines = contents.replace(/\r\n/g, "\n").split("\n");
  const excerptLines: string[] = [];

  for (let lineNumber = lineStart; lineNumber <= lineEnd; lineNumber += 1) {
    excerptLines.push(`${lineNumber} | ${lines[lineNumber - 1] ?? ""}`);
  }

  const excerpt = excerptLines.join("\n").trim();
  if (excerpt.length === 0) {
    return null;
  }

  return {
    filePath,
    excerpt,
    lineEnd,
    lineStart,
    side: "lines",
  };
}

function selectedLineRangeForSelection(
  selection: WorkspaceFileCommentSelection | null,
): SelectedLineRange | null {
  if (!selection) {
    return null;
  }
  return {
    start: selection.lineStart,
    end: selection.lineEnd,
    side: "additions",
    endSide: "additions",
  };
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
  const [selectedReviewRange, setSelectedReviewRange] = useState<SelectedLineRange | null>(null);
  const lspOpenedPathsRef = useRef(new Set<string>());
  const lspSyncedContentsRef = useRef(new Map<string, string>());
  const editorState = useThreadWorkspaceEditorState(threadId);
  const openFile = useWorkspaceEditorStore((state) => state.openFile);
  const setBufferState = useWorkspaceEditorStore((state) => state.setBufferState);
  const setBufferContents = useWorkspaceEditorStore((state) => state.setBufferContents);
  const markBufferSaved = useWorkspaceEditorStore((state) => state.markBufferSaved);
  const setExplorerOpen = useWorkspaceEditorStore((state) => state.setExplorerOpen);
  const setExplorerWidth = useWorkspaceEditorStore((state) => state.setExplorerWidth);
  const setMode = useWorkspaceEditorStore((state) => state.setMode);
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
  const workspaceFilesQuery = useQuery(
    projectWorkspaceFileTreeQueryOptions({
      cwd: workspaceRoot,
      enabled: editorState.explorerOpen,
    }),
  );
  const searchEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: workspaceRoot,
      query: explorerQuery,
      enabled: editorState.explorerOpen && explorerQuery.trim().length > 0,
      limit: 120,
    }),
  );
  const lspStatusQuery = useQuery(
    projectLspStatusQueryOptions({
      cwd: workspaceRoot,
    }),
  );

  const explorerEntries = useMemo(
    () =>
      (explorerQuery.trim().length > 0
        ? searchEntriesQuery.data?.entries
        : workspaceFilesQuery.data?.entries
      )?.filter((entry) => entry.kind === "file") ?? [],
    [explorerQuery, searchEntriesQuery.data?.entries, workspaceFilesQuery.data?.entries],
  );
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
    setSelectedReviewRange(null);
  }, []);

  const openCommentComposer = useCallback(() => {
    if (!currentCommentTarget) {
      return;
    }
    setActiveCommentSelection(currentCommentTarget);
    setActiveCommentBody("");
    setSelectedReviewRange(selectedLineRangeForSelection(currentCommentTarget));
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

  const reviewLineAnnotations: WorkspaceReviewFileViewerLineAnnotation[] = useMemo(() => {
    const annotations: WorkspaceReviewFileViewerLineAnnotation[] = [];
    for (const comment of submittedCommentsForActiveFile) {
      annotations.push({
        side: "additions",
        lineNumber: comment.lineEnd,
        metadata: {
          kind: "draft-comment",
          comment,
          onRemove: () => removeComposerDiffComment(threadId, comment.id),
        },
      });
    }
    if (activeCommentSelection) {
      annotations.push({
        side: "additions",
        lineNumber: activeCommentSelection.lineEnd,
        metadata: {
          kind: "draft-form",
          selection: activeCommentSelection satisfies WorkspaceReviewFileViewerSelection,
          body: activeCommentBody,
          submitShortcutLabel: reviewCommentSubmitShortcutLabel,
          onBodyChange: setActiveCommentBody,
          onSubmit: addSelectedCommentToDraft,
          onCancel: clearCommentComposer,
        },
      });
    }
    return annotations;
  }, [
    activeCommentBody,
    activeCommentSelection,
    addSelectedCommentToDraft,
    clearCommentComposer,
    removeComposerDiffComment,
    reviewCommentSubmitShortcutLabel,
    submittedCommentsForActiveFile,
    threadId,
  ]);

  useEffect(() => {
    if (lspStatus?.state === "running") {
      return;
    }
    lspOpenedPathsRef.current.clear();
    lspSyncedContentsRef.current.clear();
  }, [lspStatus?.state]);

  useEffect(() => {
    setCurrentCommentTarget(null);
    setSelectedReviewRange(null);
    clearCommentComposer();
  }, [activeRelativePath, editorState.mode, clearCommentComposer]);

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
        })
        .catch(() => {
          // Ignore sync failures and keep compiler diagnostics as the fallback.
        });
    }, 450);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeBuffer, activeRelativePath, lspStatus?.state, workspaceRoot]);

  const handleOpenFile = useCallback(
    (relativePath: string) => {
      openFile(threadId, relativePath);
      onSelectWorkspaceTab(buildFileWorkspaceTabId(relativePath));
    },
    [onSelectWorkspaceTab, openFile, threadId],
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
      } catch (error) {
        setBufferState(props.threadId, relativePath, (current) => ({
          ...(current ?? buffer),
          status: "error",
          error: error instanceof Error ? error.message : "Unable to save file.",
        }));
      }
    },
    [
      editorState.buffersByPath,
      lspStatus?.state,
      markBufferSaved,
      props.threadId,
      props.workspaceRoot,
      setBufferState,
    ],
  );

  return (
    <div className="h-full flex overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border/60 bg-background px-3 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
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
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {activeBuffer && !activeBuffer.binary && !activeBuffer.tooLarge ? (
              <ToggleGroup
                aria-label="Workspace file mode"
                value={[editorState.mode]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "review" || next === "edit") {
                    setMode(props.threadId, next);
                  }
                }}
                variant="outline"
                size="xs"
                className="gap-0 p-0.5"
              >
                <Toggle value="review" aria-label="View file">
                  View
                </Toggle>
                <Toggle value="edit" aria-label="Edit file">
                  Edit
                </Toggle>
              </ToggleGroup>
            ) : null}
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
                <PanelRightCloseIcon className="size-4" />
              ) : (
                <PanelRightIcon className="size-4" />
              )}
            </button>
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
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground/60">
                  Loading…
                </div>
              }
            >
              {editorState.mode === "edit" ? (
                <WorkspaceMonacoEditor
                  relativePath={props.activeRelativePath}
                  value={activeBuffer.contents}
                  readOnly={false}
                  resolvedTheme={resolvedTheme}
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
              ) : (
                <WorkspaceReviewFileViewer
                  relativePath={props.activeRelativePath}
                  contents={activeBuffer.contents}
                  resolvedTheme={resolvedTheme}
                  selectedRange={selectedReviewRange}
                  lineAnnotations={reviewLineAnnotations}
                  onSelectedRangeChange={(range) => {
                    setSelectedReviewRange(range);
                    if (!props.activeRelativePath) {
                      setCurrentCommentTarget(null);
                      return;
                    }
                    setCurrentCommentTarget(
                      buildWorkspaceCommentSelection(
                        props.activeRelativePath,
                        activeBuffer.contents,
                        range,
                      ),
                    );
                    if (!range && activeCommentSelection) {
                      clearCommentComposer();
                    }
                  }}
                  onGutterUtilityClick={(range) => {
                    if (!props.activeRelativePath) {
                      return;
                    }
                    const selection = buildWorkspaceCommentSelection(
                      props.activeRelativePath,
                      activeBuffer.contents,
                      range,
                    );
                    if (!selection) {
                      return;
                    }
                    setCurrentCommentTarget(selection);
                    setActiveCommentSelection(selection);
                    setActiveCommentBody("");
                    setSelectedReviewRange(selectedLineRangeForSelection(selection));
                  }}
                />
              )}
            </Suspense>
          )}
        </div>
      </div>

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
                Clear
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1.5">
            {searchEntriesQuery.isFetching || workspaceFilesQuery.isFetching ? (
              <div className="px-2 py-1.5 text-[12px] text-muted-foreground/70">Loading…</div>
            ) : null}
            <FileTree
              entries={toFileTreeEntries(explorerEntries)}
              resolvedTheme={resolvedTheme}
              onSelectFile={handleOpenFile}
              selectedPath={props.activeRelativePath}
              textSize="compact"
              emptyLabel={
                explorerQuery.trim().length > 0
                  ? "No files match filter."
                  : "No files in this workspace."
              }
            />
          </div>
        </ResizableWorkspaceExplorerPanel>
      ) : null}
    </div>
  );
}
