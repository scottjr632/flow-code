import { ThreadId, type WorkspaceId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { type Thread } from "../types";
import {
  appendSessionReferencesToPrompt,
  buildSessionReferenceToken,
  extractSessionReferenceThreadIds,
  extractTrailingSessionReferences,
  formatDisplayedSessionReferenceToken,
  formatSessionReferenceMentionLabel,
  parseSessionReferenceToken,
  replaceSessionReferenceTokensForDisplay,
  searchWorkspaceSessionReferences,
} from "./sessionReferences";

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
    messages: [
      {
        id: "message-1" as Thread["messages"][number]["id"],
        role: "user",
        text: "Investigate reconnect failures after session restore.",
        createdAt: "2026-03-29T10:00:00.000Z",
        streaming: false,
      },
      {
        id: "message-2" as Thread["messages"][number]["id"],
        role: "assistant",
        text: "The resume cursor is stale after a restart.",
        createdAt: "2026-03-29T10:01:00.000Z",
        completedAt: "2026-03-29T10:01:10.000Z",
        streaming: false,
      },
    ],
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

describe("sessionReferences", () => {
  it("builds and parses stable session reference tokens", () => {
    const token = buildSessionReferenceToken({
      threadId: ThreadId.makeUnsafe("thread-reconnect"),
      title: "Fix reconnect flow",
    });

    expect(token).toBe("session:fix-reconnect-flow#thread-reconnect");
    expect(parseSessionReferenceToken(token)).toEqual({
      threadId: "thread-reconnect",
      titleSlug: "fix-reconnect-flow",
    });
    expect(formatSessionReferenceMentionLabel(token)).toBe("session: fix reconnect flow");
    expect(formatDisplayedSessionReferenceToken(token)).toBe("@session:fix-reconnect-flow");
  });

  it("replaces session reference tokens with display-friendly labels", () => {
    expect(
      replaceSessionReferenceTokensForDisplay(
        "Compare @session:fix-reconnect-flow#thread-a with @AGENTS.md",
      ),
    ).toBe("Compare @session:fix-reconnect-flow with @AGENTS.md");
  });

  it("extracts unique referenced thread ids from composer text", () => {
    expect(
      extractSessionReferenceThreadIds(
        "Compare @session:fix-reconnect#thread-1 with @session:fix-reconnect#thread-1 and @AGENTS.md ",
      ),
    ).toEqual(["thread-1"]);
  });

  it("searches only other sessions from the active workspace", () => {
    const results = searchWorkspaceSessionReferences({
      threads: [
        makeThread({ id: "thread-self" as never, title: "Current thread" }),
        makeThread({ id: "thread-2" as never, title: "Reconnect regression" }),
        makeThread({
          id: "thread-3" as never,
          title: "Unrelated workspace thread",
          workspaceId: "workspace-2" as WorkspaceId,
        }),
      ],
      workspaceId: "workspace-1" as WorkspaceId,
      activeThreadId: "thread-self" as never,
      query: "reconnect",
    });

    expect(results).toEqual([
      {
        threadId: "thread-2",
        token: "session:reconnect-regression#thread-2",
        title: "Reconnect regression",
        description: "feature/reconnect · thread-2",
      },
    ]);
  });

  it("appends a materialized session context block for referenced sessions", () => {
    const prompt = appendSessionReferencesToPrompt(
      "Use @session:fix-reconnect-flow#thread-a as context",
      {
        threads: [makeThread()],
        workspaceId: "workspace-1" as WorkspaceId,
        currentThreadId: "thread-current" as never,
      },
    );

    expect(prompt).toContain("Use @session:fix-reconnect-flow#thread-a as context");
    expect(prompt).toContain("<session_context>");
    expect(prompt).toContain("- Fix reconnect flow:");
    expect(prompt).toContain("Thread id: thread-a");
    expect(prompt).toContain("user: Investigate reconnect failures after session restore.");
  });

  it("extracts the trailing session context block for message display", () => {
    const prompt = [
      "Use @session:fix-reconnect-flow#thread-a as context",
      "",
      "<session_context>",
      "- Fix reconnect flow:",
      "  Thread id: thread-a",
      "  Branch: feature/reconnect",
      "</session_context>",
    ].join("\n");

    expect(extractTrailingSessionReferences(prompt)).toEqual({
      promptText: "Use @session:fix-reconnect-flow#thread-a as context",
      references: [
        {
          header: "Fix reconnect flow",
          body: ["Thread id: thread-a", "Branch: feature/reconnect"].join("\n"),
        },
      ],
    });
  });
});
