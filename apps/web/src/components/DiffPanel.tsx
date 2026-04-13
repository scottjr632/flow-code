import { parsePatchFiles, type SelectedLineRange } from "@pierre/diffs";
import {
  FileDiff,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  Virtualizer,
} from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ThreadId, type TurnId } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns2Icon,
  PanelRightCloseIcon,
  PanelRightIcon,
  Rows3Icon,
  TextWrapIcon,
  XIcon,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openInPreferredEditor } from "../editorPreferences";
import { gitReviewDiffQueryOptions } from "~/lib/gitReactQuery";
import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import { cn } from "~/lib/utils";
import { readNativeApi } from "../nativeApi";
import { resolvePathLinkTarget } from "../terminal-links";
import {
  parseDiffRouteSearch,
  stripDiffSearchParams,
  type DiffSelection,
} from "../diffRouteSearch";
import { useTheme } from "../hooks/useTheme";
import { buildPatchCacheKey } from "../lib/diffRendering";
import { resolveDiffThemeName } from "../lib/diffRendering";
import { CANCEL_ACTIVE_DIFF_COMMENT_EVENT } from "../lib/diffCommentEvents";
import { buildReviewFileRenderKey, resolveReviewFilePath } from "../lib/reviewDiffFiles";
import { useHydratedFileDiffs } from "../hooks/useHydratedFileDiffs";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useStore } from "../store";
import { useSettings } from "../hooks/useSettings";
import { formatShortTimestamp } from "../timestampFormat";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  formatDiffCommentLabel,
  type DiffCommentDraft,
  type DiffCommentSide,
} from "../lib/diffCommentContext";
import { randomUUID } from "../lib/utils";
import {
  expandCollapsedFileKey,
  formatReviewCommentSubmitShortcutLabel,
  getDiffCommentComposerKey,
  matchesReviewCommentSubmitShortcut,
  resolveTurnChipLabel,
  toggleCollapsedFileKey,
} from "./DiffPanel.logic";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { ReviewFileTree } from "./ReviewFileTree";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";
import { Textarea } from "./ui/textarea";
import { ToggleGroup, Toggle } from "./ui/toggle-group";

type DiffRenderMode = "stacked" | "split";
type DiffThemeType = "light" | "dark";

