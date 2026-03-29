import { XIcon } from "lucide-react";

import { type DiffCommentDraft, formatDiffCommentLabel } from "~/lib/diffCommentContext";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { DiffCommentInlineChip } from "./DiffCommentInlineChip";

interface ComposerPendingDiffCommentsProps {
  comments: ReadonlyArray<DiffCommentDraft>;
  onRemove: (commentId: string) => void;
  className?: string;
}

interface ComposerPendingDiffCommentChipProps {
  comment: DiffCommentDraft;
  onRemove: (commentId: string) => void;
}

function buildTooltipText(comment: DiffCommentDraft): string {
  return [`Comment:`, comment.body, "", `Code:`, comment.excerpt].join("\n");
}

export function ComposerPendingDiffCommentChip(props: ComposerPendingDiffCommentChipProps) {
  const { comment, onRemove } = props;
  const label = formatDiffCommentLabel(comment);

  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/80 px-1 py-1">
      <DiffCommentInlineChip label={label} tooltipText={buildTooltipText(comment)} />
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="size-6"
        onClick={() => onRemove(comment.id)}
        aria-label={`Remove ${label}`}
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}

export function ComposerPendingDiffComments(props: ComposerPendingDiffCommentsProps) {
  const { comments, onRemove, className } = props;

  if (comments.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {comments.map((comment) => (
        <ComposerPendingDiffCommentChip key={comment.id} comment={comment} onRemove={onRemove} />
      ))}
    </div>
  );
}
