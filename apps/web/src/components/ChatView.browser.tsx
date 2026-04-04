// Production CSS is part of the behavior under test because row height depends on it.
import "../index.css";

import {
  ORCHESTRATION_WS_METHODS,
  type MessageId,
  type OrchestrationReadModel,
  type ProjectId,
  type ServerConfig,
  type ThreadId,
  type WorkspaceId,
  type WsWelcomePayload,
  WS_CHANNELS,
  WS_METHODS,
  OrchestrationSessionStatus,
  DEFAULT_SERVER_SETTINGS,
} from "@t3tools/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import { page } from "vitest/browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "../composerDraftStore";
import { useComposerQueueStore } from "../composerQueueStore";
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
  removeInlineTerminalContextPlaceholder,
} from "../lib/terminalContext";
import { isMacPlatform } from "../lib/utils";
import { getRouter } from "../router";
import { useStore } from "../store";
import { AUTO_SCROLL_BOTTOM_THRESHOLD_PX } from "../chat-scroll";
import { estimateTimelineMessageHeight } from "./timelineHeight";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

const THREAD_ID = "thread-browser-test" as ThreadId;
const UUID_ROUTE_RE = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROJECT_ID = "project-1" as ProjectId;
const SECOND_PROJECT_ID = "project-2" as ProjectId;
const WORKSPACE_ID = "workspace-1" as WorkspaceId;
const NOW_ISO = "2026-03-04T12:00:00.000Z";
const BASE_TIME_MS = Date.parse(NOW_ISO);
const ATTACHMENT_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='300'></svg>";
const SECOND_THREAD_ID = "thread-browser-test-2" as ThreadId;

interface WsRequestEnvelope {
  id: string;
  body: {
    _tag: string;
    [key: string]: unknown;
  };
}

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: WsWelcomePayload;
}

let fixture: TestFixture;
const wsRequests: WsRequestEnvelope["body"][] = [];
let customWsRpcResolver: ((body: WsRequestEnvelope["body"]) => unknown | undefined) | null = null;
let attachmentResponseDelayMs = 0;
const wsLink = ws.link(/ws(s)?:\/\/.*/);

interface ViewportSpec {
  name: string;
  width: number;
  height: number;
  textTolerancePx: number;
  attachmentTolerancePx: number;
}

const DEFAULT_VIEWPORT: ViewportSpec = {
  name: "desktop",
  width: 960,
  height: 1_100,
  textTolerancePx: 44,
  attachmentTolerancePx: 56,
};
const TEXT_VIEWPORT_MATRIX = [
  DEFAULT_VIEWPORT,
  { name: "tablet", width: 720, height: 1_024, textTolerancePx: 44, attachmentTolerancePx: 56 },
  { name: "mobile", width: 430, height: 932, textTolerancePx: 56, attachmentTolerancePx: 56 },
  { name: "narrow", width: 320, height: 700, textTolerancePx: 84, attachmentTolerancePx: 56 },
] as const satisfies readonly ViewportSpec[];
const ATTACHMENT_VIEWPORT_MATRIX = [
  DEFAULT_VIEWPORT,
  { name: "mobile", width: 430, height: 932, textTolerancePx: 56, attachmentTolerancePx: 56 },
  { name: "narrow", width: 320, height: 700, textTolerancePx: 84, attachmentTolerancePx: 56 },
] as const satisfies readonly ViewportSpec[];

interface UserRowMeasurement {
  measuredRowHeightPx: number;
  timelineWidthMeasuredPx: number;
  renderedInVirtualizedRegion: boolean;
}

interface MountedChatView {
  [Symbol.asyncDispose]: () => Promise<void>;
  cleanup: () => Promise<void>;
  measureUserRow: (targetMessageId: MessageId) => Promise<UserRowMeasurement>;
  setViewport: (viewport: ViewportSpec) => Promise<void>;
  router: ReturnType<typeof getRouter>;
}

function isoAt(offsetSeconds: number): string {
  return new Date(BASE_TIME_MS + offsetSeconds * 1_000).toISOString();
}

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.flow-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [
      {
        provider: "codex",
        enabled: true,
        installed: true,
        version: "0.116.0",
        status: "ready",
        authStatus: "authenticated",
        checkedAt: NOW_ISO,
        models: [],
      },
    ],
    availableEditors: [],
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      ...DEFAULT_CLIENT_SETTINGS,
    },
  };
}

function createUserMessage(options: {
  id: MessageId;
  text: string;
  offsetSeconds: number;
  attachments?: Array<{
    type: "image";
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }>;
}) {
  return {
    id: options.id,
    role: "user" as const,
    text: options.text,
    ...(options.attachments ? { attachments: options.attachments } : {}),
    turnId: null,
    streaming: false,
    createdAt: isoAt(options.offsetSeconds),
    updatedAt: isoAt(options.offsetSeconds + 1),
  };
}

function createAssistantMessage(options: { id: MessageId; text: string; offsetSeconds: number }) {
  return {
    id: options.id,
    role: "assistant" as const,
    text: options.text,
    turnId: null,
    streaming: false,
    createdAt: isoAt(options.offsetSeconds),
    updatedAt: isoAt(options.offsetSeconds + 1),
  };
}

function createTerminalContext(input: {
  id: string;
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
  text: string;
}): TerminalContextDraft {
  return {
    id: input.id,
    threadId: THREAD_ID,
    terminalId: `terminal-${input.id}`,
    terminalLabel: input.terminalLabel,
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    text: input.text,
    createdAt: NOW_ISO,
  };
}

function createSnapshotForTargetUser(options: {
  targetMessageId: MessageId;
  targetText: string;
  targetAttachmentCount?: number;
  sessionStatus?: OrchestrationSessionStatus;
}): OrchestrationReadModel {
  const messages: Array<OrchestrationReadModel["threads"][number]["messages"][number]> = [];

  for (let index = 0; index < 22; index += 1) {
    const isTarget = index === 3;
    const userId = `msg-user-${index}` as MessageId;
    const assistantId = `msg-assistant-${index}` as MessageId;
    const attachments =
      isTarget && (options.targetAttachmentCount ?? 0) > 0
        ? Array.from({ length: options.targetAttachmentCount ?? 0 }, (_, attachmentIndex) => ({
            type: "image" as const,
            id: `attachment-${attachmentIndex + 1}`,
            name: `attachment-${attachmentIndex + 1}.png`,
            mimeType: "image/png",
            sizeBytes: 128,
          }))
        : undefined;

    messages.push(
      createUserMessage({
        id: isTarget ? options.targetMessageId : userId,
        text: isTarget ? options.targetText : `filler user message ${index}`,
        offsetSeconds: messages.length * 3,
        ...(attachments ? { attachments } : {}),
      }),
    );
    messages.push(
      createAssistantMessage({
        id: assistantId,
        text: `assistant filler ${index}`,
        offsetSeconds: messages.length * 3,
      }),
    );
  }

  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    workspaces: [],
    threads: [
      {
        id: THREAD_ID,
        projectId: PROJECT_ID,
        workspaceId: null,
        title: "Browser test thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        archivedAt: null,
        deletedAt: null,
        messages,
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId: THREAD_ID,
          status: options.sessionStatus ?? "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
    updatedAt: NOW_ISO,
  };
}

function buildFixture(snapshot: OrchestrationReadModel): TestFixture {
  return {
    snapshot,
    serverConfig: createBaseServerConfig(),
    welcome: {
      cwd: "/repo/project",
      projectName: "Project",
      bootstrapProjectId: PROJECT_ID,
      bootstrapThreadId: THREAD_ID,
    },
  };
}

function addThreadToSnapshot(
  snapshot: OrchestrationReadModel,
  threadId: ThreadId,
): OrchestrationReadModel {
  return {
    ...snapshot,
    snapshotSequence: snapshot.snapshotSequence + 1,
    threads: [
      ...snapshot.threads,
      {
        id: threadId,
        projectId: PROJECT_ID,
        workspaceId: null,
        title: "New thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        archivedAt: null,
        deletedAt: null,
        messages: [],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
  };
}

function createDraftOnlySnapshot(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-draft-target" as MessageId,
    targetText: "draft thread",
  });
  return {
    ...snapshot,
    threads: [],
  };
}

function withProjectScripts(
  snapshot: OrchestrationReadModel,
  scripts: OrchestrationReadModel["projects"][number]["scripts"],
): OrchestrationReadModel {
  return {
    ...snapshot,
    projects: snapshot.projects.map((project) =>
      project.id === PROJECT_ID ? { ...project, scripts: Array.from(scripts) } : project,
    ),
  };
}

function withWorkspace(
  snapshot: OrchestrationReadModel,
  options: {
    workspaceId?: WorkspaceId;
    title?: string;
    branch?: string | null;
    worktreePath?: string;
    threadId?: ThreadId;
  } = {},
): OrchestrationReadModel {
  const workspaceId = options.workspaceId ?? WORKSPACE_ID;
  const title = options.title ?? "feature-flow";
  const branch = options.branch ?? "feature-flow";
  const worktreePath = options.worktreePath ?? "/repo/project/.t3/worktrees/feature-flow";
  const threadId = options.threadId ?? THREAD_ID;

  return {
    ...snapshot,
    workspaces: [
      ...snapshot.workspaces,
      {
        id: workspaceId,
        projectId: PROJECT_ID,
        title,
        branch,
        worktreePath,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: snapshot.threads.map((thread) =>
      thread.id === threadId
        ? {
            ...thread,
            workspaceId,
            branch,
            worktreePath,
            updatedAt: NOW_ISO,
          }
        : thread,
    ),
  };
}

function setDraftThreadWithoutWorktree(): void {
  useComposerDraftStore.setState({
    draftThreadsByThreadId: {
      [THREAD_ID]: {
        projectId: PROJECT_ID,
        createdAt: NOW_ISO,
        runtimeMode: "full-access",
        interactionMode: "default",
        workspaceId: null,
        branch: null,
        worktreePath: null,
        envMode: "local",
      },
    },
    projectDraftThreadIdByProjectId: {
      [PROJECT_ID]: THREAD_ID,
    },
  });
}

function createSnapshotWithLongProposedPlan(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-plan-target" as MessageId,
    targetText: "plan thread",
  });
  const planMarkdown = [
    "# Ship plan mode follow-up",
    "",
    "- Step 1: capture the thread-open trace",
    "- Step 2: identify the main-thread bottleneck",
    "- Step 3: keep collapsed cards cheap",
    "- Step 4: render the full markdown only on demand",
    "- Step 5: preserve export and save actions",
    "- Step 6: add regression coverage",
    "- Step 7: verify route transitions stay responsive",
    "- Step 8: confirm no server-side work changed",
    "- Step 9: confirm short plans still render normally",
    "- Step 10: confirm long plans stay collapsed by default",
    "- Step 11: confirm preview text is still useful",
    "- Step 12: confirm plan follow-up flow still works",
    "- Step 13: confirm timeline virtualization still behaves",
    "- Step 14: confirm theme styling still looks correct",
    "- Step 15: confirm save dialog behavior is unchanged",
    "- Step 16: confirm download behavior is unchanged",
    "- Step 17: confirm code fences do not parse until expand",
    "- Step 18: confirm preview truncation ends cleanly",
    "- Step 19: confirm markdown links still open in editor after expand",
    "- Step 20: confirm deep hidden detail only appears after expand",
    "",
    "```ts",
    "export const hiddenPlanImplementationDetail = 'deep hidden detail only after expand';",
    "```",
  ].join("\n");

  return {
    ...snapshot,
    threads: snapshot.threads.map((thread) =>
      thread.id === THREAD_ID
        ? Object.assign({}, thread, {
            proposedPlans: [
              {
                id: "plan-browser-test",
                turnId: null,
                planMarkdown,
                implementedAt: null,
                implementationThreadId: null,
                createdAt: isoAt(1_000),
                updatedAt: isoAt(1_001),
              },
            ],
            updatedAt: isoAt(1_001),
          })
        : thread,
    ),
  };
}

function resolveWsRpc(body: WsRequestEnvelope["body"]): unknown {
  const customResult = customWsRpcResolver?.(body);
  if (customResult !== undefined) {
    return customResult;
  }
  const tag = body._tag;
  if (tag === ORCHESTRATION_WS_METHODS.getSnapshot) {
    return fixture.snapshot;
  }
  if (tag === WS_METHODS.serverGetConfig) {
    return fixture.serverConfig;
  }
  if (tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      branches: [
        {
          name: "main",
          current: true,
          isDefault: true,
          worktreePath: null,
        },
      ],
    };
  }
  if (tag === WS_METHODS.gitCreateWorktree) {
    const branchSuffix =
      typeof body.newBranch === "string"
        ? (body.newBranch.split("/").at(-1) ?? "workspace")
        : "workspace";
    return {
      worktree: {
        branch: typeof body.newBranch === "string" ? body.newBranch : "flow/workspace",
        path: `/repo/project/.t3/worktrees/${branchSuffix}`,
      },
    };
  }
  if (tag === WS_METHODS.gitStatus) {
    const emptyChangeSet = {
      files: [],
      insertions: 0,
      deletions: 0,
    };
    return {
      branch: "main",
      hasWorkingTreeChanges: false,
      workingTree: emptyChangeSet,
      staged: emptyChangeSet,
      unstaged: emptyChangeSet,
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };
  }
  if (tag === WS_METHODS.gitReviewDiff) {
    return { diff: "" };
  }
  if (tag === WS_METHODS.projectsSearchEntries) {
    return {
      entries: [],
      truncated: false,
    };
  }
  if (tag === WS_METHODS.terminalOpen) {
    return {
      threadId: typeof body.threadId === "string" ? body.threadId : THREAD_ID,
      terminalId: typeof body.terminalId === "string" ? body.terminalId : "default",
      cwd: typeof body.cwd === "string" ? body.cwd : "/repo/project",
      status: "running",
      pid: 123,
      history: "",
      exitCode: null,
      exitSignal: null,
      updatedAt: NOW_ISO,
    };
  }
  return {};
}

