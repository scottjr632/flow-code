import { type ThreadId } from "@t3tools/contracts";

export type DiffCommentSide = "additions" | "deletions" | "lines";

export interface DiffCommentSelection {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  side: DiffCommentSide;
  body: string;
  excerpt: string;
}

export interface DiffCommentDraft extends DiffCommentSelection {
  id: string;
  threadId: ThreadId;
  createdAt: string;
}

export interface ParsedDiffCommentEntry {
  header: string;
  body: string;
}

export interface ExtractedDiffComments {
  promptText: string;
  comments: ParsedDiffCommentEntry[];
}

const TRAILING_DIFF_COMMENT_BLOCK_PATTERN = /\n*<diff_comment>\n([\s\S]*?)\n<\/diff_comment>\s*$/;

export function normalizeDiffCommentText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
}

export function normalizeDiffCommentSelection(
  selection: DiffCommentSelection,
): DiffCommentSelection | null {
  const filePath = selection.filePath.trim();
  const body = normalizeDiffCommentText(selection.body);
  const excerpt = normalizeDiffCommentText(selection.excerpt);
  if (filePath.length === 0 || body.length === 0 || excerpt.length === 0) {
    return null;
  }

  const lineStart = Math.max(1, Math.floor(selection.lineStart));
  const lineEnd = Math.max(lineStart, Math.floor(selection.lineEnd));
  return {
    filePath,
    lineStart,
    lineEnd,
    side:
      selection.side === "deletions"
        ? "deletions"
        : selection.side === "lines"
          ? "lines"
          : "additions",
    body,
    excerpt,
  };
}

export function formatDiffCommentRange(selection: { lineStart: number; lineEnd: number }): string {
  return selection.lineStart === selection.lineEnd
    ? `line ${selection.lineStart}`
    : `lines ${selection.lineStart}-${selection.lineEnd}`;
}

export function formatDiffCommentLabel(selection: {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  side: DiffCommentSide;
}): string {
  if (selection.side === "lines") {
    return `${selection.filePath} ${formatDiffCommentRange(selection)}`;
  }

  const sideLabel = selection.side === "deletions" ? "removed" : "added";
  return `${selection.filePath} ${sideLabel} ${formatDiffCommentRange(selection)}`;
}

function buildDiffCommentBodyLines(selection: DiffCommentSelection): string[] {
  const bodyLines = normalizeDiffCommentText(selection.body).split("\n");
  const excerptLines = normalizeDiffCommentText(selection.excerpt).split("\n");
  return [
    "  Comment:",
    ...bodyLines.map((line) => `    ${line}`),
    "  Code:",
    ...excerptLines.map((line) => `    ${line}`),
  ];
}

export function buildDiffCommentBlock(comments: ReadonlyArray<DiffCommentSelection>): string {
  const normalizedComments = comments
    .map((comment) => normalizeDiffCommentSelection(comment))
    .filter((comment): comment is DiffCommentSelection => comment !== null);
  if (normalizedComments.length === 0) {
    return "";
  }

  const lines: string[] = [];
  for (let index = 0; index < normalizedComments.length; index += 1) {
    const comment = normalizedComments[index]!;
    lines.push(`- ${formatDiffCommentLabel(comment)}:`);
    lines.push(...buildDiffCommentBodyLines(comment));
    if (index < normalizedComments.length - 1) {
      lines.push("");
    }
  }
  return ["<diff_comment>", ...lines, "</diff_comment>"].join("\n");
}

export function appendDiffCommentsToPrompt(
  prompt: string,
  comments: ReadonlyArray<DiffCommentSelection>,
): string {
  const trimmedPrompt = prompt.trim();
  const commentBlock = buildDiffCommentBlock(comments);
  if (commentBlock.length === 0) {
    return trimmedPrompt;
  }
  return trimmedPrompt.length > 0 ? `${trimmedPrompt}\n\n${commentBlock}` : commentBlock;
}

export function extractTrailingDiffComments(prompt: string): ExtractedDiffComments {
  const match = TRAILING_DIFF_COMMENT_BLOCK_PATTERN.exec(prompt);
  if (!match) {
    return {
      promptText: prompt,
      comments: [],
    };
  }

  return {
    promptText: prompt.slice(0, match.index).replace(/\n+$/, ""),
    comments: parseDiffCommentEntries(match[1] ?? ""),
  };
}

function parseDiffCommentEntries(block: string): ParsedDiffCommentEntry[] {
  const entries: ParsedDiffCommentEntry[] = [];
  let current: { header: string; bodyLines: string[] } | null = null;

  const commitCurrent = () => {
    if (!current) {
      return;
    }
    entries.push({
      header: current.header,
      body: current.bodyLines.join("\n").trimEnd(),
    });
    current = null;
  };

  for (const rawLine of block.split("\n")) {
    const headerMatch = /^- (.+):$/.exec(rawLine);
    if (headerMatch) {
      commitCurrent();
      current = {
        header: headerMatch[1]!,
        bodyLines: [],
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (rawLine.startsWith("  ")) {
      current.bodyLines.push(rawLine.slice(2));
      continue;
    }
    if (rawLine.length === 0) {
      current.bodyLines.push("");
    }
  }

  commitCurrent();
  return entries;
}