const DIFF_PANEL_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--success));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, var(--success));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, var(--success));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, var(--success));

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--destructive));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, var(--destructive));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, var(--destructive));
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--background) 80%,
    var(--destructive)
  );

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`;

type RenderablePatch =
  | {
      kind: "files";
      files: FileDiffMetadata[];
    }
  | {
      kind: "raw";
      text: string;
      reason: string;
    };

function getRenderablePatch(
  patch: string | undefined,
  cacheScope = "diff-panel",
): RenderablePatch | null {
  if (!patch) return null;
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return null;

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    );
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
    if (files.length > 0) {
      return { kind: "files", files };
    }

    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

// ---------------------------------------------------------------------------
// Resizable file-tree sidebar panel
// ---------------------------------------------------------------------------

const FILE_TREE_MIN_WIDTH = 160;
const FILE_TREE_MAX_WIDTH = 480;
const FILE_TREE_DEFAULT_WIDTH = 224; // w-56

function clampFileTreeWidth(width: number): number {
  return Math.min(Math.max(Math.round(width), FILE_TREE_MIN_WIDTH), FILE_TREE_MAX_WIDTH);
}

interface ResizableFileTreePanelProps {
  children: React.ReactNode;
}

function ResizableFileTreePanel({ children }: ResizableFileTreePanelProps) {
  const [width, setWidth] = useState(FILE_TREE_DEFAULT_WIDTH);
  const widthRef = useRef(FILE_TREE_DEFAULT_WIDTH);
  const resizeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthRef.current,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    // Dragging left increases width (panel is on the right side)
    const nextWidth = clampFileTreeWidth(state.startWidth + (state.startX - event.clientX));
    if (nextWidth !== widthRef.current) {
      widthRef.current = nextWidth;
      setWidth(nextWidth);
    }
  }, []);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    resizeStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  return (
    <aside className="relative hidden h-full shrink-0 lg:flex" style={{ width: `${width}px` }}>
      {/* Drag handle */}
      <div
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize border-l border-border/60 transition-colors hover:border-primary/50 active:border-primary"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </aside>
  );
}

interface DraftDiffCommentSelection {
  fileKey: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  side: DiffCommentSide;
  excerpt: string;
}

interface InlineDiffCommentAnnotationMetadata {
  kind: "draft-form";
  selection: DraftDiffCommentSelection;
}

interface PendingDiffCommentAnnotationMetadata {
  kind: "draft-comment";
  comment: DiffCommentDraft;
}

type DiffCommentAnnotationMetadata =
  | InlineDiffCommentAnnotationMetadata
  | PendingDiffCommentAnnotationMetadata;

const EMPTY_DRAFT_DIFF_COMMENTS: ReadonlyArray<DiffCommentDraft> = [];

function formatCommentSelectionSummary(selection: {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  side: DiffCommentSide;
}): string {
  return formatDiffCommentLabel(selection);
}

function toDiffAnnotationSide(side: DiffCommentSide): "additions" | "deletions" {
  return side === "deletions" ? "deletions" : "additions";
}

function buildDiffLineExcerpt(
  fileDiff: FileDiffMetadata,
  side: DiffCommentSide,
  lineStart: number,
  lineEnd: number,
): string {
  const lineLookup = new Map<number, string>();

  for (const hunk of fileDiff.hunks) {
    for (const segment of hunk.hunkContent) {
      if (segment.type === "context") {
        const contextStart = side === "deletions" ? hunk.deletionStart : hunk.additionStart;
        const segmentOffset =
          (side === "deletions" ? segment.deletionLineIndex : segment.additionLineIndex) -
          (side === "deletions" ? hunk.deletionLineIndex : hunk.additionLineIndex);
        const segmentStartLine = contextStart + segmentOffset;
        const sourceLines = side === "deletions" ? fileDiff.deletionLines : fileDiff.additionLines;
        const sourceIndex =
          side === "deletions" ? segment.deletionLineIndex : segment.additionLineIndex;
        for (let index = 0; index < segment.lines; index += 1) {
          lineLookup.set(segmentStartLine + index, sourceLines[sourceIndex + index] ?? "");
        }
        continue;
      }

      const sourceCount = side === "deletions" ? segment.deletions : segment.additions;
      if (sourceCount === 0) {
        continue;
      }
      const sourceStartLine = side === "deletions" ? hunk.deletionStart : hunk.additionStart;
      const sourceIndex =
        side === "deletions" ? segment.deletionLineIndex : segment.additionLineIndex;
      const hunkBaseIndex = side === "deletions" ? hunk.deletionLineIndex : hunk.additionLineIndex;
      const segmentStartLine = sourceStartLine + (sourceIndex - hunkBaseIndex);
      const sourceLines = side === "deletions" ? fileDiff.deletionLines : fileDiff.additionLines;
      for (let index = 0; index < sourceCount; index += 1) {
        lineLookup.set(segmentStartLine + index, sourceLines[sourceIndex + index] ?? "");
      }
    }
  }

  const excerptLines: string[] = [];
  for (let lineNumber = lineStart; lineNumber <= lineEnd; lineNumber += 1) {
    if (!lineLookup.has(lineNumber)) {
      continue;
    }
    excerptLines.push(`${lineNumber} | ${lineLookup.get(lineNumber) ?? ""}`);
  }
  return excerptLines.join("\n");
}

function buildCommentSelectionFromRange(
  fileDiff: FileDiffMetadata,
  fileKey: string,
  range: SelectedLineRange,
): DraftDiffCommentSelection | null {
  const side = (range.side ?? range.endSide ?? "additions") as DiffCommentSide;
  const lineStart = Math.max(1, Math.min(range.start, range.end));
  const lineEnd = Math.max(lineStart, Math.max(range.start, range.end));
  const excerpt = buildDiffLineExcerpt(fileDiff, side, lineStart, lineEnd).trim();
  if (excerpt.length === 0) {
    return null;
  }
  return {
    fileKey,
    filePath: resolveReviewFilePath(fileDiff),
    lineStart,
    lineEnd,
    side,
    excerpt,
  };
}

interface DiffPanelProps {
  mode?: DiffPanelMode;
}

export { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanel({ mode = "inline" }: DiffPanelProps) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const settings = useSettings();
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>("stacked");
  const [diffWordWrap, setDiffWordWrap] = useState(settings.diffWordWrap);
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const [collapsedFileKeys, setCollapsedFileKeys] = useState<ReadonlySet<string>>(new Set());
  const [selectedRangesByFileKey, setSelectedRangesByFileKey] = useState<
    Record<string, SelectedLineRange | null>
  >({});
  const [activeCommentSelection, setActiveCommentSelection] =
    useState<DraftDiffCommentSelection | null>(null);
  const [activeCommentBody, setActiveCommentBody] = useState("");
  const reviewCommentSubmitShortcutLabel = useMemo(
    () => formatReviewCommentSubmitShortcutLabel(),
    [],
  );
  const patchViewportRef = useRef<HTMLDivElement>(null);
  const turnStripRef = useRef<HTMLDivElement>(null);
  const previousDiffOpenRef = useRef(false);
  const [canScrollTurnStripLeft, setCanScrollTurnStripLeft] = useState(false);
  const [canScrollTurnStripRight, setCanScrollTurnStripRight] = useState(false);
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const diffSearch = useSearch({ strict: false, select: (search) => parseDiffRouteSearch(search) });
  const diffOpen = diffSearch.diff === "1";
  const activeThreadId = routeThreadId;
  const addComposerDiffComment = useComposerDraftStore((store) => store.addDiffComment);
  const removeComposerDiffComment = useComposerDraftStore((store) => store.removeDiffComment);
  const submittedThreadDiffComments = useComposerDraftStore((store) =>
    activeThreadId
      ? (store.draftsByThreadId[activeThreadId]?.diffComments ?? EMPTY_DRAFT_DIFF_COMMENTS)
      : EMPTY_DRAFT_DIFF_COMMENTS,
  );
  const activeThread = useStore((store) =>
    activeThreadId ? store.threads.find((thread) => thread.id === activeThreadId) : undefined,
  );
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeProjectId ? store.projects.find((project) => project.id === activeProjectId) : undefined,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );
  const latestTurnId = orderedTurnDiffSummaries[0]?.turnId ?? null;

  const selectedDiffSelection = diffSearch.diffSelection ?? null;
  const selectedTurnId = diffSearch.diffTurnId ?? null;
  const selectedFilePath = diffSearch.diffFilePath ?? null;
  const selectedTurn =
    selectedDiffSelection !== null || selectedTurnId === null
      ? undefined
      : (orderedTurnDiffSummaries.find((summary) => summary.turnId === selectedTurnId) ??
        orderedTurnDiffSummaries[0]);
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const conversationCheckpointTurnCount = useMemo(() => {
    const turnCounts = orderedTurnDiffSummaries
      .map(
        (summary) =>
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId],
      )
      .filter((value): value is number => typeof value === "number");
    if (turnCounts.length === 0) {
      return undefined;
    }
    const latest = Math.max(...turnCounts);
    return latest > 0 ? latest : undefined;
  }, [inferredCheckpointTurnCountByTurnId, orderedTurnDiffSummaries]);
  const conversationCheckpointRange = useMemo(
    () =>
      !selectedTurn && typeof conversationCheckpointTurnCount === "number"
        ? {
            fromTurnCount: 0,
            toTurnCount: conversationCheckpointTurnCount,
          }
        : null,
    [conversationCheckpointTurnCount, selectedTurn],
  );
  const activeCheckpointRange = selectedTurn
    ? selectedCheckpointRange
    : conversationCheckpointRange;
  const conversationCacheScope = useMemo(() => {
    if (selectedTurn || selectedDiffSelection !== null || orderedTurnDiffSummaries.length === 0) {
      return null;
    }
    return `conversation:${orderedTurnDiffSummaries.map((summary) => summary.turnId).join(",")}`;
  }, [orderedTurnDiffSummaries, selectedDiffSelection, selectedTurn]);
  const activeCheckpointDiffQuery = useQuery(
    checkpointDiffQueryOptions({
      threadId: activeThreadId,
      fromTurnCount: activeCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: activeCheckpointRange?.toTurnCount ?? null,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : conversationCacheScope,
      enabled: selectedDiffSelection === null,
    }),
  );
  const reviewDiffQuery = useQuery(
    gitReviewDiffQueryOptions({
      cwd: activeCwd ?? null,
      selection: selectedDiffSelection,
      enabled: selectedDiffSelection !== null,
    }),
  );
  const selectedTurnCheckpointDiff = selectedTurn
    ? activeCheckpointDiffQuery.data?.diff
    : undefined;
  const conversationCheckpointDiff = selectedTurn
    ? undefined
    : activeCheckpointDiffQuery.data?.diff;
  const isLoadingCheckpointDiff = activeCheckpointDiffQuery.isLoading;
  const checkpointDiffError =
    activeCheckpointDiffQuery.error instanceof Error
      ? activeCheckpointDiffQuery.error.message
      : activeCheckpointDiffQuery.error
        ? "Failed to load checkpoint diff."
        : null;
  const reviewDiffError =
    reviewDiffQuery.error instanceof Error
      ? reviewDiffQuery.error.message
      : reviewDiffQuery.error
        ? "Failed to load git review diff."
        : null;

  const selectedPatch =
    selectedDiffSelection !== null
      ? reviewDiffQuery.data?.diff
      : selectedTurn
        ? selectedTurnCheckpointDiff
        : conversationCheckpointDiff;
  const activePatchError = selectedDiffSelection !== null ? reviewDiffError : checkpointDiffError;
  const isLoadingActivePatch =
    selectedDiffSelection !== null ? reviewDiffQuery.isLoading : isLoadingCheckpointDiff;
  const hasResolvedPatch = typeof selectedPatch === "string";
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;
  const renderablePatch = useMemo(
    () => getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`),
    [resolvedTheme, selectedPatch],
  );
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return renderablePatch.files.toSorted((left, right) =>
      resolveReviewFilePath(left).localeCompare(resolveReviewFilePath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);
  const hydratedFiles = useHydratedFileDiffs(renderableFiles, activeCwd);
  const fileKeyByPath = useMemo(
    () =>
      new Map(
        renderableFiles.map((fileDiff) => [
          resolveReviewFilePath(fileDiff),
          buildReviewFileRenderKey(fileDiff),
        ]),
      ),
    [renderableFiles],
  );
  const submittedDiffCommentsByFileKey = useMemo(() => {
    const commentsByFileKey = new Map<string, DiffCommentDraft[]>();
    for (const comment of submittedThreadDiffComments) {
      if (comment.side === "lines") {
        continue;
      }
      const fileKey = fileKeyByPath.get(comment.filePath);
      if (!fileKey) {
        continue;
      }
      const existingComments = commentsByFileKey.get(fileKey);
      if (existingComments) {
        existingComments.push(comment);
      } else {
        commentsByFileKey.set(fileKey, [comment]);
      }
    }
    return commentsByFileKey;
  }, [fileKeyByPath, submittedThreadDiffComments]);
  const activeCommentComposerKey = useMemo(
    () => getDiffCommentComposerKey(activeCommentSelection),
    [activeCommentSelection],
  );

  const focusActiveCommentTextarea = useCallback(
    (element: HTMLTextAreaElement | null) => {
      if (!element || !activeCommentComposerKey) {
        return;
      }

      window.requestAnimationFrame(() => {
        if (!element.isConnected) {
          return;
        }
        element.focus();
        const cursor = element.value.length;
        element.setSelectionRange(cursor, cursor);
      });
    },
    [activeCommentComposerKey],
  );

  useEffect(() => {
    if (diffOpen && !previousDiffOpenRef.current) {
      setDiffWordWrap(settings.diffWordWrap);
    }
    previousDiffOpenRef.current = diffOpen;
  }, [diffOpen, settings.diffWordWrap]);

  useEffect(() => {
    const selectedFileKey = selectedFilePath ? (fileKeyByPath.get(selectedFilePath) ?? null) : null;
    setCollapsedFileKeys((currentCollapsedFileKeys) =>
      expandCollapsedFileKey(currentCollapsedFileKeys, selectedFileKey),
    );
  }, [fileKeyByPath, selectedFilePath]);

  useEffect(() => {
    if (!selectedFilePath || !patchViewportRef.current) {
      return;
    }
    const target = Array.from(
      patchViewportRef.current.querySelectorAll<HTMLElement>("[data-diff-file-path]"),
    ).find((element) => element.dataset.diffFilePath === selectedFilePath);
    target?.scrollIntoView({ block: "nearest" });
  }, [selectedFilePath, renderableFiles]);

  const openDiffFileInEditor = useCallback(
    (filePath: string) => {
      const api = readNativeApi();
      if (!api) return;
      const targetPath = activeCwd ? resolvePathLinkTarget(filePath, activeCwd) : filePath;
      void openInPreferredEditor(api, targetPath).catch((error) => {
        console.warn("Failed to open diff file in editor.", error);
      });
    },
    [activeCwd],
  );

  const clearCommentComposer = useCallback(
    (fileKey?: string) => {
      const targetFileKey = fileKey ?? activeCommentSelection?.fileKey ?? null;
      if (targetFileKey) {
        setSelectedRangesByFileKey((currentRanges) => ({
          ...currentRanges,
          [targetFileKey]: null,
        }));
      }
      setActiveCommentSelection(null);
      setActiveCommentBody("");
    },
    [activeCommentSelection],
  );

  const openCommentComposer = useCallback((selection: DraftDiffCommentSelection | null) => {
    if (!selection) {
      return;
    }
    setActiveCommentSelection(selection);
    setActiveCommentBody("");
  }, []);

  const toggleFileCollapsed = useCallback(
    (fileKey: string) => {
      setCollapsedFileKeys((currentCollapsedFileKeys) =>
        toggleCollapsedFileKey(currentCollapsedFileKeys, fileKey),
      );
      setSelectedRangesByFileKey((currentRanges) => ({
        ...currentRanges,
        [fileKey]: null,
      }));
      if (activeCommentSelection?.fileKey === fileKey) {
        setActiveCommentSelection(null);
        setActiveCommentBody("");
      }
    },
    [activeCommentSelection?.fileKey],
  );

  const addSelectedCommentToDraft = useCallback(() => {
    if (!activeThreadId || !activeCommentSelection) {
      return;
    }
    const body = activeCommentBody.trim();
    if (body.length === 0) {
      return;
    }
    addComposerDiffComment(activeThreadId, {
      id: randomUUID(),
      threadId: activeThreadId,
      filePath: activeCommentSelection.filePath,
      lineStart: activeCommentSelection.lineStart,
      lineEnd: activeCommentSelection.lineEnd,
      side: activeCommentSelection.side,
      body,
      excerpt: activeCommentSelection.excerpt,
      createdAt: new Date().toISOString(),
    } satisfies DiffCommentDraft);
    clearCommentComposer(activeCommentSelection.fileKey);
  }, [
    activeCommentBody,
    activeCommentSelection,
    activeThreadId,
    addComposerDiffComment,
    clearCommentComposer,
  ]);

  useEffect(() => {
    setCollapsedFileKeys(new Set());
    setSelectedRangesByFileKey({});
    setActiveCommentSelection(null);
    setActiveCommentBody("");
  }, [selectedDiffSelection, selectedTurnId, selectedPatch]);

  useEffect(() => {
    if (!activeCommentSelection) {
      return;
    }

    const onCancelActiveDiffComment = (event: Event) => {
      event.preventDefault();
      clearCommentComposer();
    };

    window.addEventListener(CANCEL_ACTIVE_DIFF_COMMENT_EVENT, onCancelActiveDiffComment);
    return () =>
      window.removeEventListener(CANCEL_ACTIVE_DIFF_COMMENT_EVENT, onCancelActiveDiffComment);
  }, [activeCommentSelection, clearCommentComposer]);

  const selectReviewFile = useCallback(
    (filePath: string) => {
      if (!activeThread) return;
      void navigate({
        to: "/$threadId",
        params: { threadId: activeThread.id },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          if (selectedDiffSelection !== null) {
            return {
              ...rest,
              diff: "1",
              diffSelection: selectedDiffSelection,
              diffFilePath: filePath,
            };
          }
          if (selectedTurnId !== null) {
            return { ...rest, diff: "1", diffTurnId: selectedTurnId, diffFilePath: filePath };
          }
          return { ...rest, diff: "1", diffFilePath: filePath };
        },
      });
    },
    [activeThread, navigate, selectedDiffSelection, selectedTurnId],
  );

  const selectTurn = (turnId: TurnId) => {
    if (!activeThread) return;
    void navigate({
      to: "/$threadId",
      params: { threadId: activeThread.id },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1", diffTurnId: turnId };
      },
    });
  };
  const selectDiffSelection = (selection: DiffSelection) => {
    if (!activeThread) return;
    void navigate({
      to: "/$threadId",
      params: { threadId: activeThread.id },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1", diffSelection: selection };
      },
    });
  };
  const selectWholeConversation = () => {
    if (!activeThread) return;
    void navigate({
      to: "/$threadId",
      params: { threadId: activeThread.id },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  };
  const updateTurnStripScrollState = useCallback(() => {
    const element = turnStripRef.current;
    if (!element) {
      setCanScrollTurnStripLeft(false);
      setCanScrollTurnStripRight(false);
      return;
    }

    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    setCanScrollTurnStripLeft(element.scrollLeft > 4);
    setCanScrollTurnStripRight(element.scrollLeft < maxScrollLeft - 4);
  }, []);
  const scrollTurnStripBy = useCallback((offset: number) => {
    const element = turnStripRef.current;
    if (!element) return;
    element.scrollBy({ left: offset, behavior: "smooth" });
  }, []);
  const onTurnStripWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const element = turnStripRef.current;
    if (!element) return;
    if (element.scrollWidth <= element.clientWidth + 1) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    event.preventDefault();
    element.scrollBy({ left: event.deltaY, behavior: "auto" });
  }, []);

  useEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;

    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    const onScroll = () => updateTurnStripScrollState();

    element.addEventListener("scroll", onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => updateTurnStripScrollState());
    resizeObserver.observe(element);

    return () => {
      window.cancelAnimationFrame(frameId);
      element.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, [updateTurnStripScrollState]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [orderedTurnDiffSummaries, selectedTurnId, updateTurnStripScrollState]);

  useEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;

    const selectedChip = element.querySelector<HTMLElement>("[data-turn-chip-selected='true']");
    selectedChip?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedTurn?.turnId, selectedTurnId]);

  const headerRow = (
    <>
      <div className="relative min-w-0 flex-1 [-webkit-app-region:no-drag]">
        {canScrollTurnStripLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-8 z-10 w-7 bg-linear-to-r from-card to-transparent" />
        )}
        {canScrollTurnStripRight && (
          <div className="pointer-events-none absolute inset-y-0 right-8 z-10 w-7 bg-linear-to-l from-card to-transparent" />
        )}
        <button
          type="button"
          className={cn(
            "absolute left-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
            canScrollTurnStripLeft
              ? "border-border/70 hover:border-border hover:text-foreground"
              : "cursor-not-allowed border-border/40 text-muted-foreground/40",
          )}
          onClick={() => scrollTurnStripBy(-180)}
          disabled={!canScrollTurnStripLeft}
          aria-label="Scroll turn list left"
        >
          <ChevronLeftIcon className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(
            "absolute right-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
            canScrollTurnStripRight
              ? "border-border/70 hover:border-border hover:text-foreground"
              : "cursor-not-allowed border-border/40 text-muted-foreground/40",
          )}
          onClick={() => scrollTurnStripBy(180)}
          disabled={!canScrollTurnStripRight}
          aria-label="Scroll turn list right"
        >
          <ChevronRightIcon className="size-3.5" />
        </button>
        <div
          ref={turnStripRef}
          className="turn-chip-strip flex gap-1 overflow-x-auto px-8 py-0.5"
          onWheel={onTurnStripWheel}
        >
          <button
            type="button"
            className="shrink-0 rounded-md"
            onClick={() => selectDiffSelection("staged")}
            data-turn-chip-selected={selectedDiffSelection === "staged"}
          >
            <div
              className={cn(
                "rounded-md border px-2 py-1 text-left transition-colors",
                selectedDiffSelection === "staged"
                  ? "border-border bg-accent text-accent-foreground"
                  : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
              )}
            >
              <div className="text-[10px] leading-tight font-medium">Staged</div>
            </div>
          </button>
          <button
            type="button"
            className="shrink-0 rounded-md"
            onClick={() => selectDiffSelection("unstaged")}
            data-turn-chip-selected={selectedDiffSelection === "unstaged"}
          >
            <div
              className={cn(
                "rounded-md border px-2 py-1 text-left transition-colors",
                selectedDiffSelection === "unstaged"
                  ? "border-border bg-accent text-accent-foreground"
                  : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
              )}
            >
              <div className="text-[10px] leading-tight font-medium">Unstaged</div>
            </div>
          </button>
          <button
            type="button"
            className="shrink-0 rounded-md"
            onClick={selectWholeConversation}
            data-turn-chip-selected={selectedDiffSelection === null && selectedTurnId === null}
          >
            <div
              className={cn(
                "rounded-md border px-2 py-1 text-left transition-colors",
                selectedDiffSelection === null && selectedTurnId === null
                  ? "border-border bg-accent text-accent-foreground"
                  : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
              )}
            >
              <div className="text-[10px] leading-tight font-medium">All turns</div>
            </div>
          </button>
          {orderedTurnDiffSummaries.map((summary) => (
            <button
              key={summary.turnId}
              type="button"
              className="shrink-0 rounded-md"
              onClick={() => selectTurn(summary.turnId)}
              title={summary.turnId}
              data-turn-chip-selected={summary.turnId === selectedTurn?.turnId}
            >
              <div
                className={cn(
                  "rounded-md border px-2 py-1 text-left transition-colors",
                  summary.turnId === selectedTurn?.turnId
                    ? "border-border bg-accent text-accent-foreground"
                    : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
                )}
              >
                <div className="flex items-center gap-1">
                  <span className="text-[10px] leading-tight font-medium">
                    {resolveTurnChipLabel(
                      summary,
                      latestTurnId,
                      inferredCheckpointTurnCountByTurnId,
                    )}
                  </span>
                  <span className="text-[9px] leading-tight opacity-70">
                    {formatShortTimestamp(summary.completedAt, settings.timestampFormat)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <ToggleGroup
          className="shrink-0"
          variant="outline"
          size="xs"
          value={[diffRenderMode]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "stacked" || next === "split") {
              setDiffRenderMode(next);
            }
          }}
        >
          <Toggle aria-label="Stacked diff view" value="stacked">
            <Rows3Icon className="size-3" />
          </Toggle>
          <Toggle aria-label="Split diff view" value="split">
            <Columns2Icon className="size-3" />
          </Toggle>
        </ToggleGroup>
        <Toggle
          aria-label={diffWordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping"}
          title={diffWordWrap ? "Disable line wrapping" : "Enable line wrapping"}
          variant="outline"
          size="xs"
          pressed={diffWordWrap}
          onPressedChange={(pressed) => {
            setDiffWordWrap(Boolean(pressed));
          }}
        >
          <TextWrapIcon className="size-3" />
        </Toggle>
        {mode !== "inline" ? (
          <Toggle
            aria-label={fileTreeOpen ? "Hide file tree" : "Show file tree"}
            title={fileTreeOpen ? "Hide file tree" : "Show file tree"}
            variant="outline"
            size="xs"
            pressed={fileTreeOpen}
            onPressedChange={(pressed) => setFileTreeOpen(Boolean(pressed))}
          >
            {fileTreeOpen ? (
              <PanelRightCloseIcon className="size-3" />
            ) : (
              <PanelRightIcon className="size-3" />
            )}
          </Toggle>
        ) : null}
      </div>
    </>
  );

  const showFileTree =
    mode !== "inline" &&
    fileTreeOpen &&
    renderablePatch?.kind === "files" &&
    renderableFiles.length > 0;

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!activeThread ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a thread to inspect turn diffs.
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            ref={patchViewportRef}
            className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            {selectedDiffSelection === null && orderedTurnDiffSummaries.length === 0 ? (
              <div className="flex h-full items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
                No completed turns yet.
              </div>
            ) : (
              <>
                {activePatchError && !renderablePatch && (
                  <div className="px-3">
                    <p className="mb-2 text-[11px] text-red-500/80">{activePatchError}</p>
                  </div>
                )}
                {!renderablePatch ? (
                  isLoadingActivePatch ? (
                    <DiffPanelLoadingState
                      label={
                        selectedDiffSelection === null
                          ? "Loading checkpoint diff..."
                          : `Loading ${selectedDiffSelection} diff...`
                      }
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                      <p>
                        {hasNoNetChanges
                          ? "No net changes in this selection."
                          : "No patch available for this selection."}
                      </p>
                    </div>
                  )
                ) : renderablePatch.kind === "files" ? (
                  <Virtualizer
                    className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
                    config={{
                      overscrollSize: 600,
                      intersectionObserverMargin: 1200,
                    }}
                  >
                    {hydratedFiles.map((fileDiff) => {
                      const filePath = resolveReviewFilePath(fileDiff);
                      const fileKey = buildReviewFileRenderKey(fileDiff);
                      const themedFileKey = `${fileKey}:${resolvedTheme}`;
                      const isFileCollapsed = collapsedFileKeys.has(fileKey);
                      const selectedRange = selectedRangesByFileKey[fileKey] ?? null;
                      const isCommentComposerOpen = activeCommentSelection?.fileKey === fileKey;
                      const submittedDiffComments =
                        submittedDiffCommentsByFileKey.get(fileKey) ?? EMPTY_DRAFT_DIFF_COMMENTS;
                      const lineAnnotations: DiffLineAnnotation<DiffCommentAnnotationMetadata>[] = [
                        ...submittedDiffComments.map((comment) => ({
                          side: toDiffAnnotationSide(comment.side),
                          lineNumber: comment.lineEnd,
                          metadata: {
                            kind: "draft-comment",
                            comment,
                          } satisfies PendingDiffCommentAnnotationMetadata,
                        })),
                        ...(isCommentComposerOpen && activeCommentSelection
                          ? [
                              {
                                side: toDiffAnnotationSide(activeCommentSelection.side),
                                lineNumber: activeCommentSelection.lineEnd,
                                metadata: {
                                  kind: "draft-form",
                                  selection: activeCommentSelection,
                                } satisfies InlineDiffCommentAnnotationMetadata,
                              },
                            ]
                          : []),
                      ];
                      return (
                        <div
                          key={themedFileKey}
                          data-diff-file-path={filePath}
                          className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
                          onClickCapture={(event) => {
                            const nativeEvent = event.nativeEvent as MouseEvent;
                            const composedPath = nativeEvent.composedPath?.() ?? [];
                            const clickedHeader = composedPath.some((node) => {
                              if (!(node instanceof Element)) return false;
                              return node.hasAttribute("data-title");
                            });
                            if (!clickedHeader) return;
                            openDiffFileInEditor(filePath);
                          }}
                        >
                          <FileDiff<DiffCommentAnnotationMetadata>
                            fileDiff={fileDiff}
                            lineAnnotations={lineAnnotations}
                            options={{
                              collapsed: isFileCollapsed,
                              diffStyle: diffRenderMode === "split" ? "split" : "unified",
                              lineDiffType: "none",
                              enableGutterUtility: true,
                              enableLineSelection: true,
                              overflow: diffWordWrap ? "wrap" : "scroll",
                              theme: resolveDiffThemeName(resolvedTheme),
                              themeType: resolvedTheme as DiffThemeType,
                              unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                              onGutterUtilityClick: (range) => {
                                openCommentComposer(
                                  buildCommentSelectionFromRange(fileDiff, fileKey, range),
                                );
                              },
                              onLineSelected: (range) => {
                                setSelectedRangesByFileKey((currentRanges) => ({
                                  ...currentRanges,
                                  [fileKey]: range,
                                }));
                                if (!range && activeCommentSelection?.fileKey === fileKey) {
                                  clearCommentComposer(fileKey);
                                }
                              },
                            }}
                            selectedLines={selectedRange}
                            renderHeaderPrefix={() => (
                              <button
                                type="button"
                                className={cn(
                                  "mr-1 inline-flex size-5 items-center justify-center rounded-sm border border-transparent text-muted-foreground/70 transition-colors",
                                  "hover:border-border/70 hover:bg-background/70 hover:text-foreground",
                                )}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  toggleFileCollapsed(fileKey);
                                }}
                                aria-label={`${isFileCollapsed ? "Expand" : "Collapse"} ${filePath}`}
                                title={isFileCollapsed ? "Expand file diff" : "Collapse file diff"}
                              >
                                <ChevronDownIcon
                                  className={cn(
                                    "size-3.5 transition-transform",
                                    isFileCollapsed ? "-rotate-90" : "rotate-0",
                                  )}
                                />
                              </button>
                            )}
                            renderAnnotation={(annotation) => {
                              if (!annotation.metadata) {
                                return null;
                              }
                              if (annotation.metadata.kind === "draft-comment") {
                                const pendingComment = annotation.metadata.comment;
                                return (
                                  <div className="mx-4 my-2 rounded-xl border border-primary/20 bg-card/95 p-3 shadow-sm">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="space-y-1">
                                        <p className="text-xs font-medium text-foreground">
                                          Pending for next turn
                                        </p>
                                        <p className="text-[11px] text-muted-foreground/75">
                                          {formatCommentSelectionSummary(pendingComment)}
                                        </p>
                                      </div>
                                      <Button
                                        type="button"
                                        size="icon-xs"
                                        variant="ghost"
                                        onClick={() =>
                                          removeComposerDiffComment(
                                            pendingComment.threadId,
                                            pendingComment.id,
                                          )
                                        }
                                        aria-label="Remove pending diff comment"
                                      >
                                        <XIcon className="size-3.5" />
                                      </Button>
                                    </div>
                                    <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                                      {pendingComment.body}
                                    </p>
                                  </div>
                                );
                              }
                              return (
                                <div className="mx-4 my-2 rounded-xl border border-border/70 bg-card/95 p-3 shadow-sm">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="space-y-1">
                                      <p className="text-xs font-medium text-foreground">
                                        Add review comment
                                      </p>
                                      <p className="text-[11px] text-muted-foreground/75">
                                        {formatCommentSelectionSummary(
                                          annotation.metadata.selection,
                                        )}
                                      </p>
                                    </div>
                                    <Button
                                      type="button"
                                      size="icon-xs"
                                      variant="ghost"
                                      onClick={() => clearCommentComposer(fileKey)}
                                      aria-label="Cancel diff comment"
                                    >
                                      <XIcon className="size-3.5" />
                                    </Button>
                                  </div>
                                  <Textarea
                                    key={getDiffCommentComposerKey(annotation.metadata.selection)}
                                    autoFocus
                                    ref={focusActiveCommentTextarea}
                                    className="mt-3 min-h-24 font-mono text-sm"
                                    value={activeCommentBody}
                                    onChange={(event) => setActiveCommentBody(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (!matchesReviewCommentSubmitShortcut(event)) {
                                        return;
                                      }
                                      event.preventDefault();
                                      addSelectedCommentToDraft();
                                    }}
                                    placeholder="Explain what needs attention in this change."
                                  />
                                  <div className="mt-2 flex items-center justify-end gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => clearCommentComposer(fileKey)}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      disabled={activeCommentBody.trim().length === 0}
                                      onClick={addSelectedCommentToDraft}
                                    >
                                      <span>Comment</span>
                                      <Kbd className="h-4 min-w-4 rounded-[4px] bg-primary-foreground/12 px-1 text-[10px] text-primary-foreground">
                                        {reviewCommentSubmitShortcutLabel}
                                      </Kbd>
                                    </Button>
                                  </div>
                                </div>
                              );
                            }}
                          />
                        </div>
                      );
                    })}
                  </Virtualizer>
                ) : (
                  <div className="h-full overflow-auto p-2">
                    <div className="space-y-2">
                      <p className="text-[11px] text-muted-foreground/75">
                        {renderablePatch.reason}
                      </p>
                      <pre
                        className={cn(
                          "rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90",
                          diffWordWrap ? "whitespace-pre-wrap wrap-break-word" : "whitespace-pre",
                        )}
                      >
                        {renderablePatch.text}
                      </pre>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          {showFileTree ? (
            <ResizableFileTreePanel>
              <ReviewFileTree
                fileDiffs={renderableFiles}
                resolvedTheme={resolvedTheme}
                selectedPath={selectedFilePath}
                onSelectFile={selectReviewFile}
              />
            </ResizableFileTreePanel>
          ) : null}
        </div>
      )}
    </DiffPanelShell>
  );
}
