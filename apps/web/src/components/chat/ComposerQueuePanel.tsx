import { type ProviderInteractionMode } from "@t3tools/contracts";
import { AlertCircleIcon, LoaderCircleIcon, XIcon } from "lucide-react";

import { type QueuedComposerMessage } from "../../composerQueueStore";
import { Button } from "../ui/button";

function interactionModeLabel(interactionMode: ProviderInteractionMode): string {
  return interactionMode === "plan" ? "Plan" : "Chat";
}

function attachmentLabel(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  return count === 1 ? "1 image" : `${count} images`;
}

export function ComposerQueuePanel(props: {
  queuedMessages: ReadonlyArray<QueuedComposerMessage>;
  onRetryMessage: (messageId: string) => void;
  onRemoveMessage: (messageId: string) => void;
}) {
  if (props.queuedMessages.length === 0) {
    return null;
  }

  return (
    <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20 px-3 py-2.5 sm:px-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-foreground text-sm">Queued messages</div>
          <div className="text-muted-foreground text-xs">
            {props.queuedMessages.length === 1
              ? "1 message will send after the current turn settles."
              : `${props.queuedMessages.length} messages will send in order.`}
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {props.queuedMessages.map((message, index) => {
          const attachmentSummary = attachmentLabel(message.attachments.length);
          return (
            <div
              key={message.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-background/80 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2 text-muted-foreground text-xs">
                  <span>{index + 1}.</span>
                  <span>{interactionModeLabel(message.interactionMode)}</span>
                  {attachmentSummary ? <span>{attachmentSummary}</span> : null}
                  {message.status === "sending" ? (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <LoaderCircleIcon className="size-3 animate-spin" />
                      Sending
                    </span>
                  ) : message.status === "failed" ? (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <AlertCircleIcon className="size-3" />
                      Failed
                    </span>
                  ) : (
                    <span>Queued</span>
                  )}
                </div>
                <div className="truncate text-foreground text-sm">{message.summary}</div>
                {message.error ? (
                  <div className="mt-1 line-clamp-2 text-destructive text-xs">{message.error}</div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {message.status === "failed" ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => props.onRetryMessage(message.id)}
                  >
                    Retry
                  </Button>
                ) : null}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove queued message ${index + 1}`}
                  onClick={() => props.onRemoveMessage(message.id)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
