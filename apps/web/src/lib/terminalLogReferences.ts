import {
  DEFAULT_TERMINAL_ID,
  type TerminalHistoryReference,
  type ThreadId,
  type WorkspaceId,
} from "@t3tools/contracts";
import { truncate } from "@t3tools/shared/String";
import { DEFAULT_THREAD_TERMINAL_ID } from "../types";
import { buildTerminalLabelById } from "../terminalLabels";
import { type Thread } from "../types";

export interface ParsedTerminalLogReferenceEntry {
  header: string;
  body: string;
}

export interface ExtractedTerminalLogReferences {
  promptText: string;
  references: ParsedTerminalLogReferenceEntry[];
}

export interface TerminalLogReferenceSearchResult {
  threadId: ThreadId;
  terminalId: string;
  token: string;
  title: string;
  description: string;
}

export interface TerminalLogReferenceThreadState {
  terminalIds: string[];
  terminalNamesById: Record<string, string>;
}

export interface ParsedTerminalLogReferenceToken {
  threadId: ThreadId;
  terminalId: string;
  titleSlug: string;
}

const TERMINAL_LOG_REFERENCE_TOKEN_PREFIX = "terminal:";
const TERMINAL_LOG_REFERENCE_BLOCK_PATTERN =
  /\n*<terminal_log_context>\n([\s\S]*?)\n<\/terminal_log_context>\s*$/;
const TERMINAL_LOG_REFERENCE_QUERY_LIMIT = 8;
const TERMINAL_LOG_REFERENCE_BODY_CHAR_LIMIT = 4_000;
const TERMINAL_LOG_REFERENCE_LINE_LIMIT = 120;

function normalizeMultilineText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
}

function slugifyTerminalLogReferenceTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.length === 0) {
    return "terminal";
  }
  return truncate(normalized, 48).replace(/\.\.\.$/, "");
}

function humanizeTerminalLogReferenceSlug(slug: string): string {
  const normalized = slug.replace(/-+/g, " ").trim();
  return normalized.length > 0 ? normalized : "terminal";
}