const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    client.send(
      JSON.stringify({
        type: "push",
        sequence: 1,
        channel: WS_CHANNELS.serverWelcome,
        data: fixture.welcome,
      }),
    );
    client.addEventListener("message", (event) => {
      const rawData = event.data;
      if (typeof rawData !== "string") return;
      let request: WsRequestEnvelope;
      try {
        request = JSON.parse(rawData) as WsRequestEnvelope;
      } catch {
        return;
      }
      const method = request.body?._tag;
      if (typeof method !== "string") return;
      wsRequests.push(request.body);
      client.send(
        JSON.stringify({
          id: request.id,
          result: resolveWsRpc(request.body),
        }),
      );
    });
  }),
  http.get("*/attachments/:attachmentId", async () => {
    if (attachmentResponseDelayMs > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, attachmentResponseDelayMs);
      });
    }
    return HttpResponse.text(ATTACHMENT_SVG, {
      headers: {
        "Content-Type": "image/svg+xml",
      },
    });
  }),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function waitForLayout(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await nextFrame();
}

async function setViewport(viewport: ViewportSpec): Promise<void> {
  await page.viewport(viewport.width, viewport.height);
  await waitForLayout();
}

async function waitForProductionStyles(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
      ).not.toBe("");
      expect(getComputedStyle(document.body).marginTop).toBe("0px");
    },
    {
      timeout: 4_000,
      interval: 16,
    },
  );
}

async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string,
): Promise<T> {
  let element: T | null = null;
  await vi.waitFor(
    () => {
      element = query();
      expect(element, errorMessage).toBeTruthy();
    },
    {
      timeout: 8_000,
      interval: 16,
    },
  );
  if (!element) {
    throw new Error(errorMessage);
  }
  return element;
}

async function waitForURL(
  router: ReturnType<typeof getRouter>,
  predicate: (pathname: string) => boolean,
  errorMessage: string,
): Promise<string> {
  let pathname = "";
  await vi.waitFor(
    () => {
      pathname = router.state.location.pathname;
      expect(predicate(pathname), errorMessage).toBe(true);
    },
    { timeout: 8_000, interval: 16 },
  );
  return pathname;
}

async function waitForComposerEditor(): Promise<HTMLElement> {
  return waitForElement(
    () => document.querySelector<HTMLElement>('[contenteditable="true"]'),
    "Unable to find composer editor.",
  );
}

async function waitForTerminalTextarea(): Promise<HTMLTextAreaElement> {
  return waitForElement(
    () => document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea"),
    "Unable to find terminal textarea.",
  );
}

async function waitForSendButton(): Promise<HTMLButtonElement> {
  return waitForElement(
    () => document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]'),
    "Unable to find send button.",
  );
}

async function waitForMessagesScrollContainer(): Promise<HTMLDivElement> {
  return waitForElement(
    () => document.querySelector<HTMLDivElement>("div.overflow-y-auto.overscroll-y-contain"),
    "Unable to find ChatView message scroll container.",
  );
}

async function expectMessagesScrollContainerAtBottom(
  scrollContainer: HTMLDivElement,
): Promise<void> {
  await vi.waitFor(
    () => {
      const distanceFromBottom =
        scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
      expect(distanceFromBottom).toBeLessThanOrEqual(AUTO_SCROLL_BOTTOM_THRESHOLD_PX);
    },
    {
      timeout: 8_000,
      interval: 16,
    },
  );
}

async function waitForInteractionModeButton(
  expectedLabel: "Chat" | "Plan",
): Promise<HTMLButtonElement> {
  return waitForElement(
    () =>
      Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === expectedLabel,
      ) as HTMLButtonElement | null,
    `Unable to find ${expectedLabel} interaction mode button.`,
  );
}

async function waitForServerConfigToApply(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(wsRequests.some((request) => request._tag === WS_METHODS.serverGetConfig)).toBe(true);
    },
    { timeout: 8_000, interval: 16 },
  );
  await waitForLayout();
}

