import { MessageSquareIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { formatDiffCommentLabel, type DiffCommentDraft } from "../lib/diffCommentContext";
import { matchesReviewCommentSubmitShortcut } from "./DiffPanel.logic";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";
import { Textarea } from "./ui/textarea";

// ---------------------------------------------------------------------------
// Inline comment form – shown when the user is composing a new comment
// ---------------------------------------------------------------------------

export interface InlineCommentFormProps {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  body: string;
  submitShortcutLabel: string;
  onBodyChange: (body: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function InlineCommentForm({
  filePath,
  lineStart,
  lineEnd,
  body,
  submitShortcutLabel,
  onBodyChange,
  onSubmit,
  onCancel,
}: InlineCommentFormProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    // Schedule focus on next frame to avoid CodeMirror stealing it back.
    const frameId = window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el?.isConnected) {
        return;
      }
      el.focus();
      const cursor = el.value.length;
      el.setSelectionRange(cursor, cursor);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (!matchesReviewCommentSubmitShortcut(event)) {
        return;
      }
      event.preventDefault();
      onSubmit();
    },
    [onCancel, onSubmit],
  );

  // Prevent CodeMirror from interpreting keyboard events inside the form.
  const stopPropagation = useCallback((event: React.KeyboardEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <div
      className="mx-4 my-2 rounded-xl border border-border/70 bg-card/95 p-3 shadow-sm"
      onKeyDown={stopPropagation}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Add file comment</p>
          <p className="text-[11px] text-muted-foreground/75">
            {formatDiffCommentLabel({ filePath, lineStart, lineEnd, side: "lines" })}
          </p>
        </div>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={onCancel}
          aria-label="Cancel file comment"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      <Textarea
        ref={textareaRef}
        className="mt-3 min-h-24 font-mono text-sm"
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Explain what needs attention in this file."
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={body.trim().length === 0} onClick={onSubmit}>
          <span>Comment</span>
          <Kbd className="h-4 min-w-4 rounded-[4px] bg-primary-foreground/12 px-1 text-[10px] text-primary-foreground">
            {submitShortcutLabel}
          </Kbd>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline pending comment – shown for already-submitted draft comments
// ---------------------------------------------------------------------------

export interface InlinePendingCommentProps {
  comment: DiffCommentDraft;
  onRemove: () => void;
}

export function InlinePendingComment({ comment, onRemove }: InlinePendingCommentProps) {
  // Prevent CodeMirror from interpreting keyboard events inside the widget.
  const stopPropagation = useCallback((event: React.KeyboardEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <div
      className="mx-4 my-2 rounded-xl border border-primary/20 bg-card/95 p-3 shadow-sm"
      onKeyDown={stopPropagation}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <MessageSquareIcon className="size-3 text-primary/60" />
            <p className="text-xs font-medium text-foreground">Pending for next turn</p>
          </div>
          <p className="text-[11px] text-muted-foreground/75">{formatDiffCommentLabel(comment)}</p>
        </div>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={onRemove}
          aria-label="Remove pending file comment"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{comment.body}</p>
    </div>
  );
}
