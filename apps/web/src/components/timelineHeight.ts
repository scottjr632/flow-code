import { deriveDisplayedUserMessageState } from "../lib/terminalContext";
import { parseAssistantDirectives, type CodeCommentDirective } from "../lib/codexDirectives";
import { buildInlineDiffCommentText } from "./chat/userMessageDiffComments";
import { buildInlineTerminalContextText } from "./chat/userMessageTerminalContexts";

const ASSISTANT_CHARS_PER_LINE_FALLBACK = 72;
const USER_CHARS_PER_LINE_FALLBACK = 56;
const LINE_HEIGHT_PX = 22;
const ASSISTANT_BASE_HEIGHT_PX = 78;
const USER_BASE_HEIGHT_PX = 96;
const ATTACHMENTS_PER_ROW = 2;
// Attachment thumbnails render with `max-h-[220px]` plus ~8px row gap.
const USER_ATTACHMENT_ROW_HEIGHT_PX = 228;
const USER_BUBBLE_WIDTH_RATIO = 0.8;
const USER_BUBBLE_HORIZONTAL_PADDING_PX = 32;
const ASSISTANT_MESSAGE_HORIZONTAL_PADDING_PX = 8;
const USER_MONO_AVG_CHAR_WIDTH_PX = 8.4;
const ASSISTANT_AVG_CHAR_WIDTH_PX = 7.2;
const MIN_USER_CHARS_PER_LINE = 4;
const MIN_ASSISTANT_CHARS_PER_LINE = 20;
const REVIEW_COMMENT_HEADER_HEIGHT_PX = 36;
const REVIEW_COMMENT_CARD_BASE_HEIGHT_PX = 68;

interface TimelineMessageHeightInput {
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ReadonlyArray<{ id: string }>;
}

interface TimelineHeightEstimateLayout {
  timelineWidthPx: number | null;
}

function estimateWrappedLineCount(text: string, charsPerLine: number): number {
  if (text.length === 0) return 1;

  // Avoid allocating via split for long logs; iterate once and count wrapped lines.
  let lines = 0;
  let currentLineLength = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lines += Math.max(1, Math.ceil(currentLineLength / charsPerLine));
      currentLineLength = 0;
      continue;
    }
    currentLineLength += 1;
  }

  lines += Math.max(1, Math.ceil(currentLineLength / charsPerLine));
  return lines;
}

function isFinitePositiveNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function estimateCharsPerLineForUser(timelineWidthPx: number | null): number {
  if (!isFinitePositiveNumber(timelineWidthPx)) return USER_CHARS_PER_LINE_FALLBACK;
  const bubbleWidthPx = timelineWidthPx * USER_BUBBLE_WIDTH_RATIO;
  const textWidthPx = Math.max(bubbleWidthPx - USER_BUBBLE_HORIZONTAL_PADDING_PX, 0);
  return Math.max(MIN_USER_CHARS_PER_LINE, Math.floor(textWidthPx / USER_MONO_AVG_CHAR_WIDTH_PX));
}

function estimateCharsPerLineForAssistant(timelineWidthPx: number | null): number {
  if (!isFinitePositiveNumber(timelineWidthPx)) return ASSISTANT_CHARS_PER_LINE_FALLBACK;
  const textWidthPx = Math.max(timelineWidthPx - ASSISTANT_MESSAGE_HORIZONTAL_PADDING_PX, 0);
  return Math.max(
    MIN_ASSISTANT_CHARS_PER_LINE,
    Math.floor(textWidthPx / ASSISTANT_AVG_CHAR_WIDTH_PX),
  );
}

function estimateReviewCommentsHeight(
  reviewComments: ReadonlyArray<CodeCommentDirective>,
  charsPerLine: number,
): number {
  if (reviewComments.length === 0) {
    return 0;
  }

  return (
    REVIEW_COMMENT_HEADER_HEIGHT_PX +
    reviewComments.reduce((totalHeight, reviewComment) => {
      const titleLines = estimateWrappedLineCount(reviewComment.title, charsPerLine);
      const bodyLines = estimateWrappedLineCount(reviewComment.body, charsPerLine);
      const fileLabel = reviewComment.start
        ? `${reviewComment.file}:${reviewComment.start}`
        : reviewComment.file;
      const fileLines = estimateWrappedLineCount(fileLabel, charsPerLine);
      return (
        totalHeight +
        REVIEW_COMMENT_CARD_BASE_HEIGHT_PX +
        (titleLines + bodyLines) * LINE_HEIGHT_PX +
        fileLines * 16
      );
    }, 0)
  );
}

export function estimateTimelineMessageHeight(
  message: TimelineMessageHeightInput,
  layout: TimelineHeightEstimateLayout = { timelineWidthPx: null },
): number {
  if (message.role === "assistant") {
    const charsPerLine = estimateCharsPerLineForAssistant(layout.timelineWidthPx);
    const parsedAssistantDirectives = parseAssistantDirectives(message.text);
    const estimatedLines = estimateWrappedLineCount(
      parsedAssistantDirectives.displayText,
      charsPerLine,
    );
    return (
      ASSISTANT_BASE_HEIGHT_PX +
      estimatedLines * LINE_HEIGHT_PX +
      estimateReviewCommentsHeight(parsedAssistantDirectives.codeComments, charsPerLine)
    );
  }

  if (message.role === "user") {
    const charsPerLine = estimateCharsPerLineForUser(layout.timelineWidthPx);
    const displayedUserMessage = deriveDisplayedUserMessageState(message.text);
    const renderedText =
      displayedUserMessage.contexts.length > 0 || displayedUserMessage.diffComments.length > 0
        ? [
            buildInlineDiffCommentText(displayedUserMessage.diffComments),
            buildInlineTerminalContextText(displayedUserMessage.contexts),
            displayedUserMessage.visibleText,
          ]
            .filter((part) => part.length > 0)
            .join(" ")
        : displayedUserMessage.visibleText;
    const estimatedLines = estimateWrappedLineCount(renderedText, charsPerLine);
    const attachmentCount = message.attachments?.length ?? 0;
    const attachmentRows = Math.ceil(attachmentCount / ATTACHMENTS_PER_ROW);
    const attachmentHeight = attachmentRows * USER_ATTACHMENT_ROW_HEIGHT_PX;
    return USER_BASE_HEIGHT_PX + estimatedLines * LINE_HEIGHT_PX + attachmentHeight;
  }

  // `system` messages are not rendered in the chat timeline, but keep a stable
  // explicit branch in case they are present in timeline data.
  const charsPerLine = estimateCharsPerLineForAssistant(layout.timelineWidthPx);
  const estimatedLines = estimateWrappedLineCount(message.text, charsPerLine);
  return ASSISTANT_BASE_HEIGHT_PX + estimatedLines * LINE_HEIGHT_PX;
}
