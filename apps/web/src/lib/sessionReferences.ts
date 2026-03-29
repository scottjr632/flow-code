import { type ThreadId, type WorkspaceId } from "@t3tools/contracts";
import { truncate } from "@t3tools/shared/String";
import { type Thread } from "../types";

export interface ParsedSessionReferenceEntry {
  header: string;
  body: string;
}

export interface ExtractedSessionReferences {
  promptText: string;
  references: ParsedSessionReferenceEntry[];
}

export interface SessionReferenceSearchResult {
  threadId: ThreadId;
  token: string;
  title: string;
  description: string;
}

const SESSION_REFERENCE_TOKEN_PREFIX = "session:";
const SESSION_REFERENCE_BLOCK_PATTERN = /\n*<session_context>\n([\s\S]*?)\n<\/session_context>\s*$/;
const SESSION_REFERENCE_QUERY_LIMIT = 6;
const SESSION_REFERENCE_MESSAGE_LIMIT = 6;
const SESSION_REFERENCE_MESSAGE_CHAR_LIMIT = 280;
const SESSION_REFERENCE_BODY_CHAR_LIMIT = 3_500;

function normalizeMultilineText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
}

function slugifySessionReferenceTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.length === 0) {
    return "session";
  }
  return truncate(normalized, 40).replace(/\.\.\.$/, "");
}

function humanizeSessionReferenceSlug(slug: string): string {
  const normalized = slug.replace(/-+/g, " ").trim();
  return normalized.length > 0 ? normalized : "session";
}

function shortThreadId(threadId: ThreadId): string {
  return threadId.length > 12 ? threadId.slice(0, 12) : threadId;
}

function searchTextForThread(thread: Thread): string {
  return [
    thread.title,
    thread.branch ?? "",
    thread.id,
    buildSessionReferenceToken({ threadId: thread.id, title: thread.title }),
    ...thread.messages.slice(-3).map((message) => message.text),
  ]
    .join("\n")
    .toLowerCase();
}

