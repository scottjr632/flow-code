import { parsePatchFiles, type SelectedLineRange } from "@pierre/diffs";
import {
  FileDiff,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  Virtualizer,
} from "@pierre/diffs/react";
import { useMemo, type ReactNode } from "react";

import { InlineCommentForm, InlinePendingComment } from "./InlineCommentWidgets";
import { cn } from "~/lib/utils";

import {
  formatDiffCommentLabel,
  type DiffCommentDraft,
  type DiffCommentSide,
} from "../lib/diffCommentContext";
import { resolveDiffThemeName } from "../lib/diffRendering";
import { buildPierreDiffTypographyCSSVars } from "../lib/workspaceCodeTypography";

export interface WorkspaceReviewFileViewerSelection {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  side: DiffCommentSide;
  excerpt: string;
}

export interface WorkspaceReviewFileViewerDraftFormAnnotationMetadata {
  kind: "draft-form";
  selection: WorkspaceReviewFileViewerSelection;
  body?: string;
  submitShortcutLabel?: string;
  onBodyChange?: (body: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
}

export interface WorkspaceReviewFileViewerPendingCommentAnnotationMetadata {
  kind: "draft-comment";
  comment: DiffCommentDraft;
  onRemove?: () => void;
}

export type WorkspaceReviewFileViewerAnnotationMetadata =
  | WorkspaceReviewFileViewerDraftFormAnnotationMetadata
  | WorkspaceReviewFileViewerPendingCommentAnnotationMetadata;

export type WorkspaceReviewFileViewerLineAnnotation =
  DiffLineAnnotation<WorkspaceReviewFileViewerAnnotationMetadata>;

const EMPTY_LINE_ANNOTATIONS: ReadonlyArray<WorkspaceReviewFileViewerLineAnnotation> = [];

function normalizePathForPatch(relativePath: string): string {
  const normalizedPath = relativePath
    .replace(/\r/g, "")
    .replace(/\n/g, "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^([ab])\//, "");

  return normalizedPath.length > 0 ? normalizedPath : "untitled";
}

function normalizeContents(contents: string): string {
  return contents.replace(/\r\n/g, "\n");
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function buildWholeFilePatch(relativePath: string, contents: string): string {
  const normalizedPath = normalizePathForPatch(relativePath);
  const normalizedContents = normalizeContents(contents);
  const lines = normalizedContents.split("\n");
  const hunkLineCount = Math.max(1, lines.length);

  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${normalizedPath}`,
    `@@ -0,0 +1,${hunkLineCount} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

function buildWholeFileRenderKey(relativePath: string, contents: string): string {
  return `${normalizePathForPatch(relativePath)}:${hashString(normalizeContents(contents))}`;
}

function buildAnnotationFallback(
  annotation: WorkspaceReviewFileViewerLineAnnotation,
): ReactNode | null {
  const metadata = annotation.metadata;
  if (!metadata) {
    return null;
  }

  if (metadata.kind === "draft-comment") {
    if (metadata.onRemove) {
      return <InlinePendingComment comment={metadata.comment} onRemove={metadata.onRemove} />;
    }
    return (
      <div className="mx-4 my-2 rounded-xl border border-primary/20 bg-card/95 p-3 shadow-sm">
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Pending for next turn</p>
          <p className="text-[11px] text-muted-foreground/75">
            {formatDiffCommentLabel(metadata.comment)}
          </p>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{metadata.comment.body}</p>
      </div>
    );
  }

  if (
    metadata.body !== undefined &&
    metadata.onBodyChange &&
    metadata.onSubmit &&
    metadata.onCancel &&
    metadata.submitShortcutLabel
  ) {
    return (
      <InlineCommentForm
        filePath={metadata.selection.filePath}
        lineStart={metadata.selection.lineStart}
        lineEnd={metadata.selection.lineEnd}
        body={metadata.body}
        submitShortcutLabel={metadata.submitShortcutLabel}
        onBodyChange={metadata.onBodyChange}
        onSubmit={metadata.onSubmit}
        onCancel={metadata.onCancel}
      />
    );
  }

  return (
    <div className="mx-4 my-2 rounded-xl border border-border/70 bg-card/95 p-3 shadow-sm">
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">Add review comment</p>
        <p className="text-[11px] text-muted-foreground/75">
          {formatDiffCommentLabel(metadata.selection)}
        </p>
      </div>
    </div>
  );
}

export function WorkspaceReviewFileViewer(props: {
  relativePath: string;
  contents: string;
  resolvedTheme: "light" | "dark";
  selectedRange?: SelectedLineRange | null;
  lineAnnotations?: ReadonlyArray<WorkspaceReviewFileViewerLineAnnotation>;
  onSelectedRangeChange?: (range: SelectedLineRange | null) => void;
  onGutterUtilityClick?: (range: SelectedLineRange) => void;
  collapsed?: boolean;
  renderAnnotation?: (annotation: WorkspaceReviewFileViewerLineAnnotation) => ReactNode;
  className?: string;
}) {
  const {
    className,
    collapsed = false,
    contents,
    lineAnnotations = EMPTY_LINE_ANNOTATIONS,
    onGutterUtilityClick,
    onSelectedRangeChange,
    relativePath,
    renderAnnotation,
    resolvedTheme,
    selectedRange = null,
  } = props;

  const renderablePatch = useMemo(() => {
    const patch = buildWholeFilePatch(relativePath, contents);
    try {
      const parsed = parsePatchFiles(patch, buildWholeFileRenderKey(relativePath, contents));
      const files = parsed.flatMap((parsedPatch) => parsedPatch.files);
      if (files.length > 0) {
        return { kind: "files" as const, files };
      }
      return {
        kind: "raw" as const,
        reason: "Unsupported diff format. Showing raw patch.",
        text: patch,
      };
    } catch {
      return {
        kind: "raw" as const,
        reason: "Failed to parse synthetic whole-file patch. Showing raw patch.",
        text: patch,
      };
    }
  }, [contents, relativePath]);

  const renderLineAnnotation = renderAnnotation ?? buildAnnotationFallback;
  const diffThemeName = resolveDiffThemeName(resolvedTheme);

  return (
    <div className={cn("h-full min-h-0 min-w-0 overflow-hidden", className)}>
      {renderablePatch.kind === "files" ? (
        <Virtualizer
          className="workspace-diff-render-surface h-full min-h-0 overflow-auto"
          config={{
            overscrollSize: 600,
            intersectionObserverMargin: 1200,
          }}
        >
          {renderablePatch.files.map((fileDiff, index) => {
            const themedFileKey = `${buildWholeFileRenderKey(relativePath, contents)}:${index}:${resolvedTheme}`;
            const fileDiffOptions = {
              collapsed,
              disableFileHeader: true,
              diffIndicators: "none" as const,
              diffStyle: "unified" as const,
              enableGutterUtility: true,
              enableLineSelection: true,
              lineDiffType: "none" as const,
              overflow: "scroll" as const,
              theme: diffThemeName,
              themeType: resolvedTheme,
              unsafeCSS: `
:host {
  background: var(--background) !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  outline: none !important;
}

[data-diffs-header],
[data-diff],
[data-file],
[data-background],
[data-code],
[data-error-wrapper],
[data-virtualizer-buffer] {
  ${buildPierreDiffTypographyCSSVars()}
  --diffs-bg: var(--background) !important;
  --diffs-light-bg: var(--background) !important;
  --diffs-dark-bg: var(--background) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: var(--background);
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: var(--background);
  --diffs-bg-buffer-override: var(--background);

  --diffs-bg-addition-override: var(--diffs-bg-context-override);
  --diffs-bg-addition-number-override: var(--diffs-bg-context-override);
  --diffs-bg-addition-hover-override: var(--diffs-bg-hover-override);
  --diffs-bg-addition-emphasis-override: var(--diffs-bg-context-override);

  --diffs-bg-deletion-override: var(--diffs-bg-context-override);
  --diffs-bg-deletion-number-override: var(--diffs-bg-context-override);
  --diffs-bg-deletion-hover-override: var(--diffs-bg-hover-override);
  --diffs-bg-deletion-emphasis-override: var(--diffs-bg-context-override);

  background-color: var(--diffs-bg) !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  outline: none !important;
}

[data-file-info] {
  background-color: var(--background) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: var(--background) !important;
  border-bottom: 1px solid var(--border) !important;
}
`,
              ...(onGutterUtilityClick ? { onGutterUtilityClick } : {}),
              ...(onSelectedRangeChange ? { onLineSelected: onSelectedRangeChange } : {}),
            };
            return (
              <div key={themedFileKey} className="workspace-diff-render-file">
                <FileDiff<WorkspaceReviewFileViewerAnnotationMetadata>
                  className="block border-0 rounded-none shadow-none outline-none bg-transparent"
                  fileDiff={fileDiff as FileDiffMetadata}
                  lineAnnotations={[...lineAnnotations]}
                  options={fileDiffOptions}
                  renderAnnotation={renderLineAnnotation}
                  selectedLines={selectedRange}
                  style={{
                    background: "var(--background)",
                    border: "none",
                    borderRadius: 0,
                    boxShadow: "none",
                    outline: "none",
                  }}
                />
              </div>
            );
          })}
        </Virtualizer>
      ) : (
        <div className="h-full overflow-auto p-2">
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
            <pre
              className={cn(
                "rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90",
                "whitespace-pre-wrap wrap-break-word",
              )}
            >
              {renderablePatch.text}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
