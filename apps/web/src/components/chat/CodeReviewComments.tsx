import { AlertTriangleIcon } from "lucide-react";
import { memo, useCallback } from "react";

import { openInPreferredEditor } from "~/editorPreferences";
import { readNativeApi } from "~/nativeApi";
import { buildCodeCommentOpenTarget, type CodeCommentDirective } from "~/lib/codexDirectives";
import { Button } from "../ui/button";

interface CodeReviewCommentsProps {
  comments: ReadonlyArray<CodeCommentDirective>;
  workspaceRoot?: string;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function formatLineRange(comment: Pick<CodeCommentDirective, "start" | "end">): string | null {
  if (comment.start === undefined) {
    return null;
  }
  if (comment.end === undefined || comment.end === comment.start) {
    return `Line ${comment.start}`;
  }
  return `Lines ${comment.start}-${comment.end}`;
}

export const CodeReviewComments = memo(function CodeReviewComments({
  comments,
  workspaceRoot,
}: CodeReviewCommentsProps) {
  const handleOpenFile = useCallback(
    async (comment: CodeCommentDirective) => {
      const api = readNativeApi();
      if (!api) {
        console.warn("Native API not found. Unable to open file in editor.");
        return;
      }
      await openInPreferredEditor(api, buildCodeCommentOpenTarget(comment, workspaceRoot));
    },
    [workspaceRoot],
  );

  if (comments.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
        <AlertTriangleIcon className="size-3.5" />
        <span>Review comments ({comments.length})</span>
      </div>
      {comments.map((comment) => {
        const lineRange = formatLineRange(comment);
        return (
          <div
            key={`${comment.file}:${comment.start ?? "none"}:${comment.end ?? "none"}:${comment.title}`}
            className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-sm text-foreground">{comment.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                  {comment.body}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {comment.priority !== undefined ? (
                  <span className="rounded-full border border-amber-500/30 bg-background/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-amber-700 dark:text-amber-200">
                    P{comment.priority}
                  </span>
                ) : null}
                {comment.confidence !== undefined ? (
                  <span className="rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                    {formatConfidence(comment.confidence)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <code className="rounded bg-background/70 px-1.5 py-0.5 text-[11px]">
                {comment.file}
              </code>
              {lineRange ? <span>{lineRange}</span> : null}
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  void handleOpenFile(comment);
                }}
              >
                Open
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
});
