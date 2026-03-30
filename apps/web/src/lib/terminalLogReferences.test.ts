import { ThreadId, type TerminalHistoryReference, type WorkspaceId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { type Thread } from "../types";
import {
  appendTerminalLogReferencesToPrompt,
  buildTerminalLogReferenceToken,
  extractTrailingTerminalLogReferences,
  formatDisplayedTerminalLogReferenceToken,
  formatTerminalLogReferenceMentionLabel,
  parseTerminalLogReferenceToken,
  replaceTerminalLogReferenceTokensForDisplay,
  searchWorkspaceTerminalLogReferences,
  type TerminalLogReferenceThreadState,
} from "./terminalLogReferences";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-a"),
    codexThreadId: null,
    projectId: "project-1" as Thread["projectId"],
    workspaceId: "workspace-1" as WorkspaceId,
    title: "Fix reconnect flow",
    modelSelection: {
      provider: "codex",
      model: "gpt-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-29T10:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-03-29T10:02:00.000Z",
    latestTurn: null,
    lastVisitedAt: "2026-03-29T10:02:00.000Z",
    branch: "feature/reconnect",
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeHistoryReference(
  overrides: Partial<TerminalHistoryReference> = {},
): TerminalHistoryReference {
  return {
    threadId: "thread-a",
    terminalId: "default",
    history: "pnpm lint\npnpm typecheck\n",
    cwd: "/repo",
    status: "running",
    exitCode: null,
    exitSignal: null,
    updatedAt: "2026-03-29T10:02:00.000Z",
    ...overrides,
  };
}

describe("terminalLogReferences", () => {
  it("builds and parses stable terminal log reference tokens", () => {
    const token = buildTerminalLogReferenceToken({
      threadId: ThreadId.makeUnsafe("thread-reconnect"),
      terminalId: "terminal-2",
      title: "Reconnect Terminal 2",
    });

    expect(token).toBe("terminal:reconnect-terminal-2#thread-reconnect:terminal-2");
    expect(parseTerminalLogReferenceToken(token)).toEqual({
      threadId: "thread-reconnect",
      terminalId: "terminal-2",
      titleSlug: "reconnect-terminal-2",
    });
    expect(formatTerminalLogReferenceMentionLabel(token)).toBe("terminal: reconnect terminal 2");
    expect(formatDisplayedTerminalLogReferenceToken(token)).toBe("@terminal:reconnect-terminal-2");
  });

  it("replaces terminal log reference tokens with display-friendly labels", () => {
    expect(
      replaceTerminalLogReferenceTokensForDisplay(
        "Check @terminal:reconnect-terminal-2#thread-1:terminal-2 before retrying",
      ),
    ).toBe("Check @terminal:reconnect-terminal-2 before retrying");
  });

  it("searches workspace terminal log references and includes the current thread by default", () => {
    const results = searchWorkspaceTerminalLogReferences({
      threads: [
        makeThread({ id: "thread-self" as never, title: "Current thread" }),
        makeThread({ id: "thread-2" as never, title: "Reconnect regression" }),
        makeThread({
          id: "thread-3" as never,
          title: "Other workspace",
          workspaceId: "workspace-2" as WorkspaceId,
        }),
      ],
      terminalStateByThreadId: {
        [ThreadId.makeUnsafe("thread-self")]: {
          terminalIds: ["default", "terminal-2"],
          terminalNamesById: { "terminal-2": "Tests" },
        },
        [ThreadId.makeUnsafe("thread-2")]: {
          terminalIds: ["default"],
          terminalNamesById: { default: "Build" },
        },
      } as Readonly<Record<ThreadId, TerminalLogReferenceThreadState | undefined>>,
      workspaceId: "workspace-1" as WorkspaceId,
      activeThreadId: "thread-self" as never,
      query: "test",
    });

    expect(results).toEqual([
      {
        threadId: "thread-self",
        terminalId: "terminal-2",
        token: "terminal:tests#thread-self:terminal-2",
        title: "Tests",
        description: "Current thread · feature/reconnect · terminal-2",
      },
    ]);
  });

  it("appends materialized terminal log context for referenced terminals", async () => {
    const prompt = await appendTerminalLogReferencesToPrompt(
      "Investigate @terminal:tests#thread-a:terminal-2",
      async () => makeHistoryReference({ terminalId: "terminal-2" }),
    );

    expect(prompt).toContain("Investigate @terminal:tests#thread-a:terminal-2");
    expect(prompt).toContain("<terminal_log_context>");
    expect(prompt).toContain("- tests:");
    expect(prompt).toContain("Thread id: thread-a");
    expect(prompt).toContain("Terminal id: terminal-2");
    expect(prompt).toContain("1 | pnpm lint");
  });

  it("extracts trailing terminal log context blocks for message display", () => {
    const prompt = [
      "Investigate @terminal:tests#thread-a:terminal-2",
      "",
      "<terminal_log_context>",
      "- tests:",
      "  Thread id: thread-a",
      "  Terminal id: terminal-2",
      "  Recent output:",
      "    1 | pnpm lint",
      "</terminal_log_context>",
    ].join("\n");

    expect(extractTrailingTerminalLogReferences(prompt)).toEqual({
      promptText: "Investigate @terminal:tests#thread-a:terminal-2",
      references: [
        {
          header: "tests",
          body: [
            "Thread id: thread-a",
            "Terminal id: terminal-2",
            "Recent output:",
            "  1 | pnpm lint",
          ].join("\n"),
        },
      ],
    });
  });
});