function threadActivityTimestamp(thread: Thread): number {
  const timestamp = Date.parse(
    thread.updatedAt ?? thread.latestTurn?.completedAt ?? thread.createdAt,
  );
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function summarizeMessage(message: Thread["messages"][number]): string {
  const normalizedText = normalizeMultilineText(message.text);
  const attachmentSummary =
    message.attachments && message.attachments.length > 0
      ? `[attachments: ${message.attachments.map((attachment) => attachment.name).join(", ")}]`
      : "";
  const baseText = normalizedText.length > 0 ? normalizedText : attachmentSummary;
  if (baseText.length === 0) {
    return "(empty)";
  }
  return truncate(baseText, SESSION_REFERENCE_MESSAGE_CHAR_LIMIT);
}

function buildSessionReferenceBodyLines(thread: Thread): string[] {
  const lines: string[] = [
    `  Thread id: ${thread.id}`,
    `  Branch: ${thread.branch ?? "none"}`,
    `  Updated: ${thread.updatedAt ?? thread.createdAt}`,
    "  Recent messages:",
  ];
  const recentMessages = thread.messages
    .filter((message) => !message.streaming)
    .slice(-SESSION_REFERENCE_MESSAGE_LIMIT);

  if (recentMessages.length === 0) {
    lines.push("    (no messages yet)");
    return lines;
  }

  for (const message of recentMessages) {
    const summary = summarizeMessage(message);
    const summaryLines = summary.split("\n");
    const [firstLine = "", ...rest] = summaryLines;
    lines.push(`    ${message.role}: ${firstLine}`);
    for (const line of rest) {
      lines.push(`      ${line}`);
    }
  }

  return lines;
}

function buildSessionReferenceEntry(thread: Thread): string {
  const title = thread.title.trim().length > 0 ? thread.title.trim() : shortThreadId(thread.id);
  const body = buildSessionReferenceBodyLines(thread).join("\n");
  const trimmedBody =
    body.length > SESSION_REFERENCE_BODY_CHAR_LIMIT
      ? `${body.slice(0, SESSION_REFERENCE_BODY_CHAR_LIMIT - 3)}...`
      : body;
  return [`- ${title}:`, trimmedBody].join("\n");
}

function parseSessionReferenceEntries(block: string): ParsedSessionReferenceEntry[] {
  const entries: ParsedSessionReferenceEntry[] = [];
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
        header: headerMatch[1] ?? "",
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

export function buildSessionReferenceToken(input: { threadId: ThreadId; title: string }): string {
  return `${SESSION_REFERENCE_TOKEN_PREFIX}${slugifySessionReferenceTitle(input.title)}#${input.threadId}`;
}

export function parseSessionReferenceToken(
  token: string,
): { threadId: ThreadId; titleSlug: string } | null {
  if (!token.startsWith(SESSION_REFERENCE_TOKEN_PREFIX)) {
    return null;
  }
  const suffix = token.slice(SESSION_REFERENCE_TOKEN_PREFIX.length);
  const separatorIndex = suffix.lastIndexOf("#");
  if (separatorIndex <= 0 || separatorIndex >= suffix.length - 1) {
    return null;
  }
  const titleSlug = suffix.slice(0, separatorIndex).trim();
  const threadId = suffix.slice(separatorIndex + 1).trim();
  if (titleSlug.length === 0 || threadId.length === 0) {
    return null;
  }
  return {
    threadId: threadId as ThreadId,
    titleSlug,
  };
}

export function isSessionReferenceToken(token: string): boolean {
  return parseSessionReferenceToken(token) !== null;
}

export function formatSessionReferenceMentionLabel(token: string): string {
  const parsed = parseSessionReferenceToken(token);
  if (!parsed) {
    return `@${token}`;
  }
  return `session: ${humanizeSessionReferenceSlug(parsed.titleSlug)}`;
}

export function formatDisplayedSessionReferenceToken(token: string): string {
  const parsed = parseSessionReferenceToken(token);
  if (!parsed) {
    return `@${token}`;
  }
  return `@${SESSION_REFERENCE_TOKEN_PREFIX}${parsed.titleSlug}`;
}

export function replaceSessionReferenceTokensForDisplay(text: string): string {
  return text.replaceAll(/(^|\s)@([^\s@]+)(?=\s|$)/g, (fullMatch, prefix, token) => {
    if (typeof prefix !== "string" || typeof token !== "string") {
      return fullMatch;
    }
    if (!isSessionReferenceToken(token)) {
      return fullMatch;
    }
    return `${prefix}${formatDisplayedSessionReferenceToken(token)}`;
  });
}

export function searchWorkspaceSessionReferences(input: {
  threads: ReadonlyArray<Thread>;
  workspaceId: WorkspaceId | null;
  activeThreadId: ThreadId | null;
  query: string;
  limit?: number;
}): SessionReferenceSearchResult[] {
  if (!input.workspaceId) {
    return [];
  }

  const query = input.query.trim().toLowerCase();
  return input.threads
    .filter(
      (thread) =>
        thread.workspaceId === input.workspaceId &&
        thread.id !== input.activeThreadId &&
        thread.archivedAt === null,
    )
    .filter((thread) => (query.length === 0 ? true : searchTextForThread(thread).includes(query)))
    .toSorted((left, right) => threadActivityTimestamp(right) - threadActivityTimestamp(left))
    .slice(0, input.limit ?? SESSION_REFERENCE_QUERY_LIMIT)
    .map((thread) => ({
      threadId: thread.id,
      token: buildSessionReferenceToken({ threadId: thread.id, title: thread.title }),
      title: thread.title,
      description: `${thread.branch ?? "no branch"} · ${shortThreadId(thread.id)}`,
    }));
}

export function extractSessionReferenceThreadIds(prompt: string): ThreadId[] {
  const ordered = new Set<ThreadId>();
  for (const rawToken of prompt.matchAll(/(^|\s)@([^\s@]+)(?=\s|$)/g)) {
    const token = rawToken[2] ?? "";
    const parsed = parseSessionReferenceToken(token);
    if (!parsed) {
      continue;
    }
    ordered.add(parsed.threadId);
  }
  return [...ordered];
}

export function appendSessionReferencesToPrompt(
  prompt: string,
  input: {
    threads: ReadonlyArray<Thread>;
    workspaceId: WorkspaceId | null;
    currentThreadId: ThreadId;
  },
): string {
  const trimmedPrompt = prompt.trim();
  if (!input.workspaceId) {
    return trimmedPrompt;
  }

  const threadIds = extractSessionReferenceThreadIds(trimmedPrompt);
  if (threadIds.length === 0) {
    return trimmedPrompt;
  }

  const threadsById = new Map(
    input.threads
      .filter(
        (thread) =>
          thread.workspaceId === input.workspaceId &&
          thread.id !== input.currentThreadId &&
          thread.archivedAt === null,
      )
      .map((thread) => [thread.id, thread] as const),
  );
  const referencedThreads = threadIds.flatMap((threadId) => {
    const thread = threadsById.get(threadId);
    return thread ? [thread] : [];
  });
  if (referencedThreads.length === 0) {
    return trimmedPrompt;
  }

  const block = [
    "<session_context>",
    ...referencedThreads.flatMap((thread, index) => {
      const entry = buildSessionReferenceEntry(thread);
      return index < referencedThreads.length - 1 ? [entry, ""] : [entry];
    }),
    "</session_context>",
  ].join("\n");

  return trimmedPrompt.length > 0 ? `${trimmedPrompt}\n\n${block}` : block;
}

export function extractTrailingSessionReferences(prompt: string): ExtractedSessionReferences {
  const match = SESSION_REFERENCE_BLOCK_PATTERN.exec(prompt);
  if (!match) {
    return {
      promptText: prompt,
      references: [],
    };
  }

  return {
    promptText: prompt.slice(0, match.index).replace(/\n+$/, ""),
    references: parseSessionReferenceEntries(match[1] ?? ""),
  };
}