function dispatchChatNewShortcut(): void {
  const useMetaForMod = isMacPlatform(navigator.platform);
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "o",
      shiftKey: true,
      metaKey: useMetaForMod,
      ctrlKey: !useMetaForMod,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function dispatchFocusComposerShortcut(): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "l",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function dispatchToggleTerminalShortcut(): void {
  const useMetaForMod = isMacPlatform(navigator.platform);
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "j",
      metaKey: useMetaForMod,
      ctrlKey: !useMetaForMod,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function dispatchWorkspaceCommandPaletteShortcut(): void {
  const useMetaForMod = isMacPlatform(navigator.platform);
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "k",
      metaKey: useMetaForMod,
      ctrlKey: !useMetaForMod,
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function triggerChatNewShortcutUntilPath(
  router: ReturnType<typeof getRouter>,
  predicate: (pathname: string) => boolean,
  errorMessage: string,
): Promise<string> {
  let pathname = router.state.location.pathname;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    dispatchChatNewShortcut();
    await waitForLayout();
    pathname = router.state.location.pathname;
    if (predicate(pathname)) {
      return pathname;
    }
  }
  throw new Error(`${errorMessage} Last path: ${pathname}`);
}

async function waitForNewThreadShortcutLabel(): Promise<void> {
  const newThreadButton = page.getByTestId("new-thread-button");
  await expect.element(newThreadButton).toBeInTheDocument();
  await newThreadButton.hover();
  const shortcutLabel = isMacPlatform(navigator.platform)
    ? "New thread (⇧⌘O)"
    : "New thread (Ctrl+Shift+O)";
  await expect.element(page.getByText(shortcutLabel)).toBeInTheDocument();
}

async function openProjectNewThreadPage(): Promise<void> {
  const newThreadButton = page.getByTestId("new-thread-button");
  await expect.element(newThreadButton).toBeInTheDocument();
  await newThreadButton.click();
  await expect.element(page.getByText("Let's build")).toBeInTheDocument();
  await expect.element(page.getByTestId("new-thread-prompt-input")).toBeInTheDocument();
}

async function submitNewThreadPage(): Promise<void> {
  const submitButton = page.getByTestId("create-thread-submit-button");
  await expect.element(submitButton).toBeInTheDocument();
  await submitButton.click();
}

async function openProjectNewThreadAndCreateDraft(): Promise<void> {
  await openProjectNewThreadPage();
  await submitNewThreadPage();
}

async function waitForImagesToLoad(scope: ParentNode): Promise<void> {
  const images = Array.from(scope.querySelectorAll("img"));
  if (images.length === 0) {
    return;
  }
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
  await waitForLayout();
}

async function measureUserRow(options: {
  host: HTMLElement;
  targetMessageId: MessageId;
}): Promise<UserRowMeasurement> {
  const { host, targetMessageId } = options;
  const rowSelector = `[data-message-id="${targetMessageId}"][data-message-role="user"]`;

  const scrollContainer = await waitForElement(
    () => host.querySelector<HTMLDivElement>("div.overflow-y-auto.overscroll-y-contain"),
    "Unable to find ChatView message scroll container.",
  );

  let row: HTMLElement | null = null;
  await vi.waitFor(
    async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await waitForLayout();
      row = host.querySelector<HTMLElement>(rowSelector);
      expect(row, "Unable to locate targeted user message row.").toBeTruthy();
    },
    {
      timeout: 8_000,
      interval: 16,
    },
  );

  await waitForImagesToLoad(row!);
  scrollContainer.scrollTop = 0;
  scrollContainer.dispatchEvent(new Event("scroll"));
  await nextFrame();

  const timelineRoot =
    row!.closest<HTMLElement>('[data-timeline-root="true"]') ??
    host.querySelector<HTMLElement>('[data-timeline-root="true"]');
  if (!(timelineRoot instanceof HTMLElement)) {
    throw new Error("Unable to locate timeline root container.");
  }

  let timelineWidthMeasuredPx = 0;
  let measuredRowHeightPx = 0;
  let renderedInVirtualizedRegion = false;
  await vi.waitFor(
    async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await nextFrame();
      const measuredRow = host.querySelector<HTMLElement>(rowSelector);
      expect(measuredRow, "Unable to measure targeted user row height.").toBeTruthy();
      timelineWidthMeasuredPx = timelineRoot.getBoundingClientRect().width;
      measuredRowHeightPx = measuredRow!.getBoundingClientRect().height;
      renderedInVirtualizedRegion = measuredRow!.closest("[data-index]") instanceof HTMLElement;
      expect(timelineWidthMeasuredPx, "Unable to measure timeline width.").toBeGreaterThan(0);
      expect(measuredRowHeightPx, "Unable to measure targeted user row height.").toBeGreaterThan(0);
    },
    {
      timeout: 4_000,
      interval: 16,
    },
  );

  return { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion };
}

async function mountChatView(options: {
  viewport: ViewportSpec;
  snapshot: OrchestrationReadModel;
  initialEntries?: string[];
  configureFixture?: (fixture: TestFixture) => void;
  resolveRpc?: (body: WsRequestEnvelope["body"]) => unknown | undefined;
}): Promise<MountedChatView> {
  fixture = buildFixture(options.snapshot);
  options.configureFixture?.(fixture);
  customWsRpcResolver = options.resolveRpc ?? null;
  await setViewport(options.viewport);
  await waitForProductionStyles();

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const router = getRouter(
    createMemoryHistory({
      initialEntries: options.initialEntries ?? [`/${THREAD_ID}`],
    }),
  );

  const screen = await render(<RouterProvider router={router} />, {
    container: host,
  });

  await waitForLayout();

  const cleanup = async () => {
    customWsRpcResolver = null;
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    measureUserRow: async (targetMessageId: MessageId) => measureUserRow({ host, targetMessageId }),
    setViewport: async (viewport: ViewportSpec) => {
      await setViewport(viewport);
      await waitForProductionStyles();
    },
    router,
  };
}

async function measureUserRowAtViewport(options: {
  snapshot: OrchestrationReadModel;
  targetMessageId: MessageId;
  viewport: ViewportSpec;
}): Promise<UserRowMeasurement> {
  const mounted = await mountChatView({
    viewport: options.viewport,
    snapshot: options.snapshot,
  });

  try {
    return await mounted.measureUserRow(options.targetMessageId);
  } finally {
    await mounted.cleanup();
  }
}