function threadActivityTimestamp(thread: Pick<Thread, "updatedAt" | "createdAt">): number {
  const timestamp = Date.parse(thread.updatedAt ?? thread.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function parseTerminalLogReferenceEntries(block: string): ParsedTerminalLogReferenceEntry[] {
  const entries: ParsedTerminalLogReferenceEntry[] = [];
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

function buildTerminalLogReferenceBodyLines(reference: TerminalHistoryReference): string[] {
  const normalizedHistory = normalizeMultilineText(reference.history);
  const historyLines = normalizedHistory.length > 0 ? normalizedHistory.split("\n") : [];
  const visibleLines = historyLines.slice(-TERMINAL_LOG_REFERENCE_LINE_LIMIT);
  const startingLineNumber = Math.max(1, historyLines.length - visibleLines.length + 1);
  const lines: string[] = [
    `  Thread id: ${reference.threadId}`,
    `  Terminal id: ${reference.terminalId}`,
    ...(reference.cwd ? [`  Cwd: ${reference.cwd}`] : []),
    ...(reference.status ? [`  Status: ${reference.status}`] : []),
    ...(reference.updatedAt ? [`  Updated: ${reference.updatedAt}`] : []),
    "  Recent output:",
  ];

  if (visibleLines.length === 0) {
    lines.push("    (no terminal output captured)");
  } else {
    for (const [index, line] of visibleLines.entries()) {
      lines.push(`    ${startingLineNumber + index} | ${line}`);
    }
  }

  return lines;
}

function buildTerminalLogReferenceEntry(options: {
  tokenTitleSlug: string;
  reference: TerminalHistoryReference;
}): string {
  const body = buildTerminalLogReferenceBodyLines(options.reference).join("\n");
  const trimmedBody =
    body.length > TERMINAL_LOG_REFERENCE_BODY_CHAR_LIMIT
      ? `${body.slice(0, TERMINAL_LOG_REFERENCE_BODY_CHAR_LIMIT - 3)}...`
      : body;
  return [`- ${humanizeTerminalLogReferenceSlug(options.tokenTitleSlug)}:`, trimmedBody].join("\n");
}

function normalizeThreadTerminalState(
  threadState: TerminalLogReferenceThreadState | undefined,
  includeDefaultTerminal: boolean,
): TerminalLogReferenceThreadState | null {
  const terminalIds =
    threadState?.terminalIds.filter((terminalId) => terminalId.trim().length > 0) ??
    (includeDefaultTerminal ? [DEFAULT_THREAD_TERMINAL_ID] : []);
  if (terminalIds.length === 0) {
    return null;
  }
  return {
    terminalIds,
    terminalNamesById: threadState?.terminalNamesById ?? {},
  };
}

function searchTextForTerminalReference(input: {
  token: string;
  thread: Pick<Thread, "title" | "branch">;
  terminalLabel: string;
  terminalId: string;
  description: string;
}): string {
  return [
    input.token,
    input.thread.title,
    input.thread.branch ?? "",
    input.terminalLabel,
    input.terminalId,
    input.description,
  ]
    .join("\n")
    .toLowerCase();
}

export function buildTerminalLogReferenceToken(input: {
  threadId: ThreadId;
  terminalId: string;
  title: string;
}): string {
  return `${TERMINAL_LOG_REFERENCE_TOKEN_PREFIX}${slugifyTerminalLogReferenceTitle(input.title)}#${encodeURIComponent(input.threadId)}:${encodeURIComponent(input.terminalId)}`;
}

export function parseTerminalLogReferenceToken(
  token: string,
): ParsedTerminalLogReferenceToken | null {
  if (!token.startsWith(TERMINAL_LOG_REFERENCE_TOKEN_PREFIX)) {
    return null;
  }
  const suffix = token.slice(TERMINAL_LOG_REFERENCE_TOKEN_PREFIX.length);
  const separatorIndex = suffix.lastIndexOf("#");
  if (separatorIndex <= 0 || separatorIndex >= suffix.length - 1) {
    return null;
  }
  const titleSlug = suffix.slice(0, separatorIndex).trim();
  const encodedIds = suffix.slice(separatorIndex + 1);
  const idSeparatorIndex = encodedIds.lastIndexOf(":");
  if (
    titleSlug.length === 0 ||
    idSeparatorIndex <= 0 ||
    idSeparatorIndex >= encodedIds.length - 1
  ) {
    return null;
  }
  const encodedThreadId = encodedIds.slice(0, idSeparatorIndex);
  const encodedTerminalId = encodedIds.slice(idSeparatorIndex + 1);
  let threadId = "";
  let terminalId = "";
  try {
    threadId = decodeURIComponent(encodedThreadId).trim();
    terminalId = decodeURIComponent(encodedTerminalId).trim();
  } catch {
    return null;
  }
  if (threadId.length === 0 || terminalId.length === 0) {
    return null;
  }
  return {
    threadId: threadId as ThreadId,
    terminalId,
    titleSlug,
  };
}

export function isTerminalLogReferenceToken(token: string): boolean {
  return parseTerminalLogReferenceToken(token) !== null;
}

export function formatTerminalLogReferenceMentionLabel(token: string): string {
  const parsed = parseTerminalLogReferenceToken(token);
  if (!parsed) {
    return `terminal: ${token}`;
  }
  return `terminal: ${humanizeTerminalLogReferenceSlug(parsed.titleSlug)}`;
}

export function formatDisplayedTerminalLogReferenceToken(token: string): string {
  const parsed = parseTerminalLogReferenceToken(token);
  if (!parsed) {
    return `@${token}`;
  }
  return `@${TERMINAL_LOG_REFERENCE_TOKEN_PREFIX}${parsed.titleSlug}`;
}

export function replaceTerminalLogReferenceTokensForDisplay(text: string): string {
  return text.replaceAll(/(^|\s)@([^\s@]+)(?=\s|$)/g, (fullMatch, prefix, token) => {
    if (typeof prefix !== "string" || typeof token !== "string") {
      return fullMatch;
    }
    if (!isTerminalLogReferenceToken(token)) {
      return fullMatch;
    }
    return `${prefix}${formatDisplayedTerminalLogReferenceToken(token)}`;
  });
}

export function searchWorkspaceTerminalLogReferences(input: {
  threads: ReadonlyArray<Thread>;
  terminalStateByThreadId: Readonly<Record<ThreadId, TerminalLogReferenceThreadState | undefined>>;
  workspaceId: WorkspaceId | null;
  activeThreadId: ThreadId | null;
  query: string;
  limit?: number;
}): TerminalLogReferenceSearchResult[] {
  if (!input.activeThreadId) {
    return [];
  }

  const query = input.query.trim().toLowerCase();
  return input.threads
    .filter((thread) => thread.archivedAt === null)
    .filter((thread) => {
      if (thread.id === input.activeThreadId) {
        return true;
      }
      if (!input.workspaceId) {
        return false;
      }
      return thread.workspaceId === input.workspaceId;
    })
    .flatMap((thread) => {
      const isActiveThread = thread.id === input.activeThreadId;
      const threadState = normalizeThreadTerminalState(
        input.terminalStateByThreadId[thread.id],
        isActiveThread,
      );
      if (!threadState) {
        return [];
      }

      const labelById = buildTerminalLabelById(
        threadState.terminalIds,
        threadState.terminalNamesById,
      );
      return [...labelById.entries()].map(([terminalId, terminalLabel]) => {
        const token = buildTerminalLogReferenceToken({
          threadId: thread.id,
          terminalId,
          title: isActiveThread ? terminalLabel : `${thread.title} ${terminalLabel}`,
        });
        const description = [
          isActiveThread ? "Current thread" : thread.title,
          thread.branch ?? "no branch",
          terminalId === DEFAULT_TERMINAL_ID ? "default terminal" : terminalId,
        ].join(" · ");
        return {
          threadId: thread.id,
          terminalId,
          token,
          title: terminalLabel,
          description,
          searchText: searchTextForTerminalReference({
            token,
            thread,
            terminalLabel,
            terminalId,
            description,
          }),
          isActiveThread,
          activityTimestamp: threadActivityTimestamp(thread),
        };
      });
    })
    .filter((entry) => (query.length === 0 ? true : entry.searchText.includes(query)))
    .toSorted((left, right) => {
      if (left.isActiveThread !== right.isActiveThread) {
        return left.isActiveThread ? -1 : 1;
      }
      if (left.activityTimestamp !== right.activityTimestamp) {
        return right.activityTimestamp - left.activityTimestamp;
      }
      return left.title.localeCompare(right.title);
    })
    .slice(0, input.limit ?? TERMINAL_LOG_REFERENCE_QUERY_LIMIT)
    .map(
      ({
        searchText: _searchText,
        isActiveThread: _isActiveThread,
        activityTimestamp: _activityTimestamp,
        ...entry
      }) => entry,
    );
}

export async function appendTerminalLogReferencesToPrompt(
  prompt: string,
  resolveReference: (
    reference: ParsedTerminalLogReferenceToken,
  ) => Promise<TerminalHistoryReference | null>,
): Promise<string> {
  const trimmedPrompt = prompt.trim();
  const orderedReferences: ParsedTerminalLogReferenceToken[] = [];
  const seenReferences = new Set<string>();

  for (const rawToken of trimmedPrompt.matchAll(/(^|\s)@([^\s@]+)(?=\s|$)/g)) {
    const token = rawToken[2] ?? "";
    const parsed = parseTerminalLogReferenceToken(token);
    if (!parsed) {
      continue;
    }
    const key = `${parsed.threadId}\u0000${parsed.terminalId}`;
    if (seenReferences.has(key)) {
      continue;
    }
    seenReferences.add(key);
    orderedReferences.push(parsed);
  }

  if (orderedReferences.length === 0) {
    return trimmedPrompt;
  }

  const resolvedReferences = (
    await Promise.all(
      orderedReferences.map(async (reference) => {
        const resolved = await resolveReference(reference);
        return resolved ? { reference, resolved } : null;
      }),
    )
  ).filter(
    (
      value,
    ): value is {
      reference: ParsedTerminalLogReferenceToken;
      resolved: TerminalHistoryReference;
    } => value !== null,
  );

  if (resolvedReferences.length === 0) {
    return trimmedPrompt;
  }

  const block = [
    "<terminal_log_context>",
    ...resolvedReferences.flatMap(({ reference, resolved }, index) => {
      const entry = buildTerminalLogReferenceEntry({
        tokenTitleSlug: reference.titleSlug,
        reference: resolved,
      });
      return index < resolvedReferences.length - 1 ? [entry, ""] : [entry];
    }),
    "</terminal_log_context>",
  ].join("\n");

  return trimmedPrompt.length > 0 ? `${trimmedPrompt}\n\n${block}` : block;
}

export function extractTrailingTerminalLogReferences(
  prompt: string,
): ExtractedTerminalLogReferences {
  const match = TERMINAL_LOG_REFERENCE_BLOCK_PATTERN.exec(prompt);
  if (!match) {
    return {
      promptText: prompt,
      references: [],
    };
  }

  return {
    promptText: prompt.slice(0, match.index).replace(/\n+$/, ""),
    references: parseTerminalLogReferenceEntries(match[1] ?? ""),
  };
}