describe("ChatView timeline estimator parity (full app)", () => {
  beforeAll(async () => {
    fixture = buildFixture(
      createSnapshotForTargetUser({
        targetMessageId: "msg-user-bootstrap" as MessageId,
        targetText: "bootstrap",
      }),
    );
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: {
        url: "/mockServiceWorker.js",
      },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  beforeEach(async () => {
    await setViewport(DEFAULT_VIEWPORT);
    localStorage.clear();
    document.body.innerHTML = "";
    wsRequests.length = 0;
    customWsRpcResolver = null;
    attachmentResponseDelayMs = 0;
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
    useComposerQueueStore.setState({
      queuedMessagesByThreadId: {},
    });
    useStore.setState({
      projects: [],
      threads: [],
      threadsHydrated: false,
    });
    Reflect.deleteProperty(window, "desktopBridge");
  });

  afterEach(() => {
    customWsRpcResolver = null;
    attachmentResponseDelayMs = 0;
    document.body.innerHTML = "";
    Reflect.deleteProperty(window, "desktopBridge");
  });

  it.each(TEXT_VIEWPORT_MATRIX)(
    "keeps long user message estimate close at the $name viewport",
    async (viewport) => {
      const userText = "x".repeat(3_200);
      const targetMessageId = `msg-user-target-long-${viewport.name}` as MessageId;
      const mounted = await mountChatView({
        viewport,
        snapshot: createSnapshotForTargetUser({
          targetMessageId,
          targetText: userText,
        }),
      });

      try {
        const { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion } =
          await mounted.measureUserRow(targetMessageId);

        expect(renderedInVirtualizedRegion).toBe(true);

        const estimatedHeightPx = estimateTimelineMessageHeight(
          { role: "user", text: userText, attachments: [] },
          { timelineWidthPx: timelineWidthMeasuredPx },
        );

        expect(Math.abs(measuredRowHeightPx - estimatedHeightPx)).toBeLessThanOrEqual(
          viewport.textTolerancePx,
        );
      } finally {
        await mounted.cleanup();
      }
    },
  );

  it("tracks wrapping parity while resizing an existing ChatView across the viewport matrix", async () => {
    const userText = "x".repeat(3_200);
    const targetMessageId = "msg-user-target-resize" as MessageId;
    const mounted = await mountChatView({
      viewport: TEXT_VIEWPORT_MATRIX[0],
      snapshot: createSnapshotForTargetUser({
        targetMessageId,
        targetText: userText,
      }),
    });

    try {
      const measurements: Array<
        UserRowMeasurement & { viewport: ViewportSpec; estimatedHeightPx: number }
      > = [];

      for (const viewport of TEXT_VIEWPORT_MATRIX) {
        await mounted.setViewport(viewport);
        const measurement = await mounted.measureUserRow(targetMessageId);
        const estimatedHeightPx = estimateTimelineMessageHeight(
          { role: "user", text: userText, attachments: [] },
          { timelineWidthPx: measurement.timelineWidthMeasuredPx },
        );

        expect(measurement.renderedInVirtualizedRegion).toBe(true);
        expect(Math.abs(measurement.measuredRowHeightPx - estimatedHeightPx)).toBeLessThanOrEqual(
          viewport.textTolerancePx,
        );
        measurements.push({ ...measurement, viewport, estimatedHeightPx });
      }

      expect(
        new Set(measurements.map((measurement) => Math.round(measurement.timelineWidthMeasuredPx)))
          .size,
      ).toBeGreaterThanOrEqual(3);

      const byMeasuredWidth = measurements.toSorted(
        (left, right) => left.timelineWidthMeasuredPx - right.timelineWidthMeasuredPx,
      );
      const narrowest = byMeasuredWidth[0]!;
      const widest = byMeasuredWidth.at(-1)!;
      expect(narrowest.timelineWidthMeasuredPx).toBeLessThan(widest.timelineWidthMeasuredPx);
      expect(narrowest.measuredRowHeightPx).toBeGreaterThan(widest.measuredRowHeightPx);
      expect(narrowest.estimatedHeightPx).toBeGreaterThan(widest.estimatedHeightPx);
    } finally {
      await mounted.cleanup();
    }
  });

  it("tracks additional rendered wrapping when ChatView width narrows between desktop and mobile viewports", async () => {
    const userText = "x".repeat(2_400);
    const targetMessageId = "msg-user-target-wrap" as MessageId;
    const snapshot = createSnapshotForTargetUser({
      targetMessageId,
      targetText: userText,
    });
    const desktopMeasurement = await measureUserRowAtViewport({
      viewport: TEXT_VIEWPORT_MATRIX[0],
      snapshot,
      targetMessageId,
    });
    const mobileMeasurement = await measureUserRowAtViewport({
      viewport: TEXT_VIEWPORT_MATRIX[2],
      snapshot,
      targetMessageId,
    });

    const estimatedDesktopPx = estimateTimelineMessageHeight(
      { role: "user", text: userText, attachments: [] },
      { timelineWidthPx: desktopMeasurement.timelineWidthMeasuredPx },
    );
    const estimatedMobilePx = estimateTimelineMessageHeight(
      { role: "user", text: userText, attachments: [] },
      { timelineWidthPx: mobileMeasurement.timelineWidthMeasuredPx },
    );

    const measuredDeltaPx =
      mobileMeasurement.measuredRowHeightPx - desktopMeasurement.measuredRowHeightPx;
    const estimatedDeltaPx = estimatedMobilePx - estimatedDesktopPx;
    expect(measuredDeltaPx).toBeGreaterThan(0);
    expect(estimatedDeltaPx).toBeGreaterThan(0);
    const ratio = estimatedDeltaPx / measuredDeltaPx;
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(1.35);
  });

  it.each(ATTACHMENT_VIEWPORT_MATRIX)(
    "keeps user attachment estimate close at the $name viewport",
    async (viewport) => {
      const targetMessageId = `msg-user-target-attachments-${viewport.name}` as MessageId;
      const userText = "message with image attachments";
      const mounted = await mountChatView({
        viewport,
        snapshot: createSnapshotForTargetUser({
          targetMessageId,
          targetText: userText,
          targetAttachmentCount: 3,
        }),
      });

      try {
        const { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion } =
          await mounted.measureUserRow(targetMessageId);

        expect(renderedInVirtualizedRegion).toBe(true);

        const estimatedHeightPx = estimateTimelineMessageHeight(
          {
            role: "user",
            text: userText,
            attachments: [{ id: "attachment-1" }, { id: "attachment-2" }, { id: "attachment-3" }],
          },
          { timelineWidthPx: timelineWidthMeasuredPx },
        );

        expect(Math.abs(measuredRowHeightPx - estimatedHeightPx)).toBeLessThanOrEqual(
          viewport.attachmentTolerancePx,
        );
      } finally {
        await mounted.cleanup();
      }
    },
  );

  it("scrolls back to the bottom when reopening a thread", async () => {
    const baseSnapshot = createSnapshotForTargetUser({
      targetMessageId: "msg-user-reopen-scroll" as MessageId,
      targetText: "reopen thread scroll regression",
    });
    const primaryThread = baseSnapshot.threads[0];
    if (!primaryThread) {
      throw new Error("Expected fixture snapshot to include a primary thread.");
    }
    if (!primaryThread.session) {
      throw new Error("Expected fixture snapshot to include a primary thread session.");
    }
    const secondThreadMessages = primaryThread.messages.map((message, index) =>
      Object.assign({}, message, {
        id: `${SECOND_THREAD_ID}-message-${index}` as MessageId,
        text: `${message.text} second`,
        createdAt: isoAt(1_000 + index * 2),
        updatedAt: isoAt(1_001 + index * 2),
      }),
    );

    const secondThread: OrchestrationReadModel["threads"][number] = {
      ...primaryThread,
      id: SECOND_THREAD_ID,
      title: "Second browser test thread",
      createdAt: isoAt(900),
      updatedAt: isoAt(901),
      messages: secondThreadMessages,
      session: {
        ...primaryThread.session,
        threadId: SECOND_THREAD_ID,
        updatedAt: isoAt(902),
      },
    };

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: {
        ...baseSnapshot,
        threads: [primaryThread, secondThread],
      },
    });

    try {
      const initialScrollContainer = await waitForMessagesScrollContainer();
      await expectMessagesScrollContainerAtBottom(initialScrollContainer);

      initialScrollContainer.scrollTop = 0;
      initialScrollContainer.dispatchEvent(new Event("scroll"));
      await waitForLayout();

      await mounted.router.navigate({
        to: "/$threadId",
        params: { threadId: SECOND_THREAD_ID },
      });
      await waitForURL(
        mounted.router,
        (pathname) => pathname === `/${SECOND_THREAD_ID}`,
        "Route should change to the second thread.",
      );
      await waitForLayout();

      await mounted.router.navigate({
        to: "/$threadId",
        params: { threadId: THREAD_ID },
      });
      await waitForURL(
        mounted.router,
        (pathname) => pathname === `/${THREAD_ID}`,
        "Route should change back to the original thread.",
      );

      const reopenedScrollContainer = await waitForMessagesScrollContainer();
      await expectMessagesScrollContainerAtBottom(reopenedScrollContainer);
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps a single scroll-to-bottom click pinned while late image layout settles", async () => {
    attachmentResponseDelayMs = 350;
    const baseSnapshot = createSnapshotForTargetUser({
      targetMessageId: "msg-user-scroll-button" as MessageId,
      targetText: "scroll button regression",
    });
    const primaryThread = baseSnapshot.threads[0];
    if (!primaryThread) {
      throw new Error("Expected fixture snapshot to include a primary thread.");
    }
    const lastUserMessageIndex = primaryThread.messages.findLastIndex(
      (message) => message.role === "user",
    );
    if (lastUserMessageIndex < 0) {
      throw new Error("Expected fixture snapshot to include a user message.");
    }
    const tailAttachmentMessage = primaryThread.messages[lastUserMessageIndex];
    if (!tailAttachmentMessage || tailAttachmentMessage.role !== "user") {
      throw new Error("Expected fixture snapshot to include a tail user message.");
    }
    const messagesWithTailAttachment = primaryThread.messages.slice();
    messagesWithTailAttachment[lastUserMessageIndex] = {
      ...tailAttachmentMessage,
      attachments: [
        {
          type: "image" as const,
          id: "tail-attachment",
          name: "tail-attachment.png",
          mimeType: "image/png",
          sizeBytes: 128,
        },
      ],
    };

    const snapshotWithTailAttachment: OrchestrationReadModel = {
      ...baseSnapshot,
      threads: [
        {
          ...primaryThread,
          messages: messagesWithTailAttachment,
        },
      ],
    };

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: snapshotWithTailAttachment,
    });

    try {
      const scrollContainer = await waitForMessagesScrollContainer();
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await waitForLayout();

      const scrollToBottomButton = page.getByRole("button", { name: "Scroll to bottom" });
      await expect.element(scrollToBottomButton).toBeInTheDocument();
      await scrollToBottomButton.click();

      await waitForElement(
        () => document.querySelector<HTMLImageElement>('img[alt="tail-attachment.png"]'),
        "Unable to find delayed tail attachment image.",
      );
      await waitForImagesToLoad(document);
      await expectMessagesScrollContainerAtBottom(scrollContainer);
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the project cwd for draft threads without a worktree path", async () => {
    setDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode"],
        };
      },
    });

    try {
      const openButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Open",
          ) as HTMLButtonElement | null,
        "Unable to find Open button.",
      );
      openButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscode",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the project cwd with VS Code Insiders when it is the only available editor", async () => {
    setDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode-insiders"],
        };
      },
    });

    try {
      const openButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Open",
          ) as HTMLButtonElement | null,
        "Unable to find Open button.",
      );
      openButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscode-insiders",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("filters the open picker menu and opens VSCodium from the menu", async () => {
    setDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode-insiders", "vscodium"],
        };
      },
    });

    try {
      const menuButton = await waitForElement(
        () => document.querySelector('button[aria-label="Copy options"]'),
        "Unable to find Open picker button.",
      );
      (menuButton as HTMLButtonElement).click();

      await waitForElement(
        () =>
          Array.from(document.querySelectorAll('[data-slot="menu-item"]')).find((item) =>
            item.textContent?.includes("VS Code Insiders"),
          ) ?? null,
        "Unable to find VS Code Insiders menu item.",
      );

      expect(
        Array.from(document.querySelectorAll('[data-slot="menu-item"]')).some((item) =>
          item.textContent?.includes("Zed"),
        ),
      ).toBe(false);

      const vscodiumItem = await waitForElement(
        () =>
          Array.from(document.querySelectorAll('[data-slot="menu-item"]')).find((item) =>
            item.textContent?.includes("VSCodium"),
          ) ?? null,
        "Unable to find VSCodium menu item.",
      );
      (vscodiumItem as HTMLElement).click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscodium",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back to the first installed editor when the stored favorite is unavailable", async () => {
    localStorage.setItem("flow:last-editor", "vscodium");
    setDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode-insiders"],
        };
      },
    });

    try {
      const openButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Open",
          ) as HTMLButtonElement | null,
        "Unable to find Open button.",
      );
      openButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscode-insiders",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("runs project scripts from local draft threads at the project cwd", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceId: null,
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "lint",
          name: "Lint",
          command: "bun run lint",
          icon: "lint",
          runOnWorktreeCreate: false,
        },
      ]),
    });

    try {
      const runButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.title === "Run Lint",
          ) as HTMLButtonElement | null,
        "Unable to find Run Lint button.",
      );
      runButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.terminalOpen,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.terminalOpen,
            threadId: THREAD_ID,
            cwd: "/repo/project",
            env: {
              FLOW_PROJECT_ROOT: "/repo/project",
            },
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          const writeRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.terminalWrite,
          );
          expect(writeRequest).toMatchObject({
            _tag: WS_METHODS.terminalWrite,
            threadId: THREAD_ID,
            data: "bun run lint\r",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("runs project scripts from worktree draft threads at the worktree cwd", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceId: null,
          branch: "feature/draft",
          worktreePath: "/repo/worktrees/feature-draft",
          envMode: "worktree",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "test",
          name: "Test",
          command: "bun run test",
          icon: "test",
          runOnWorktreeCreate: false,
        },
      ]),
    });

    try {
      const runButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.title === "Run Test",
          ) as HTMLButtonElement | null,
        "Unable to find Run Test button.",
      );
      runButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.terminalOpen,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.terminalOpen,
            threadId: THREAD_ID,
            cwd: "/repo/worktrees/feature-draft",
            env: {
              FLOW_PROJECT_ROOT: "/repo/project",
              FLOW_WORKTREE_PATH: "/repo/worktrees/feature-draft",
            },
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("runs setup scripts after preparing a pull request worktree thread", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceId: null,
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "setup",
          name: "Setup",
          command: "bun install",
          icon: "configure",
          runOnWorktreeCreate: true,
        },
      ]),
      resolveRpc: (body) => {
        if (body._tag === WS_METHODS.gitResolvePullRequest) {
          return {
            pullRequest: {
              number: 1359,
              title: "Add thread archiving and settings navigation",
              url: "https://github.com/pingdotgg/flow/pull/1359",
              baseBranch: "main",
              headBranch: "archive-settings-overhaul",
              state: "open",
            },
          };
        }
        if (body._tag === WS_METHODS.gitPreparePullRequestThread) {
          return {
            pullRequest: {
              number: 1359,
              title: "Add thread archiving and settings navigation",
              url: "https://github.com/pingdotgg/flow/pull/1359",
              baseBranch: "main",
              headBranch: "archive-settings-overhaul",
              state: "open",
            },
            branch: "archive-settings-overhaul",
            worktreePath: "/repo/worktrees/pr-1359",
          };
        }
        return undefined;
      },
    });

    try {
      const branchButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "main",
          ) as HTMLButtonElement | null,
        "Unable to find branch selector button.",
      );
      branchButton.click();

      const branchInput = await waitForElement(
        () => document.querySelector<HTMLInputElement>('input[placeholder="Search branches..."]'),
        "Unable to find branch search input.",
      );
      branchInput.focus();
      await page.getByPlaceholder("Search branches...").fill("1359");

      const checkoutItem = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("span")).find(
            (element) => element.textContent?.trim() === "Checkout Pull Request",
          ) as HTMLSpanElement | null,
        "Unable to find checkout pull request option.",
      );
      checkoutItem.click();

      const worktreeButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Worktree",
          ) as HTMLButtonElement | null,
        "Unable to find Worktree button.",
      );
      worktreeButton.click();

      await vi.waitFor(
        () => {
          const prepareRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.gitPreparePullRequestThread,
          );
          expect(prepareRequest).toMatchObject({
            _tag: WS_METHODS.gitPreparePullRequestThread,
            cwd: "/repo/project",
            reference: "1359",
            mode: "worktree",
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) =>
              request._tag === WS_METHODS.terminalOpen && request.cwd === "/repo/worktrees/pr-1359",
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.terminalOpen,
            threadId: expect.any(String),
            cwd: "/repo/worktrees/pr-1359",
            env: {
              FLOW_PROJECT_ROOT: "/repo/project",
              FLOW_WORKTREE_PATH: "/repo/worktrees/pr-1359",
            },
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          const writeRequest = wsRequests.find(
            (request) =>
              request._tag === WS_METHODS.terminalWrite && request.data === "bun install\r",
          );
          expect(writeRequest).toMatchObject({
            _tag: WS_METHODS.terminalWrite,
            threadId: expect.any(String),
            data: "bun install\r",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("toggles plan mode with Shift+Tab only while the composer is focused", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-target-hotkey" as MessageId,
        targetText: "hotkey target",
      }),
    });

    try {
      const initialModeButton = await waitForInteractionModeButton("Chat");
      expect(initialModeButton.title).toContain("enter plan mode");

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await waitForLayout();

      expect((await waitForInteractionModeButton("Chat")).title).toContain("enter plan mode");

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        async () => {
          expect((await waitForInteractionModeButton("Plan")).title).toContain(
            "return to normal chat mode",
          );
        },
        { timeout: 8_000, interval: 16 },
      );

      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        async () => {
          expect((await waitForInteractionModeButton("Chat")).title).toContain("enter plan mode");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("queues the current composer draft when Tab is pressed in the composer", async () => {
    useComposerDraftStore.getState().setPrompt(THREAD_ID, "queue this with tab");

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-target-queue-tab" as MessageId,
        targetText: "queue hotkey target",
        sessionStatus: "running",
      }),
    });

    try {
      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        () => {
          const queuedMessages =
            useComposerQueueStore.getState().queuedMessagesByThreadId[THREAD_ID] ?? [];
          expect(queuedMessages).toHaveLength(1);
          expect(queuedMessages[0]?.summary).toBe("queue this with tab");
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.prompt ?? "").toBe(
            "",
          );
        },
        { timeout: 8_000, interval: 16 },
      );

      expect(
        wsRequests.some((request) => {
          const command = request.command as { type?: string } | undefined;
          return (
            request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
            command?.type === "thread.turn.start"
          );
        }),
      ).toBe(false);
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps removed terminal context pills removed when a new one is added", async () => {
    const removedLabel = "Terminal 1 lines 1-2";
    const addedLabel = "Terminal 2 lines 9-10";
    useComposerDraftStore.getState().addTerminalContext(
      THREAD_ID,
      createTerminalContext({
        id: "ctx-removed",
        terminalLabel: "Terminal 1",
        lineStart: 1,
        lineEnd: 2,
        text: "bun i\nno changes",
      }),
    );

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-terminal-pill-backspace" as MessageId,
        targetText: "terminal pill backspace target",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(removedLabel);
        },
        { timeout: 8_000, interval: 16 },
      );

      const store = useComposerDraftStore.getState();
      const currentPrompt = store.draftsByThreadId[THREAD_ID]?.prompt ?? "";
      const nextPrompt = removeInlineTerminalContextPlaceholder(currentPrompt, 0);
      store.setPrompt(THREAD_ID, nextPrompt.prompt);
      store.removeTerminalContext(THREAD_ID, "ctx-removed");

      await vi.waitFor(
        () => {
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]).toBeUndefined();
          expect(document.body.textContent).not.toContain(removedLabel);
        },
        { timeout: 8_000, interval: 16 },
      );

      useComposerDraftStore.getState().addTerminalContext(
        THREAD_ID,
        createTerminalContext({
          id: "ctx-added",
          terminalLabel: "Terminal 2",
          lineStart: 9,
          lineEnd: 10,
          text: "git status\nOn branch main",
        }),
      );

      await vi.waitFor(
        () => {
          const draft = useComposerDraftStore.getState().draftsByThreadId[THREAD_ID];
          expect(draft?.terminalContexts.map((context) => context.id)).toEqual(["ctx-added"]);
          expect(document.body.textContent).toContain(addedLabel);
          expect(document.body.textContent).not.toContain(removedLabel);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("disables send when the composer only contains an expired terminal pill", async () => {
    const expiredLabel = "Terminal 1 line 4";
    useComposerDraftStore.getState().addTerminalContext(
      THREAD_ID,
      createTerminalContext({
        id: "ctx-expired-only",
        terminalLabel: "Terminal 1",
        lineStart: 4,
        lineEnd: 4,
        text: "",
      }),
    );

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-expired-pill-disabled" as MessageId,
        targetText: "expired pill disabled target",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(expiredLabel);
        },
        { timeout: 8_000, interval: 16 },
      );

      const sendButton = await waitForSendButton();
      expect(sendButton.disabled).toBe(true);
    } finally {
      await mounted.cleanup();
    }
  });

  it("warns when sending text while omitting expired terminal pills", async () => {
    const expiredLabel = "Terminal 1 line 4";
    useComposerDraftStore.getState().addTerminalContext(
      THREAD_ID,
      createTerminalContext({
        id: "ctx-expired-send-warning",
        terminalLabel: "Terminal 1",
        lineStart: 4,
        lineEnd: 4,
        text: "",
      }),
    );
    useComposerDraftStore
      .getState()
      .setPrompt(THREAD_ID, `yoo${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}waddup`);

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-expired-pill-warning" as MessageId,
        targetText: "expired pill warning target",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(expiredLabel);
        },
        { timeout: 8_000, interval: 16 },
      );

      const sendButton = await waitForSendButton();
      expect(sendButton.disabled).toBe(false);
      sendButton.click();

      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(
            "Expired terminal context omitted from message",
          );
          expect(document.body.textContent).not.toContain(expiredLabel);
          expect(document.body.textContent).toContain("yoowaddup");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("drops a stale workspace id before creating a server thread from a local draft", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceId: WORKSPACE_ID,
          branch: "feature-stale",
          worktreePath: "/repo/project/.t3/worktrees/feature-stale",
          envMode: "worktree",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });
    useComposerDraftStore.getState().setPrompt(THREAD_ID, "ship it");

    const draftMounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
    });

    try {
      const sendButton = await waitForSendButton();
      expect(sendButton.disabled).toBe(false);
      sendButton.click();

      await vi.waitFor(
        () => {
          const createRequest = wsRequests.find((request) => {
            const command = request.command as
              | { type?: string; workspaceId?: WorkspaceId | null; worktreePath?: string | null }
              | undefined;
            return (
              request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              command?.type === "thread.create"
            );
          });
          expect(createRequest).toBeTruthy();
          const command = createRequest?.command as {
            workspaceId?: WorkspaceId | null;
            branch?: string | null;
            worktreePath?: string | null;
          };
          expect(command.workspaceId).toBeNull();
          expect(command.branch).toBe("feature-stale");
          expect(command.worktreePath).toBe("/repo/project/.t3/worktrees/feature-stale");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await draftMounted.cleanup();
    }
  });

  it("shows a pointer cursor for the running stop button", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-stop-button-cursor" as MessageId,
        targetText: "stop button cursor target",
        sessionStatus: "running",
      }),
    });

    try {
      const stopButton = await waitForElement(
        () => document.querySelector<HTMLButtonElement>('button[aria-label="Stop generation"]'),
        "Unable to find stop generation button.",
      );

      expect(getComputedStyle(stopButton).cursor).toBe("pointer");
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the create-thread page from the global sidebar button", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-global-new-thread-page" as MessageId,
        targetText: "global new thread page",
      }),
    });

    try {
      const globalNewThreadButton = page.getByTestId("global-new-thread-button");
      await expect.element(globalNewThreadButton).toBeInTheDocument();

      await globalNewThreadButton.click();

      await waitForURL(
        mounted.router,
        (path) => path === "/",
        "Route should have changed to the create-thread page.",
      );
      await expect.element(page.getByText("Let's build")).toBeInTheDocument();
      await expect.element(page.getByTestId("new-thread-prompt-input")).toBeInTheDocument();
      await expect.element(page.getByTestId("create-thread-submit-button")).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("preselects the project on the create-thread page when opened from a repo row", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-project-new-thread-page" as MessageId,
        targetText: "project new thread page",
      }),
    });

    try {
      await openProjectNewThreadPage();

      await waitForURL(
        mounted.router,
        (path) => path === "/",
        "Route should have changed to the project-scoped create-thread page.",
      );
      await vi.waitFor(() => {
        const trigger = document.querySelector('[data-testid="new-thread-project-select"]');
        expect(trigger?.textContent).toContain("Project");
      });
      await expect.element(page.getByTestId("create-thread-submit-button")).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("defaults the global create-thread page to the most recently used project", async () => {
    const baseSnapshot = createSnapshotForTargetUser({
      targetMessageId: "msg-user-global-new-thread-default-project" as MessageId,
      targetText: "global new thread default project",
    });
    const snapshotWithSecondProject: OrchestrationReadModel = {
      ...baseSnapshot,
      projects: [
        ...baseSnapshot.projects,
        {
          id: SECOND_PROJECT_ID,
          title: "Second Project",
          workspaceRoot: "/repo/second-project",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5",
          },
          scripts: [],
          createdAt: NOW_ISO,
          updatedAt: NOW_ISO,
          deletedAt: null,
        },
      ],
      threads: [
        ...baseSnapshot.threads,
        {
          id: SECOND_THREAD_ID,
          projectId: SECOND_PROJECT_ID,
          workspaceId: null,
          title: "Second browser test thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5",
          },
          interactionMode: "default",
          runtimeMode: "full-access",
          branch: "main",
          worktreePath: null,
          latestTurn: null,
          createdAt: NOW_ISO,
          updatedAt: NOW_ISO,
          archivedAt: null,
          deletedAt: null,
          messages: [],
          activities: [],
          proposedPlans: [],
          checkpoints: [],
          session: {
            threadId: SECOND_THREAD_ID,
            status: "ready",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: NOW_ISO,
          },
        },
      ],
    };
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: snapshotWithSecondProject,
    });

    try {
      useStore.setState({ threadMruIds: [SECOND_THREAD_ID, THREAD_ID] });

      const globalNewThreadButton = page.getByTestId("global-new-thread-button");
      await globalNewThreadButton.click();

      await waitForURL(
        mounted.router,
        (path) => path === "/",
        "Route should have changed to the create-thread page.",
      );
      await vi.waitFor(() => {
        const trigger = document.querySelector('[data-testid="new-thread-project-select"]');
        expect(trigger?.textContent).toContain("Second Project");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("lets you choose a workspace from the create-thread page", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withWorkspace(
        createSnapshotForTargetUser({
          targetMessageId: "msg-user-new-thread-workspace-select" as MessageId,
          targetText: "new thread workspace select",
        }),
      ),
    });

    try {
      await openProjectNewThreadPage();

      const targetSelect = page.getByTestId("new-thread-target-select");
      await expect.element(targetSelect).toBeInTheDocument();

      await targetSelect.click();
      await page.getByText("feature-flow").first().click();
      await submitNewThreadPage();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftThreadsByThreadId[newThreadId]).toMatchObject({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        branch: "feature-flow",
        worktreePath: "/repo/project/.t3/worktrees/feature-flow",
        envMode: "worktree",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("lets you choose a new workspace from the create-thread page", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withWorkspace(
        createSnapshotForTargetUser({
          targetMessageId: "msg-user-new-thread-new-workspace-select" as MessageId,
          targetText: "new thread new workspace select",
        }),
      ),
    });

    try {
      await openProjectNewThreadPage();

      const targetSelect = page.getByTestId("new-thread-target-select");
      await expect.element(targetSelect).toBeInTheDocument();

      await targetSelect.click();
      await page.getByText("New workspace").first().click();
      await submitNewThreadPage();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;
      const draftThread = useComposerDraftStore.getState().draftThreadsByThreadId[newThreadId];
      const workspaceCreateRequest = wsRequests.find(
        (request) =>
          request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
          request.type === "workspace.create",
      );

      expect(workspaceCreateRequest).toMatchObject({
        projectId: PROJECT_ID,
        branch: expect.stringMatching(/^flow\//),
      });
      expect(draftThread).toMatchObject({
        projectId: PROJECT_ID,
        workspaceId: workspaceCreateRequest?.workspaceId,
        branch: workspaceCreateRequest?.branch,
        worktreePath: workspaceCreateRequest?.worktreePath,
        envMode: "worktree",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("carries the create-page prompt into the draft composer", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-new-thread-prompt-handoff" as MessageId,
        targetText: "new thread prompt handoff",
      }),
    });

    try {
      await openProjectNewThreadPage();

      const promptInput = page.getByTestId("new-thread-prompt-input");
      await promptInput.fill("Investigate the failing browser test");
      await submitNewThreadPage();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      await waitForComposerEditor();
      expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]?.prompt).toBe(
        "Investigate the failing browser test",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the new thread selected after clicking the new-thread button", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-new-thread-test" as MessageId,
        targetText: "new thread selection test",
      }),
    });

    try {
      await openProjectNewThreadAndCreateDraft();

      // The route should change to a new draft thread ID.
      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      // The composer editor should be present for the new draft thread.
      await waitForComposerEditor();

      // Simulate the snapshot sync arriving from the server after the draft
      // thread has been promoted to a server thread (thread.create + turn.start
      // succeeded). The snapshot now includes the new thread, and the sync
      // should clear the draft without disrupting the route.
      const { syncServerReadModel } = useStore.getState();
      syncServerReadModel(addThreadToSnapshot(fixture.snapshot, newThreadId));

      // Clear the draft now that the server thread exists (mirrors EventRouter behavior).
      useComposerDraftStore.getState().clearDraftThread(newThreadId);

      // The route should still be on the new thread — not redirected away.
      await waitForURL(
        mounted.router,
        (path) => path === newThreadPath,
        "New thread should remain selected after snapshot sync clears the draft.",
      );

      // The empty thread view and composer should still be visible.
      await expect
        .element(page.getByText("Send a message to start the conversation."))
        .toBeInTheDocument();
      await expect.element(page.getByTestId("composer-editor")).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates a local draft from the repo-row new-thread button even when the default env is worktree", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-new-thread-local-test" as MessageId,
        targetText: "new thread local mode test",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          settings: {
            ...nextFixture.serverConfig.settings,
            defaultThreadEnvMode: "worktree",
          },
        };
      },
    });

    try {
      await openProjectNewThreadAndCreateDraft();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftThreadsByThreadId[newThreadId]).toMatchObject({
        projectId: PROJECT_ID,
        envMode: "local",
        workspaceId: null,
        branch: null,
        worktreePath: null,
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("archives a session from the workspace tab x with confirmation", async () => {
    const confirmMessages: string[] = [];
    const confirmResult = vi.fn(async (message: string) => {
      confirmMessages.push(message);
      return true;
    });
    const desktopBridge = {
      getWsUrl: () => null,
      pickFolder: async () => null,
      confirm: confirmResult,
      setTheme: async () => undefined,
      showContextMenu: async () => null,
      openExternal: async () => true,
      onMenuAction: () => () => undefined,
      getUpdateState: async () => ({
        enabled: false,
        status: "disabled" as const,
        currentVersion: "0.0.0",
        hostArch: "arm64" as const,
        appArch: "arm64" as const,
        runningUnderArm64Translation: false,
        availableVersion: null,
        downloadedVersion: null,
        downloadPercent: null,
        checkedAt: null,
        message: null,
        errorContext: null,
        canRetry: false,
      }),
      checkForUpdate: async () => ({
        checked: false,
        state: {
          enabled: false,
          status: "disabled" as const,
          currentVersion: "0.0.0",
          hostArch: "arm64" as const,
          appArch: "arm64" as const,
          runningUnderArm64Translation: false,
          availableVersion: null,
          downloadedVersion: null,
          downloadPercent: null,
          checkedAt: null,
          message: null,
          errorContext: null,
          canRetry: false,
        },
      }),
      downloadUpdate: async () => ({
        accepted: false,
        completed: false,
        state: {
          enabled: false,
          status: "disabled" as const,
          currentVersion: "0.0.0",
          hostArch: "arm64" as const,
          appArch: "arm64" as const,
          runningUnderArm64Translation: false,
          availableVersion: null,
          downloadedVersion: null,
          downloadPercent: null,
          checkedAt: null,
          message: null,
          errorContext: null,
          canRetry: false,
        },
      }),
      installUpdate: async () => ({
        accepted: false,
        completed: false,
        state: {
          enabled: false,
          status: "disabled" as const,
          currentVersion: "0.0.0",
          hostArch: "arm64" as const,
          appArch: "arm64" as const,
          runningUnderArm64Translation: false,
          availableVersion: null,
          downloadedVersion: null,
          downloadPercent: null,
          checkedAt: null,
          message: null,
          errorContext: null,
          canRetry: false,
        },
      }),
      onUpdateState: () => () => undefined,
    } as NonNullable<Window["desktopBridge"]>;
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: desktopBridge,
    });

    const workspaceSnapshot = withWorkspace(
      createSnapshotForTargetUser({
        targetMessageId: "msg-user-tab-archive-test" as MessageId,
        targetText: "tab archive test",
      }),
      { title: "Flow Workspace" },
    );
    const primaryThread = workspaceSnapshot.threads[0];
    if (!primaryThread) {
      throw new Error("Expected fixture snapshot to include a primary thread.");
    }
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: {
        ...workspaceSnapshot,
        threads: [
          primaryThread,
          {
            ...primaryThread,
            id: SECOND_THREAD_ID,
            title: "Second session",
            createdAt: isoAt(240),
            updatedAt: isoAt(300),
          },
        ],
      },
    });

    try {
      const archiveButton = page.getByRole("button", { name: "Archive Second session" });
      await expect.element(archiveButton).toBeInTheDocument();
      await archiveButton.click();

      await vi.waitFor(
        () => {
          expect(confirmResult).toHaveBeenCalledTimes(1);
          expect(
            wsRequests.some((request) => {
              const command = request.command as { type?: string; threadId?: ThreadId } | undefined;
              return (
                request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
                command?.type === "thread.archive" &&
                command.threadId === SECOND_THREAD_ID
              );
            }),
          ).toBe(true);
        },
        { timeout: 8_000, interval: 16 },
      );

      expect(confirmMessages).toEqual([
        'Archive thread "Second session"?\nYou can restore it later from Settings > Archive.',
      ]);
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps workspace context when archiving the active workspace session", async () => {
    const confirmResult = vi.fn(async () => true);
    const desktopBridge = {
      getWsUrl: () => null,
      pickFolder: async () => null,
      confirm: confirmResult,
      setTheme: async () => undefined,
      showContextMenu: async () => null,
      openExternal: async () => true,
      onMenuAction: () => () => undefined,
      getUpdateState: async () => ({
        enabled: false,
        status: "disabled" as const,
        currentVersion: "0.0.0",
        hostArch: "arm64" as const,
        appArch: "arm64" as const,
        runningUnderArm64Translation: false,
        availableVersion: null,
        downloadedVersion: null,
        downloadPercent: null,
        checkedAt: null,
        message: null,
        errorContext: null,
        canRetry: false,
      }),
      checkForUpdate: async () => ({
        checked: false,
        state: {
          enabled: false,
          status: "disabled" as const,
          currentVersion: "0.0.0",
          hostArch: "arm64" as const,
          appArch: "arm64" as const,
          runningUnderArm64Translation: false,
          availableVersion: null,
          downloadedVersion: null,
          downloadPercent: null,
          checkedAt: null,
          message: null,
          errorContext: null,
          canRetry: false,
        },
      }),
      downloadUpdate: async () => ({
        accepted: false,
        completed: false,
        state: {
          enabled: false,
          status: "disabled" as const,
          currentVersion: "0.0.0",
          hostArch: "arm64" as const,
          appArch: "arm64" as const,
          runningUnderArm64Translation: false,
          availableVersion: null,
          downloadedVersion: null,
          downloadPercent: null,
          checkedAt: null,
          message: null,
          errorContext: null,
          canRetry: false,
        },
      }),
      installUpdate: async () => ({
        accepted: false,
        completed: false,
        state: {
          enabled: false,
          status: "disabled" as const,
          currentVersion: "0.0.0",
          hostArch: "arm64" as const,
          appArch: "arm64" as const,
          runningUnderArm64Translation: false,
          availableVersion: null,
          downloadedVersion: null,
          downloadPercent: null,
          checkedAt: null,
          message: null,
          errorContext: null,
          canRetry: false,
        },
      }),
      onUpdateState: () => () => undefined,
    } as NonNullable<Window["desktopBridge"]>;
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: desktopBridge,
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withWorkspace(
        createSnapshotForTargetUser({
          targetMessageId: "msg-user-active-tab-archive-test" as MessageId,
          targetText: "active tab archive test",
        }),
        { title: "Flow Workspace" },
      ),
    });

    try {
      await page.getByRole("button", { name: "Archive Browser test thread" }).click();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID after archiving the active workspace session.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(confirmResult).toHaveBeenCalledTimes(1);
      expect(useComposerDraftStore.getState().draftThreadsByThreadId[newThreadId]).toMatchObject({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        branch: "feature-flow",
        worktreePath: "/repo/project/.t3/worktrees/feature-flow",
        envMode: "worktree",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("archives a workspace and its active threads from the sidebar context menu", async () => {
    const contextMenuSelections: string[][] = [];
    const confirmMessages: string[] = [];
    const contextMenuResult = vi.fn(async () => "archive");
    const confirmResult = vi.fn(async (message: string) => {
      confirmMessages.push(message);
      return true;
    });
    const desktopBridge = {
      getWsUrl: () => null,
      pickFolder: async () => null,
      confirm: confirmResult,
      setTheme: async () => undefined,
      showContextMenu: async (items: ReadonlyArray<{ id: string }>) => {
        contextMenuSelections.push(items.map((item) => item.id));
        return contextMenuResult();
      },
      openExternal: async () => true,
      onMenuAction: () => () => undefined,
      getUpdateState: async () => ({
        enabled: false,
        status: "disabled" as const,
        currentVersion: "0.0.0",
        hostArch: "arm64" as const,
        appArch: "arm64" as const,
        runningUnderArm64Translation: false,
        availableVersion: null,
        downloadedVersion: null,
        downloadPercent: null,
        checkedAt: null,
        message: null,
        errorContext: null,
        canRetry: false,
      }),
      checkForUpdate: async () => ({
        checked: false,
        state: {
          enabled: false,
          status: "disabled" as const,
          currentVersion: "0.0.0",
          hostArch: "arm64" as const,
          appArch: "arm64" as const,
          runningUnderArm64Translation: false,
          availableVersion: null,
          downloadedVersion: null,
          downloadPercent: null,
          checkedAt: null,
          message: null,
          errorContext: null,
          canRetry: false,
        },
      }),
      downloadUpdate: async () => ({
        accepted: false,
        completed: false,
        state: {
          enabled: false,
          status: "disabled" as const,
          currentVersion: "0.0.0",
          hostArch: "arm64" as const,
          appArch: "arm64" as const,
          runningUnderArm64Translation: false,
          availableVersion: null,
          downloadedVersion: null,
          downloadPercent: null,
          checkedAt: null,
          message: null,
          errorContext: null,
          canRetry: false,
        },
      }),
      installUpdate: async () => ({
        accepted: false,
        completed: false,
        state: {
          enabled: false,
          status: "disabled" as const,
          currentVersion: "0.0.0",
          hostArch: "arm64" as const,
          appArch: "arm64" as const,
          runningUnderArm64Translation: false,
          availableVersion: null,
          downloadedVersion: null,
          downloadPercent: null,
          checkedAt: null,
          message: null,
          errorContext: null,
          canRetry: false,
        },
      }),
      onUpdateState: () => () => undefined,
    } as NonNullable<Window["desktopBridge"]>;
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: desktopBridge,
    });

    const draftThreadId = "draft-workspace-archive" as ThreadId;
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [draftThreadId]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceId: WORKSPACE_ID,
          branch: "feature-flow",
          worktreePath: "/repo/project/.t3/worktrees/feature-flow",
          envMode: "worktree",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: draftThreadId,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withWorkspace(
        createSnapshotForTargetUser({
          targetMessageId: "msg-user-workspace-archive-test" as MessageId,
          targetText: "workspace archive test",
        }),
        { title: "Flow Workspace" },
      ),
    });

    try {
      const workspaceLabel = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("span")).find(
            (element) => element.textContent?.trim() === "Flow Workspace",
          ) ?? null,
        "Unable to find workspace row.",
      );

      workspaceLabel.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 32,
          clientY: 32,
          button: 2,
        }),
      );
      await waitForLayout();

      await vi.waitFor(
        () => {
          expect(contextMenuResult).toHaveBeenCalledTimes(1);
          expect(confirmResult).toHaveBeenCalledTimes(1);
          expect(
            wsRequests.some((request) => {
              const command = request.command as { type?: string; threadId?: ThreadId } | undefined;
              return (
                request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
                command?.type === "thread.archive" &&
                command.threadId === THREAD_ID
              );
            }),
          ).toBe(true);
          expect(
            wsRequests.some((request) => {
              const command = request.command as
                | { type?: string; workspaceId?: WorkspaceId }
                | undefined;
              return (
                request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
                command?.type === "workspace.delete" &&
                command.workspaceId === WORKSPACE_ID
              );
            }),
          ).toBe(true);
        },
        { timeout: 8_000, interval: 16 },
      );

      expect(contextMenuSelections).toEqual([
        ["rename", "copy-path", "new-session", "archive", "delete"],
      ]);
      expect(confirmMessages).toEqual([
        'Archive workspace "Flow Workspace"?\n1 active session will be archived and removed from this workspace.\nThe worktree will be kept on disk.',
      ]);
      await vi.waitFor(
        () => {
          expect(
            useComposerDraftStore.getState().draftThreadsByThreadId[draftThreadId],
          ).toMatchObject({
            workspaceId: null,
            branch: null,
            worktreePath: null,
            envMode: "local",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("deletes a workspace from the sidebar context menu", async () => {
    const contextMenuSelections: string[][] = [];
    const confirmMessages: string[] = [];
    const contextMenuResult = vi.fn(async () => "delete");
    const confirmResult = vi.fn(async (message: string) => {
      confirmMessages.push(message);
      return true;
    });
    const desktopBridge = {
      getWsUrl: () => null,
      pickFolder: async () => null,
      confirm: confirmResult,
      setTheme: async () => undefined,
      showContextMenu: async (items: ReadonlyArray<{ id: string }>) => {
        contextMenuSelections.push(items.map((item) => item.id));
        return contextMenuResult();
      },
      openExternal: async () => true,
      onMenuAction: () => () => undefined,
      getUpdateState: async () => ({
        enabled: false,
        status: "disabled" as const,
        currentVersion: "0.0.0",
        hostArch: "arm64" as const,
        appArch: "arm64" as const,
        runningUnderArm64Translation: false,
        availableVersion: null,
        downloadedVersion: null,
        downloadPercent: null,
        checkedAt: null,
        message: null,
        errorContext: null,
        canRetry: false,
      }),
      checkForUpdate: async () => ({
        checked: false,
        state: {
          enabled: false,
          status: "disabled" as const,
          currentVersion: "0.0.0",
          hostArch: "arm64" as const,
          appArch: "arm64" as const,
          runningUnderArm64Translation: false,
          availableVersion: null,
          downloadedVersion: null,
          downloadPercent: null,
          checkedAt: null,
          message: null,
          errorContext: null,
          canRetry: false,
        },
      }),
      downloadUpdate: async () => ({
        accepted: false,
        completed: false,
        state: {
          enabled: false,
          status: "disabled" as const,
          currentVersion: "0.0.0",
          hostArch: "arm64" as const,
          appArch: "arm64" as const,
          runningUnderArm64Translation: false,
          availableVersion: null,
          downloadedVersion: null,
          downloadPercent: null,
          checkedAt: null,
          message: null,
          errorContext: null,
          canRetry: false,
        },
      }),
      installUpdate: async () => ({
        accepted: false,
        completed: false,
        state: {
          enabled: false,
          status: "disabled" as const,
          currentVersion: "0.0.0",
          hostArch: "arm64" as const,
          appArch: "arm64" as const,
          runningUnderArm64Translation: false,
          availableVersion: null,
          downloadedVersion: null,
          downloadPercent: null,
          checkedAt: null,
          message: null,
          errorContext: null,
          canRetry: false,
        },
      }),
      onUpdateState: () => () => undefined,
    } as NonNullable<Window["desktopBridge"]>;
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: desktopBridge,
    });

    const draftThreadId = "draft-workspace-delete" as ThreadId;
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [draftThreadId]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceId: WORKSPACE_ID,
          branch: "feature-flow",
          worktreePath: "/repo/project/.t3/worktrees/feature-flow",
          envMode: "worktree",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: draftThreadId,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withWorkspace(
        createSnapshotForTargetUser({
          targetMessageId: "msg-user-workspace-delete-test" as MessageId,
          targetText: "workspace delete test",
        }),
        { title: "Flow Workspace" },
      ),
    });

    try {
      const workspaceLabel = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("span")).find(
            (element) => element.textContent?.trim() === "Flow Workspace",
          ) ?? null,
        "Unable to find workspace row.",
      );

      workspaceLabel.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 32,
          clientY: 32,
          button: 2,
        }),
      );
      await waitForLayout();

      await vi.waitFor(
        () => {
          expect(contextMenuResult).toHaveBeenCalledTimes(1);
          expect(confirmResult).toHaveBeenCalledTimes(1);
          expect(
            wsRequests.some((request) => {
              const command = request.command as
                | { type?: string; workspaceId?: WorkspaceId }
                | undefined;
              return (
                request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
                command?.type === "workspace.delete" &&
                command.workspaceId === WORKSPACE_ID
              );
            }),
          ).toBe(true);
        },
        { timeout: 8_000, interval: 16 },
      );

      expect(contextMenuSelections).toEqual([
        ["rename", "copy-path", "new-session", "archive", "delete"],
      ]);
      expect(confirmMessages).toEqual([
        'Delete workspace "Flow Workspace"?\n1 session will stay, but they will no longer be grouped under this workspace.',
      ]);
      expect(useComposerDraftStore.getState().draftThreadsByThreadId[draftThreadId]).toMatchObject({
        workspaceId: null,
        branch: "feature-flow",
        worktreePath: "/repo/project/.t3/worktrees/feature-flow",
        envMode: "worktree",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("snapshots sticky codex settings into a new draft thread", async () => {
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        codex: {
          provider: "codex",
          model: "gpt-5.3-codex",
          options: {
            reasoningEffort: "medium",
            fastMode: true,
          },
        },
      },
      stickyActiveProvider: "codex",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-sticky-codex-traits-test" as MessageId,
        targetText: "sticky codex traits test",
      }),
    });

    try {
      await openProjectNewThreadAndCreateDraft();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toMatchObject({
        modelSelectionByProvider: {
          codex: {
            provider: "codex",
            model: "gpt-5.3-codex",
            options: {
              fastMode: true,
            },
          },
        },
        activeProvider: "codex",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("hydrates the provider alongside a sticky claude model", async () => {
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        claudeAgent: {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
          options: {
            effort: "max",
            fastMode: true,
          },
        },
      },
      stickyActiveProvider: "claudeAgent",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-sticky-claude-model-test" as MessageId,
        targetText: "sticky claude model test",
      }),
    });

    try {
      await openProjectNewThreadAndCreateDraft();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new sticky claude draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toMatchObject({
        modelSelectionByProvider: {
          claudeAgent: {
            provider: "claudeAgent",
            model: "claude-opus-4-6",
            options: {
              effort: "max",
              fastMode: true,
            },
          },
        },
        activeProvider: "claudeAgent",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back to defaults when no sticky composer settings exist", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-default-codex-traits-test" as MessageId,
        targetText: "default codex traits test",
      }),
    });

    try {
      await openProjectNewThreadAndCreateDraft();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toBeUndefined();
    } finally {
      await mounted.cleanup();
    }
  });

  it("prefers draft state over sticky composer settings and defaults", async () => {
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        codex: {
          provider: "codex",
          model: "gpt-5.3-codex",
          options: {
            reasoningEffort: "medium",
            fastMode: true,
          },
        },
      },
      stickyActiveProvider: "codex",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-draft-codex-traits-precedence-test" as MessageId,
        targetText: "draft codex traits precedence test",
      }),
    });

    try {
      await openProjectNewThreadAndCreateDraft();

      const threadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a sticky draft thread UUID.",
      );
      const threadId = threadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
        modelSelectionByProvider: {
          codex: {
            provider: "codex",
            model: "gpt-5.3-codex",
            options: {
              fastMode: true,
            },
          },
        },
        activeProvider: "codex",
      });

      useComposerDraftStore.getState().setModelSelection(threadId, {
        provider: "codex",
        model: "gpt-5.4",
        options: {
          reasoningEffort: "low",
          fastMode: true,
        },
      });

      await openProjectNewThreadAndCreateDraft();

      await waitForURL(
        mounted.router,
        (path) => path === threadPath,
        "New-thread should reuse the existing project draft thread.",
      );
      expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
        modelSelectionByProvider: {
          codex: {
            provider: "codex",
            model: "gpt-5.4",
            options: {
              reasoningEffort: "low",
              fastMode: true,
            },
          },
        },
        activeProvider: "codex",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates a new thread from the global chat.new shortcut", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-chat-shortcut-test" as MessageId,
        targetText: "chat shortcut test",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "chat.new",
              shortcut: {
                key: "o",
                metaKey: false,
                ctrlKey: false,
                shiftKey: true,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForNewThreadShortcutLabel();
      await waitForServerConfigToApply();
      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      await waitForLayout();
      await triggerChatNewShortcutUntilPath(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID from the shortcut.",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the new-thread page from the command palette", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-command-palette-new-thread" as MessageId,
        targetText: "command palette new thread",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "chat.new",
              shortcut: {
                key: "o",
                metaKey: false,
                ctrlKey: false,
                shiftKey: true,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      dispatchWorkspaceCommandPaletteShortcut();

      await expect.element(page.getByText("Suggested")).toBeInTheDocument();

      const newThreadCommand = await waitForElement(
        () =>
          Array.from(document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')).find(
            (item) => item.textContent?.includes("New thread"),
          ) ?? null,
        "Unable to find New thread command.",
      );
      newThreadCommand.click();

      await waitForURL(
        mounted.router,
        (path) => path === "/",
        "Command palette should navigate to the global new-thread page.",
      );
      await expect.element(page.getByText("Let's build")).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("focuses the composer with Cmd+L", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-focus-composer-shortcut" as MessageId,
        targetText: "focus composer shortcut",
      }),
    });

    try {
      const composerEditor = await waitForComposerEditor();
      const modeButton = await waitForInteractionModeButton("Chat");
      modeButton.focus();
      expect(document.activeElement).toBe(modeButton);

      dispatchFocusComposerShortcut();

      await vi.waitFor(
        () => {
          expect(document.activeElement).toBe(composerEditor);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("focuses the terminal with Cmd+J when it is already open", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-focus-terminal-shortcut" as MessageId,
        targetText: "focus terminal shortcut",
      }),
    });

    try {
      await waitForServerConfigToApply();
      const toggleTerminalButton = await waitForElement(
        () => document.querySelector<HTMLButtonElement>('button[aria-label="Toggle terminal tab"]'),
        "Unable to find terminal toggle button.",
      );
      toggleTerminalButton.click();

      const terminalTextarea = await waitForTerminalTextarea();
      await vi.waitFor(
        () => {
          expect(document.activeElement).toBe(terminalTextarea);
        },
        { timeout: 8_000, interval: 16 },
      );

      const initialTerminalOpenCount = wsRequests.filter(
        (request) => request._tag === WS_METHODS.terminalOpen,
      ).length;

      const modeButton = await waitForInteractionModeButton("Chat");
      modeButton.focus();
      expect(document.activeElement).toBe(modeButton);

      dispatchToggleTerminalShortcut();

      await vi.waitFor(
        () => {
          expect(document.activeElement).toBe(terminalTextarea);
          expect(
            wsRequests.filter((request) => request._tag === WS_METHODS.terminalOpen),
          ).toHaveLength(initialTerminalOpenCount);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates a fresh draft after the previous draft thread is promoted", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-promoted-draft-shortcut-test" as MessageId,
        targetText: "promoted draft shortcut test",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "chat.new",
              shortcut: {
                key: "o",
                metaKey: false,
                ctrlKey: false,
                shiftKey: true,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForNewThreadShortcutLabel();
      await waitForServerConfigToApply();
      await openProjectNewThreadAndCreateDraft();

      const promotedThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a promoted draft thread UUID.",
      );
      const promotedThreadId = promotedThreadPath.slice(1) as ThreadId;

      const { syncServerReadModel } = useStore.getState();
      syncServerReadModel(addThreadToSnapshot(fixture.snapshot, promotedThreadId));
      useComposerDraftStore.getState().clearDraftThread(promotedThreadId);

      const freshThreadPath = await triggerChatNewShortcutUntilPath(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path) && path !== promotedThreadPath,
        "Shortcut should create a fresh draft instead of reusing the promoted thread.",
      );
      expect(freshThreadPath).not.toBe(promotedThreadPath);
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps long proposed plans lightweight until the user expands them", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotWithLongProposedPlan(),
    });

    try {
      await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Expand plan",
          ) as HTMLButtonElement | null,
        "Unable to find Expand plan button.",
      );

      expect(document.body.textContent).not.toContain("deep hidden detail only after expand");

      const expandButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Expand plan",
          ) as HTMLButtonElement | null,
        "Unable to find Expand plan button.",
      );
      expandButton.click();

      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("deep hidden detail only after expand");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });
});
