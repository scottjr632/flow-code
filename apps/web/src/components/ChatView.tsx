import {
  type ApprovalRequestId,
  DEFAULT_MODEL_BY_PROVIDER,
  type ClaudeCodeEffort,
  type MessageId,
  type ModelSelection,
  type ProjectScript,
  type ProviderKind,
  type ProjectEntry,
  type ProjectId,
  type ProviderApprovalDecision,
  type ResolvedKeybindingsConfig,
  type ServerProvider,
  type ThreadId,
  type TurnId,
  type EditorId,
  type KeybindingCommand,
  OrchestrationThreadActivity,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";
import { applyClaudePromptEffortPrefix, normalizeModelSlug } from "@t3tools/shared/model";
import { truncate } from "@t3tools/shared/String";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { gitBranchesQueryOptions, gitCreateWorktreeMutationOptions } from "~/lib/gitReactQuery";
import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import { serverConfigQueryOptions, serverQueryKeys } from "~/lib/serverReactQuery";
import { isElectron } from "../env";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import {
  clampCollapsedComposerCursor,
  type ComposerTrigger,
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  extendReplacementRangeForTrailingSpace,
  expandCollapsedComposerCursor,
  parseStandaloneComposerSlashCommand,
  replaceTextRange,
} from "../composer-logic";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  derivePhase,
  deriveTimelineEntries,
  deriveActiveWorkStartedAt,
  deriveActivePlanState,
  findSidebarProposedPlan,
  findLatestProposedPlan,
  deriveWorkLogEntries,
  hasActionableProposedPlan,
  hasToolActivityForTurn,
  isLatestTurnSettled,
  formatElapsed,
} from "../session-logic";
import { isScrollContainerNearBottom } from "../chat-scroll";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  type PendingUserInputDraftAnswer,
} from "../pendingUserInput";
import { useStore } from "../store";
import {
  buildPlanImplementationThreadTitle,
  buildPlanImplementationPrompt,
  proposedPlanTitle,
  resolvePlanFollowUpSubmission,
} from "../proposedPlan";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ChatMessage,
  type Thread,
  type TurnDiffSummary,
} from "../types";
import { basenameOfPath } from "../vscode-icons";
import { requestCancelActiveDiffComment } from "../lib/diffCommentEvents";
import { useTheme } from "../hooks/useTheme";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useWorkspaceFilePalette } from "../hooks/useWorkspaceFilePalette";
import BranchToolbar from "./BranchToolbar";
import {
  isFocusComposerShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
  workspaceTabTraversalDirection,
} from "../keybindings";
import PlanSidebar from "./PlanSidebar";
import { ThreadDiffWorkspace } from "./ThreadDiffWorkspace";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";
import {
  BotIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  FolderIcon,
  ListOrderedIcon,
  ListTodoIcon,
  LockIcon,
  LockOpenIcon,
  PlusIcon,
  TerminalSquareIcon,
  XIcon,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Separator } from "./ui/separator";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { cn, randomUUID } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { toastManager } from "./ui/toast";
import { decodeProjectScriptKeybindingRule } from "~/lib/projectScriptKeybindings";
import { type NewProjectScriptInput } from "./ProjectScriptsControl";
import {
  commandForProjectScript,
  nextProjectScriptId,
  projectScriptCwd,
  projectScriptRuntimeEnv,
  projectScriptIdFromCommand,
  setupProjectScript,
} from "~/projectScripts";
import { SidebarTrigger } from "./ui/sidebar";
import { newCommandId, newMessageId, newThreadId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import {
  getProviderModelCapabilities,
  getProviderModels,
  resolveSelectableProvider,
} from "../providerModels";
import { useSettings } from "../hooks/useSettings";
import { useThreadActions } from "../hooks/useThreadActions";
import { resolveAppModelSelection } from "../modelSelection";
import { isTerminalFocused } from "../lib/terminalFocus";
import { findTerminalGroupByTerminalId, terminalGroupIdForTerminal } from "../terminalGroups";
import {
  type ComposerThreadDraftState,
  type ComposerImageAttachment,
  type DraftThreadEnvMode,
  type PersistedComposerImageAttachment,
  consumePendingAutoSend,
  useComposerDraftStore,
  useEffectiveComposerModelState,
  useComposerThreadDraft,
} from "../composerDraftStore";
import { useComposerQueuedMessages, useComposerQueueStore } from "../composerQueueStore";
import {
  appendDiffCommentsToPrompt,
  formatDiffCommentLabel,
  type DiffCommentDraft,
} from "../lib/diffCommentContext";
import {
  appendTerminalContextsToPrompt,
  formatTerminalContextLabel,
  insertInlineTerminalContextPlaceholder,
  removeInlineTerminalContextPlaceholder,
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "../lib/terminalContext";
import { deriveLatestContextWindowSnapshot } from "../lib/contextWindow";
import { appendSessionReferencesToPrompt, searchSessionReferences } from "../lib/sessionReferences";
import {
  appendTerminalLogReferencesToPrompt,
  searchWorkspaceTerminalLogReferences,
} from "../lib/terminalLogReferences";
import { shouldUseCompactComposerFooter } from "./composerFooterLayout";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import {
  buildFileWorkspaceTabId,
  buildThreadWorkspaceTabId,
  buildTerminalWorkspaceTabId,
  buildWorkspaceTabs,
  DEFAULT_CHAT_WORKSPACE_TAB_ID,
  getAdjacentWorkspaceTabId,
  reorderWorkspaceTabIds,
  isFileWorkspaceTabId,
  isTerminalWorkspaceTabId,
  resolveWorkspaceTabId,
  sortWorkspaceTabsByOrder,
  type WorkspaceFileTabState,
  type WorkspaceTab,
  type WorkspaceTabId,
} from "../workspaceTabs";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "./ComposerPromptEditor";
import { PullRequestThreadDialog } from "./PullRequestThreadDialog";
import {
  WorkspaceCommandPalette,
  type WorkspaceCommandPaletteItem,
} from "./WorkspaceCommandPalette";
import { WorkspaceFilePalette } from "./WorkspaceFilePalette";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import { MessagesTimeline } from "./chat/MessagesTimeline";
import { ChatHeader } from "./chat/ChatHeader";
import { ContextWindowMeter } from "./chat/ContextWindowMeter";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { AVAILABLE_PROVIDER_OPTIONS, ProviderModelPicker } from "./chat/ProviderModelPicker";
import { ComposerCommandItem, ComposerCommandMenu } from "./chat/ComposerCommandMenu";
import { ComposerPendingApprovalActions } from "./chat/ComposerPendingApprovalActions";
import { CompactComposerControlsMenu } from "./chat/CompactComposerControlsMenu";
import { ComposerPendingApprovalPanel } from "./chat/ComposerPendingApprovalPanel";
import { ComposerPendingUserInputPanel } from "./chat/ComposerPendingUserInputPanel";
import { ComposerPlanFollowUpBanner } from "./chat/ComposerPlanFollowUpBanner";
import { ComposerPendingDiffComments } from "./chat/ComposerPendingDiffComments";
import { ComposerQueuePanel } from "./chat/ComposerQueuePanel";
import {
  getComposerProviderState,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./chat/composerProviderRegistry";
import { ProviderStatusBanner } from "./chat/ProviderStatusBanner";
import { ThreadErrorBanner } from "./chat/ThreadErrorBanner";
import { WorkItemEditorDialog } from "./WorkItemEditorDialog";
import {
  buildExpiredTerminalContextToastCopy,
  buildLocalDraftThread,
  buildWorkspaceTabOrderContextId,
  buildTemporaryWorktreeBranchName,
  cloneComposerImageForRetry,
  collectUserMessageBlobPreviewUrls,
  deriveComposerSendState,
  getWorkspaceTabReconciliationTarget,
  LAST_ACTIVE_WORKSPACE_TAB_BY_THREAD_KEY,
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastActiveWorkspaceTabByThreadSchema,
  LastInvokedScriptByProjectSchema,
  processImageFiles,
  PullRequestDialogState,
  readFileAsDataUrl,
  revokeBlobPreviewUrl,
  revokeUserMessagePreviewUrls,
  SendPhase,
  shouldPreserveExplicitWorkspaceTabSelection,
  shouldReuseHiddenDefaultTerminalForWorkspaceCreation,
  updateLastActiveWorkspaceTabByThread,
  WORKSPACE_TAB_ORDER_BY_CONTEXT_KEY,
  WorkspaceTabOrderByContextSchema,
} from "./ChatView.logic";
import { sortThreadsForSidebar } from "./Sidebar.logic";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useCreateWorkItemDialog } from "../hooks/useCreateWorkItemDialog";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useWorkspaceCommandPalette } from "../hooks/useWorkspaceCommandPalette";
import { buildWorkspaceCommandPaletteNavigationItems } from "../workspaceCommandPaletteItems";
import { useWindowKeydownListener } from "../hooks/useWindowKeydownListener";
import { resolveExistingWorkspaceContext } from "../workspaceContext";
import { isHomeProject, isUserProject } from "../systemProject";
import {
  directoryAncestorsOf,
  isBufferDirty,
  useThreadWorkspaceEditorState,
  useWorkspaceEditorStore,
} from "../workspaceEditorStore";
import { resolveWorkspaceRelativeFileTarget } from "../workspaceFileTargets";
import { WorkspaceEditorSurface } from "./WorkspaceEditorSurface";

const ATTACHMENT_PREVIEW_HANDOFF_TTL_MS = 5000;
const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";
const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const EMPTY_PROJECT_ENTRIES: ProjectEntry[] = [];
const EMPTY_AVAILABLE_EDITORS: EditorId[] = [];
const SESSION_OPEN_SCROLL_LOCK_MS = 1500;
const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
interface PreparedComposerSubmission {
  summary: string;
  outgoingMessageText: string;
  titleSeed: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  attachments: Array<{
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    dataUrl: string;
    previewUrl?: string;
  }>;
  restorePrompt: string;
  restoreImages: ComposerImageAttachment[];
  restoreTerminalContexts: TerminalContextDraft[];
  restoreDiffComments: DiffCommentDraft[];
  expiredTerminalContextCount: number;
}

function resolveThreadDraftProvider(
  draftsByThreadId: Readonly<Record<ThreadId, ComposerThreadDraftState>>,
  draftThreadId: ThreadId,
  fallbackProvider: ProviderKind,
): ProviderKind {
  const draft = draftsByThreadId[draftThreadId];
  if (!draft) {
    return fallbackProvider;
  }
  return (
    draft.activeProvider ??
    draft.modelSelectionByProvider.codex?.provider ??
    draft.modelSelectionByProvider.claudeAgent?.provider ??
    fallbackProvider
  );
}

function formatOutgoingPrompt(params: {
  provider: ProviderKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  if (params.effort && caps.promptInjectedEffortLevels.includes(params.effort)) {
    return applyClaudePromptEffortPrefix(params.text, params.effort as ClaudeCodeEffort | null);
  }
  return params.text;
}
const COMPOSER_PATH_QUERY_DEBOUNCE_MS = 120;
const SCRIPT_TERMINAL_COLS = 120;
const SCRIPT_TERMINAL_ROWS = 30;

const syncTerminalContextsByIds = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): TerminalContextDraft[] => {
  const contextsById = new Map(contexts.map((context) => [context.id, context]));
  return ids.flatMap((id) => {
    const context = contextsById.get(id);
    return context ? [context] : [];
  });
};

const terminalContextIdListsEqual = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): boolean =>
  contexts.length === ids.length && contexts.every((context, index) => context.id === ids[index]);

interface ChatViewProps {
  threadId: ThreadId;
}

interface PendingPullRequestSetupRequest {
  threadId: ThreadId;
  worktreePath: string;
  scriptId: string;
}

export default function ChatView({ threadId }: ChatViewProps) {
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const workspaces = useStore((store) => store.workspaces);
  const markThreadVisited = useStore((store) => store.markThreadVisited);
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const setStoreThreadError = useStore((store) => store.setError);
  const setStoreThreadBranch = useStore((store) => store.setThreadBranch);
  const settings = useSettings();
  const { confirmAndArchiveThread } = useThreadActions();
  const { handleNewThread } = useHandleNewThread();
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const timestampFormat = settings.timestampFormat;
  const navigate = useNavigate();
  const rawSearch = useSearch({
    strict: false,
    select: (params) => parseDiffRouteSearch(params),
  });
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const createWorktreeMutation = useMutation(gitCreateWorktreeMutationOptions({ queryClient }));
  const composerDraft = useComposerThreadDraft(threadId);
  const prompt = composerDraft.prompt;
  const composerImages = composerDraft.images;
  const composerTerminalContexts = composerDraft.terminalContexts;
  const composerDiffComments = composerDraft.diffComments;
  const composerSendState = useMemo(
    () =>
      deriveComposerSendState({
        prompt,
        imageCount: composerImages.length,
        terminalContexts: composerTerminalContexts,
        diffComments: composerDiffComments,
      }),
    [composerDiffComments, composerImages.length, composerTerminalContexts, prompt],
  );
  const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const addComposerDraftImage = useComposerDraftStore((store) => store.addImage);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const removeComposerDraftImage = useComposerDraftStore((store) => store.removeImage);
  const insertComposerDraftTerminalContext = useComposerDraftStore(
    (store) => store.insertTerminalContext,
  );
  const addComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.addTerminalContexts,
  );
  const addComposerDraftDiffComments = useComposerDraftStore((store) => store.addDiffComments);
  const removeComposerDraftTerminalContext = useComposerDraftStore(
    (store) => store.removeTerminalContext,
  );
  const removeComposerDraftDiffComment = useComposerDraftStore((store) => store.removeDiffComment);
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const clearComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.clearPersistedAttachments,
  );
  const syncComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.syncPersistedAttachments,
  );
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const composerDraftsByThreadId = useComposerDraftStore((store) => store.draftsByThreadId);
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const queuedComposerMessages = useComposerQueuedMessages(threadId);
  const enqueueQueuedComposerMessage = useComposerQueueStore((store) => store.enqueueMessage);
  const markQueuedComposerMessageSending = useComposerQueueStore(
    (store) => store.markQueuedMessageSending,
  );
  const markQueuedComposerMessageFailed = useComposerQueueStore(
    (store) => store.markQueuedMessageFailed,
  );
  const retryQueuedComposerMessage = useComposerQueueStore((store) => store.retryQueuedMessage);
  const removeQueuedComposerMessage = useComposerQueueStore((store) => store.removeQueuedMessage);
  const consumeQueuedComposerMessage = useComposerQueueStore((store) => store.consumeQueuedMessage);
  const draftThread = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId] ?? null,
  );
  const promptRef = useRef(prompt);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isDragOverComposer, setIsDragOverComposer] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  const optimisticUserMessagesRef = useRef(optimisticUserMessages);
  optimisticUserMessagesRef.current = optimisticUserMessages;
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>(composerTerminalContexts);
  const composerDiffCommentsRef = useRef<DiffCommentDraft[]>(composerDiffComments);
  const [localDraftErrorsByThreadId, setLocalDraftErrorsByThreadId] = useState<
    Record<ThreadId, string | null>
  >({});
  const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
  const [sendStartedAt, setSendStartedAt] = useState<string | null>(null);
  const [isConnecting, _setIsConnecting] = useState(false);
  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false);
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [respondingUserInputRequestIds, setRespondingUserInputRequestIds] = useState<
    ApprovalRequestId[]
  >([]);
  const [pendingUserInputAnswersByRequestId, setPendingUserInputAnswersByRequestId] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const [pendingUserInputQuestionIndexByRequestId, setPendingUserInputQuestionIndexByRequestId] =
    useState<Record<string, number>>({});
  const [expandedWorkGroups, setExpandedWorkGroups] = useState<Record<string, boolean>>({});
  const [planSidebarOpen, setPlanSidebarOpen] = useState(false);
  const { isOpen: isWorkspaceCommandPaletteOpen, setIsOpen: setIsWorkspaceCommandPaletteOpen } =
    useWorkspaceCommandPalette();
  const { isOpen: isWorkspaceFilePaletteOpen, setIsOpen: setIsWorkspaceFilePaletteOpen } =
    useWorkspaceFilePalette();
  const [isComposerFooterCompact, setIsComposerFooterCompact] = useState(false);
  // Tracks whether the user explicitly dismissed the sidebar for the active turn.
  const planSidebarDismissedForTurnRef = useRef<string | null>(null);
  // When set, the thread-change reset effect will open the sidebar instead of closing it.
  // Used by "Implement in a new thread" to carry the sidebar-open intent across navigation.
  const planSidebarOpenOnNextThreadRef = useRef(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null);
  const [renameTerminalTabTarget, setRenameTerminalTabTarget] = useState<{
    terminalId: string;
    title: string;
  } | null>(null);
  const [renameTerminalTabValue, setRenameTerminalTabValue] = useState("");
  const [pendingPullRequestSetupRequest, setPendingPullRequestSetupRequest] =
    useState<PendingPullRequestSetupRequest | null>(null);
  const [attachmentPreviewHandoffByMessageId, setAttachmentPreviewHandoffByMessageId] = useState<
    Record<string, string[]>
  >({});
  const [composerCursor, setComposerCursor] = useState(() =>
    collapseExpandedComposerCursor(prompt, prompt.length),
  );
  const [composerTrigger, setComposerTrigger] = useState<ComposerTrigger | null>(() =>
    detectComposerTrigger(prompt, prompt.length),
  );
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );
  const [lastActiveWorkspaceTabByThreadId, setLastActiveWorkspaceTabByThreadId] = useLocalStorage(
    LAST_ACTIVE_WORKSPACE_TAB_BY_THREAD_KEY,
    {},
    LastActiveWorkspaceTabByThreadSchema,
  );
  const [workspaceTabOrderByContextId, setWorkspaceTabOrderByContextId] = useLocalStorage(
    WORKSPACE_TAB_ORDER_BY_CONTEXT_KEY,
    {},
    WorkspaceTabOrderByContextSchema,
  );
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const activeWorkspaceTabThreadIdRef = useRef(threadId);
  activeWorkspaceTabThreadIdRef.current = threadId;
  const [messagesScrollElement, setMessagesScrollElement] = useState<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastKnownScrollTopRef = useRef(0);
  const isPointerScrollActiveRef = useRef(false);
  const lastTouchClientYRef = useRef<number | null>(null);
  const pendingUserScrollUpIntentRef = useRef(false);
  const pendingAutoScrollFrameRef = useRef<number | null>(null);
  const pendingPinnedScrollFrameRef = useRef<number | null>(null);
  const pinnedScrollHeightRef = useRef<number | null>(null);
  const stickToBottomLockDeadlineRef = useRef(0);
  const pendingInteractionAnchorRef = useRef<{
    element: HTMLElement;
    top: number;
  } | null>(null);
  const pendingInteractionAnchorFrameRef = useRef<number | null>(null);
  const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const composerFormHeightRef = useRef(0);
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerSelectLockRef = useRef(false);
  const composerMenuOpenRef = useRef(false);
  const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
  const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
  const attachmentPreviewHandoffByMessageIdRef = useRef<Record<string, string[]>>({});
  const attachmentPreviewHandoffTimeoutByMessageIdRef = useRef<Record<string, number>>({});
  const sendInFlightRef = useRef(false);
  const dragDepthRef = useRef(0);
  const terminalOpenByThreadRef = useRef<Record<string, boolean>>({});
  const setMessagesScrollContainerRef = useCallback((element: HTMLDivElement | null) => {
    messagesScrollRef.current = element;
    setMessagesScrollElement(element);
  }, []);

  const storeSetTerminalOpen = useTerminalStateStore((s) => s.setTerminalOpen);
  const storeSetTerminalHeight = useTerminalStateStore((s) => s.setTerminalHeight);
  const storeSplitTerminal = useTerminalStateStore((s) => s.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((s) => s.newTerminal);
  const storeSetTerminalName = useTerminalStateStore((s) => s.setTerminalName);
  const storeSetActiveTerminal = useTerminalStateStore((s) => s.setActiveTerminal);
  const storeCloseTerminal = useTerminalStateStore((s) => s.closeTerminal);
  const activeWorkspaceTabId = lastActiveWorkspaceTabByThreadId[threadId] ?? "chat";
  const setActiveWorkspaceTabId = useCallback(
    (tabId: WorkspaceTabId) => {
      setLastActiveWorkspaceTabByThreadId((current) =>
        updateLastActiveWorkspaceTabByThread(current, activeWorkspaceTabThreadIdRef.current, tabId),
      );
    },
    [setLastActiveWorkspaceTabByThreadId],
  );

  const setPrompt = useCallback(
    (nextPrompt: string) => {
      setComposerDraftPrompt(threadId, nextPrompt);
    },
    [setComposerDraftPrompt, threadId],
  );
  const addComposerImage = useCallback(
    (image: ComposerImageAttachment) => {
      addComposerDraftImage(threadId, image);
    },
    [addComposerDraftImage, threadId],
  );
  const addComposerImagesToDraft = useCallback(
    (images: ComposerImageAttachment[]) => {
      addComposerDraftImages(threadId, images);
    },
    [addComposerDraftImages, threadId],
  );
  const addComposerTerminalContextsToDraft = useCallback(
    (contexts: TerminalContextDraft[]) => {
      addComposerDraftTerminalContexts(threadId, contexts);
    },
    [addComposerDraftTerminalContexts, threadId],
  );
  const addComposerDiffCommentsToDraft = useCallback(
    (comments: DiffCommentDraft[]) => {
      addComposerDraftDiffComments(threadId, comments);
    },
    [addComposerDraftDiffComments, threadId],
  );
  const removeComposerImageFromDraft = useCallback(
    (imageId: string) => {
      removeComposerDraftImage(threadId, imageId);
    },
    [removeComposerDraftImage, threadId],
  );
  const removeComposerTerminalContextFromDraft = useCallback(
    (contextId: string) => {
      const contextIndex = composerTerminalContexts.findIndex(
        (context) => context.id === contextId,
      );
      if (contextIndex < 0) {
        return;
      }
      const nextPrompt = removeInlineTerminalContextPlaceholder(promptRef.current, contextIndex);
      promptRef.current = nextPrompt.prompt;
      setPrompt(nextPrompt.prompt);
      removeComposerDraftTerminalContext(threadId, contextId);
      setComposerCursor(nextPrompt.cursor);
      setComposerTrigger(
        detectComposerTrigger(
          nextPrompt.prompt,
          expandCollapsedComposerCursor(nextPrompt.prompt, nextPrompt.cursor),
        ),
      );
    },
    [composerTerminalContexts, removeComposerDraftTerminalContext, setPrompt, threadId],
  );
  const removeComposerDiffCommentFromDraft = useCallback(
    (commentId: string) => {
      removeComposerDraftDiffComment(threadId, commentId);
    },
    [removeComposerDraftDiffComment, threadId],
  );

  const serverThread = threads.find((t) => t.id === threadId);
  const fallbackDraftProject = projects.find((project) => project.id === draftThread?.projectId);
  const localDraftError = serverThread ? null : (localDraftErrorsByThreadId[threadId] ?? null);
  const localDraftThread = useMemo(
    () =>
      draftThread
        ? buildLocalDraftThread(
            threadId,
            draftThread,
            fallbackDraftProject?.defaultModelSelection ?? {
              provider: "codex",
              model: DEFAULT_MODEL_BY_PROVIDER.codex,
            },
            localDraftError,
          )
        : undefined,
    [draftThread, fallbackDraftProject?.defaultModelSelection, localDraftError, threadId],
  );
  const activeThread = serverThread ?? localDraftThread;
  const runtimeMode =
    composerDraft.runtimeMode ?? activeThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const interactionMode =
    composerDraft.interactionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE;
  const isServerThread = serverThread !== undefined;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const canCheckoutPullRequestIntoThread = isLocalDraftThread;
  const diffOpen = rawSearch.diff === "1";
  const activeThreadId = activeThread?.id ?? null;
  /**
   * Terminal sessions are scoped to the workspace when the thread belongs to one,
   * so all threads in a workspace share the same set of terminals. For local
   * (non-workspace) threads, terminals are scoped to the individual thread.
   */
  const terminalOwnerId: ThreadId | null =
    (activeThread?.workspaceId as unknown as ThreadId) ?? activeThreadId;
  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, terminalOwnerId ?? threadId),
  );
  const workspaceEditorState = useThreadWorkspaceEditorState(activeThreadId);
  const openWorkspaceEditorFile = useWorkspaceEditorStore((store) => store.openFile);
  const ensureWorkspaceEditorDirectoriesExpanded = useWorkspaceEditorStore(
    (store) => store.ensureDirectoriesExpanded,
  );
  const closeWorkspaceEditorFile = useWorkspaceEditorStore((store) => store.closeFile);
  const activeLatestTurn = activeThread?.latestTurn ?? null;
  const activeContextWindow = useMemo(
    () => deriveLatestContextWindowSnapshot(activeThread?.activities ?? []),
    [activeThread?.activities],
  );
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null);
  const activeProject = projects.find((p) => p.id === activeThread?.projectId);
  const activeProjectIsHome = isHomeProject(activeProject);
  const activeProjectSupportsWorkspace = activeProject !== undefined && !activeProjectIsHome;
  const userProjects = useMemo(
    () =>
      projects
        .filter(isUserProject)
        .toSorted((left, right) => left.name.localeCompare(right.name))
        .map((project) => ({ id: project.id, name: project.name })),
    [projects],
  );
  const {
    closeDialog: closeWorkItemDialog,
    dialogState: workItemDialogState,
    editorValues: workItemEditorValues,
    handleSubmit: handleSubmitWorkItemDialog,
    openCreateDialog: openCreateWorkItemDialog,
    setEditorValues: setWorkItemEditorValues,
    workspaceOptions: workItemWorkspaceOptions,
  } = useCreateWorkItemDialog({
    projects: userProjects,
    workspaces,
  });
  const gitCwd = activeProjectSupportsWorkspace
    ? projectScriptCwd({
        project: { cwd: activeProject.cwd },
        worktreePath: activeThread?.worktreePath ?? null,
      })
    : null;
  const workspaceFileRoot = activeProjectSupportsWorkspace
    ? (gitCwd ?? activeProject?.cwd ?? null)
    : null;
  const activeWorkspaceContext = useMemo(
    () =>
      resolveExistingWorkspaceContext({
        workspaceId: activeThread?.workspaceId ?? null,
        branch: activeThread?.branch ?? null,
        worktreePath: activeThread?.worktreePath ?? null,
        workspaces,
      }),
    [activeThread?.branch, activeThread?.workspaceId, activeThread?.worktreePath, workspaces],
  );
  const projectDraftThread = activeProject ? getDraftThreadByProjectId(activeProject.id) : null;
  const workspaceSessionTabs = useMemo(() => {
    if (!activeProject || !activeWorkspaceContext.workspaceId || !activeThread) {
      return [];
    }

    const sessionsById = new Map<
      string,
      Pick<Thread, "id" | "title" | "createdAt" | "updatedAt" | "messages"> & {
        isDraft: boolean;
        provider: ProviderKind;
      }
    >();

    threads
      .filter(
        (thread) =>
          thread.archivedAt === null &&
          thread.projectId === activeProject.id &&
          thread.workspaceId === activeWorkspaceContext.workspaceId,
      )
      .forEach((thread) => {
        sessionsById.set(thread.id, {
          id: thread.id,
          title: thread.title,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          messages: thread.messages,
          isDraft: false,
          provider: thread.session?.provider ?? thread.modelSelection.provider,
        });
      });

    if (
      projectDraftThread &&
      projectDraftThread.workspaceId === activeWorkspaceContext.workspaceId
    ) {
      sessionsById.set(projectDraftThread.threadId, {
        id: projectDraftThread.threadId,
        title: "New thread",
        createdAt: projectDraftThread.createdAt,
        updatedAt: projectDraftThread.createdAt,
        messages: [],
        isDraft: true,
        provider: resolveThreadDraftProvider(
          composerDraftsByThreadId,
          projectDraftThread.threadId,
          activeProject.defaultModelSelection?.provider ?? "codex",
        ),
      });
    }

    if (!sessionsById.has(activeThread.id)) {
      sessionsById.set(activeThread.id, {
        id: activeThread.id,
        title: activeThread.title,
        createdAt: activeThread.createdAt,
        updatedAt: activeThread.updatedAt,
        messages: activeThread.messages,
        isDraft: isLocalDraftThread,
        provider: isLocalDraftThread
          ? resolveThreadDraftProvider(
              composerDraftsByThreadId,
              activeThread.id,
              activeThread.modelSelection.provider,
            )
          : (activeThread.session?.provider ?? activeThread.modelSelection.provider),
      });
    }

    return sortThreadsForSidebar(
      Array.from(sessionsById.values()),
      settings.sidebarThreadSortOrder,
    ).map((thread) => ({
      threadId: thread.id,
      title: thread.title,
      isDraft: thread.isDraft,
      provider: thread.provider,
    }));
  }, [
    activeProject,
    activeThread,
    activeWorkspaceContext.workspaceId,
    composerDraftsByThreadId,
    isLocalDraftThread,
    projectDraftThread,
    settings.sidebarThreadSortOrder,
    threads,
  ]);
  const workspaceTabOrderContextId = useMemo(
    () =>
      buildWorkspaceTabOrderContextId({
        threadId: activeThread?.id ?? threadId,
        workspaceId: activeWorkspaceContext.workspaceId,
      }),
    [activeThread?.id, activeWorkspaceContext.workspaceId, threadId],
  );
  const workspaceFileTabs = useMemo<WorkspaceFileTabState[]>(
    () =>
      workspaceEditorState.openFilePaths.map((relativePath) => ({
        relativePath,
        title: basenameOfPath(relativePath),
        dirty: isBufferDirty(workspaceEditorState.buffersByPath[relativePath]),
      })),
    [workspaceEditorState.buffersByPath, workspaceEditorState.openFilePaths],
  );
  const conversationTabProvider = activeThread
    ? isLocalDraftThread
      ? resolveThreadDraftProvider(
          composerDraftsByThreadId,
          activeThread.id,
          activeThread.modelSelection.provider,
        )
      : (activeThread.session?.provider ?? activeThread.modelSelection.provider)
    : null;
  const workspaceTabs = useMemo(() => {
    const tabs = buildWorkspaceTabs({
      chatProvider: conversationTabProvider,
      sessionTabs: workspaceSessionTabs,
      diffOpen,
      fileTabs: workspaceFileTabs,
      terminalOpen: terminalState.terminalOpen,
      terminalGroups: terminalState.terminalGroups,
      terminalNamesById: terminalState.terminalNamesById,
      runningTerminalIds: terminalState.runningTerminalIds,
    });

    return sortWorkspaceTabsByOrder(tabs, workspaceTabOrderByContextId[workspaceTabOrderContextId]);
  }, [
    diffOpen,
    conversationTabProvider,
    workspaceFileTabs,
    terminalState.terminalGroups,
    terminalState.terminalNamesById,
    terminalState.runningTerminalIds,
    terminalState.terminalOpen,
    workspaceSessionTabs,
    workspaceTabOrderByContextId,
    workspaceTabOrderContextId,
  ]);
  const defaultConversationWorkspaceTabId =
    activeThread && activeWorkspaceContext.workspaceId
      ? buildThreadWorkspaceTabId(activeThread.id)
      : DEFAULT_CHAT_WORKSPACE_TAB_ID;
  const resolvedWorkspaceTabId = activeProjectSupportsWorkspace
    ? resolveWorkspaceTabId(activeWorkspaceTabId, workspaceTabs)
    : defaultConversationWorkspaceTabId;
  const activeWorkspaceTab = workspaceTabs.find((tab) => tab.id === resolvedWorkspaceTabId);
  const activeFilesWorkspaceTab = activeWorkspaceTab?.kind === "files" ? activeWorkspaceTab : null;
  const activeFileWorkspaceTab = activeWorkspaceTab?.kind === "file" ? activeWorkspaceTab : null;
  const activeTerminalWorkspaceTab =
    activeWorkspaceTab?.kind === "terminal" ? activeWorkspaceTab : null;
  const openFileTargetInWorkspace = useCallback(
    (targetPath: string) => {
      if (settings.fileLinkOpenBehavior !== "flow-files" || !workspaceFileRoot || !activeThreadId) {
        return false;
      }

      const relativePath = resolveWorkspaceRelativeFileTarget(targetPath, workspaceFileRoot);
      if (!relativePath) {
        return false;
      }

      openWorkspaceEditorFile(activeThreadId, relativePath);
      ensureWorkspaceEditorDirectoriesExpanded(activeThreadId, directoryAncestorsOf(relativePath));
      setActiveWorkspaceTabId(buildFileWorkspaceTabId(relativePath));
      return true;
    },
    [
      activeThreadId,
      ensureWorkspaceEditorDirectoriesExpanded,
      openWorkspaceEditorFile,
      setActiveWorkspaceTabId,
      settings.fileLinkOpenBehavior,
      workspaceFileRoot,
    ],
  );

  const openPullRequestDialog = useCallback(
    (reference?: string) => {
      if (!canCheckoutPullRequestIntoThread) {
        return;
      }
      setPullRequestDialogState({
        initialReference: reference ?? null,
        key: Date.now(),
      });
      setComposerHighlightedItemId(null);
    },
    [canCheckoutPullRequestIntoThread],
  );

  const closePullRequestDialog = useCallback(() => {
    setPullRequestDialogState(null);
  }, []);

  useEffect(() => {
    const reconciliationTarget = getWorkspaceTabReconciliationTarget({
      activeTabId: activeWorkspaceTabId,
      resolvedTabId: resolvedWorkspaceTabId,
      diffOpen,
    });

    if (reconciliationTarget) {
      setActiveWorkspaceTabId(reconciliationTarget);
    }
  }, [activeWorkspaceTabId, diffOpen, resolvedWorkspaceTabId, setActiveWorkspaceTabId]);

  useEffect(() => {
    const orderedTabIds = workspaceTabs.map((tab) => tab.id);
    setWorkspaceTabOrderByContextId((current) => {
      const previousTabIds = current[workspaceTabOrderContextId];
      if (
        previousTabIds &&
        previousTabIds.length === orderedTabIds.length &&
        previousTabIds.every((tabId, index) => tabId === orderedTabIds[index])
      ) {
        return current;
      }

      return {
        ...current,
        [workspaceTabOrderContextId]: orderedTabIds,
      };
    });
  }, [setWorkspaceTabOrderByContextId, workspaceTabOrderContextId, workspaceTabs]);

  useEffect(() => {
    if (
      shouldPreserveExplicitWorkspaceTabSelection({
        activeTabId: activeWorkspaceTabId,
        defaultConversationWorkspaceTabId,
      })
    ) {
      return;
    }
    setActiveWorkspaceTabId(defaultConversationWorkspaceTabId);
  }, [activeWorkspaceTabId, defaultConversationWorkspaceTabId, setActiveWorkspaceTabId]);

  const reorderWorkspaceTabs = useCallback(
    (draggedTabId: WorkspaceTabId, targetTabId: WorkspaceTabId) => {
      setWorkspaceTabOrderByContextId((current) => {
        const currentTabIds = workspaceTabs.map((tab) => tab.id);
        const nextTabIds = reorderWorkspaceTabIds(currentTabIds, draggedTabId, targetTabId);
        const previousTabIds = current[workspaceTabOrderContextId];
        if (
          previousTabIds &&
          previousTabIds.length === nextTabIds.length &&
          previousTabIds.every((tabId, index) => tabId === nextTabIds[index])
        ) {
          return current;
        }

        return {
          ...current,
          [workspaceTabOrderContextId]: nextTabIds,
        };
      });
    },
    [setWorkspaceTabOrderByContextId, workspaceTabOrderContextId, workspaceTabs],
  );

  const openOrReuseProjectDraftThread = useCallback(
    async (input: { branch: string; worktreePath: string | null; envMode: DraftThreadEnvMode }) => {
      if (!activeProject) {
        throw new Error("No active project is available for this pull request.");
      }
      const storedDraftThread = getDraftThreadByProjectId(activeProject.id);
      if (storedDraftThread) {
        setDraftThreadContext(storedDraftThread.threadId, input);
        setProjectDraftThreadId(activeProject.id, storedDraftThread.threadId, input);
        if (storedDraftThread.threadId !== threadId) {
          await navigate({
            to: "/$threadId",
            params: { threadId: storedDraftThread.threadId },
          });
        }
        return storedDraftThread.threadId;
      }

      const activeDraftThread = getDraftThread(threadId);
      if (!isServerThread && activeDraftThread?.projectId === activeProject.id) {
        setDraftThreadContext(threadId, input);
        setProjectDraftThreadId(activeProject.id, threadId, input);
        return threadId;
      }

      clearProjectDraftThreadId(activeProject.id);
      const nextThreadId = newThreadId();
      setProjectDraftThreadId(activeProject.id, nextThreadId, {
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        ...input,
      });
      await navigate({
        to: "/$threadId",
        params: { threadId: nextThreadId },
      });
      return nextThreadId;
    },
    [
      activeProject,
      clearProjectDraftThreadId,
      getDraftThread,
      getDraftThreadByProjectId,
      isServerThread,
      navigate,
      setDraftThreadContext,
      setProjectDraftThreadId,
      threadId,
    ],
  );

  const handlePreparedPullRequestThread = useCallback(
    async (input: { branch: string; worktreePath: string | null }) => {
      const targetThreadId = await openOrReuseProjectDraftThread({
        branch: input.branch,
        worktreePath: input.worktreePath,
        envMode: input.worktreePath ? "worktree" : "local",
      });
      const setupScript =
        input.worktreePath && activeProject ? setupProjectScript(activeProject.scripts) : null;
      if (targetThreadId && input.worktreePath && setupScript) {
        setPendingPullRequestSetupRequest({
          threadId: targetThreadId,
          worktreePath: input.worktreePath,
          scriptId: setupScript.id,
        });
      } else {
        setPendingPullRequestSetupRequest(null);
      }
    },
    [activeProject, openOrReuseProjectDraftThread],
  );

  useEffect(() => {
    if (!activeThread?.id) return;
    markThreadVisited(activeThread.id);
  }, [activeThread?.id, markThreadVisited]);

  useEffect(() => {
    if (!activeThread?.id) return;
    if (!latestTurnSettled) return;
    if (!activeLatestTurn?.completedAt) return;
    const turnCompletedAt = Date.parse(activeLatestTurn.completedAt);
    if (Number.isNaN(turnCompletedAt)) return;
    const lastVisitedAt = activeThread.lastVisitedAt ? Date.parse(activeThread.lastVisitedAt) : NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= turnCompletedAt) return;

    markThreadVisited(activeThread.id);
  }, [
    activeThread?.id,
    activeThread?.lastVisitedAt,
    activeLatestTurn?.completedAt,
    latestTurnSettled,
    markThreadVisited,
  ]);

  const sessionProvider = activeThread?.session?.provider ?? null;
  const selectedProviderByThreadId = composerDraft.activeProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.provider ?? activeProject?.defaultModelSelection?.provider ?? null;
  const hasThreadStarted = Boolean(
    activeThread &&
    (activeThread.latestTurn !== null ||
      activeThread.messages.length > 0 ||
      activeThread.session !== null),
  );
  const lockedProvider: ProviderKind | null = hasThreadStarted
    ? (sessionProvider ?? threadProvider ?? selectedProviderByThreadId ?? null)
    : null;
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const providerStatuses = serverConfigQuery.data?.providers ?? EMPTY_PROVIDERS;
  const unlockedSelectedProvider = resolveSelectableProvider(
    providerStatuses,
    selectedProviderByThreadId ?? threadProvider ?? "codex",
  );
  const selectedProvider: ProviderKind = lockedProvider ?? unlockedSelectedProvider;
  const { modelOptions: composerModelOptions, selectedModel } = useEffectiveComposerModelState({
    threadId,
    providers: providerStatuses,
    selectedProvider,
    threadModelSelection: activeThread?.modelSelection,
    projectModelSelection: activeProject?.defaultModelSelection,
    settings,
  });
  const selectedProviderModels = getProviderModels(providerStatuses, selectedProvider);
  const composerProviderState = useMemo(
    () =>
      getComposerProviderState({
        provider: selectedProvider,
        model: selectedModel,
        models: selectedProviderModels,
        prompt,
        modelOptions: composerModelOptions,
      }),
    [composerModelOptions, prompt, selectedModel, selectedProvider, selectedProviderModels],
  );
  const selectedPromptEffort = composerProviderState.promptEffort;
  const selectedModelOptionsForDispatch = composerProviderState.modelOptionsForDispatch;
  const selectedModelSelection = useMemo<ModelSelection>(
    () => ({
      provider: selectedProvider,
      model: selectedModel,
      ...(selectedModelOptionsForDispatch ? { options: selectedModelOptionsForDispatch } : {}),
    }),
    [selectedModel, selectedModelOptionsForDispatch, selectedProvider],
  );
  const selectedModelForPicker = selectedModel;
  const phase = derivePhase(activeThread?.session ?? null);
  const isSendBusy = sendPhase !== "idle";
  const isPreparingWorktree = sendPhase === "preparing-worktree";
  const isWorking = phase === "running" || isSendBusy || isConnecting || isRevertingCheckpoint;
  const nowIso = new Date(nowTick).toISOString();
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    activeLatestTurn,
    activeThread?.session ?? null,
    sendStartedAt,
  );
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
  const workLogEntries = useMemo(
    () => deriveWorkLogEntries(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const latestTurnHasToolActivity = useMemo(
    () => hasToolActivityForTurn(threadActivities, activeLatestTurn?.turnId),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const pendingApprovals = useMemo(
    () => derivePendingApprovals(threadActivities),
    [threadActivities],
  );
  const pendingUserInputs = useMemo(
    () => derivePendingUserInputs(threadActivities),
    [threadActivities],
  );
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const activePendingDraftAnswers = useMemo(
    () =>
      activePendingUserInput
        ? (pendingUserInputAnswersByRequestId[activePendingUserInput.requestId] ??
          EMPTY_PENDING_USER_INPUT_ANSWERS)
        : EMPTY_PENDING_USER_INPUT_ANSWERS,
    [activePendingUserInput, pendingUserInputAnswersByRequestId],
  );
  const activePendingQuestionIndex = activePendingUserInput
    ? (pendingUserInputQuestionIndexByRequestId[activePendingUserInput.requestId] ?? 0)
    : 0;
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput],
  );
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );
  const activePendingIsResponding = activePendingUserInput
    ? respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
    : false;
  const activeProposedPlan = useMemo(() => {
    if (!latestTurnSettled) {
      return null;
    }
    return findLatestProposedPlan(
      activeThread?.proposedPlans ?? [],
      activeLatestTurn?.turnId ?? null,
    );
  }, [activeLatestTurn?.turnId, activeThread?.proposedPlans, latestTurnSettled]);
  const sidebarProposedPlan = useMemo(
    () =>
      findSidebarProposedPlan({
        threads,
        latestTurn: activeLatestTurn,
        latestTurnSettled,
        threadId: activeThread?.id ?? null,
      }),
    [activeLatestTurn, activeThread?.id, latestTurnSettled, threads],
  );
  const activePlan = useMemo(
    () => deriveActivePlanState(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    interactionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan);
  const activePendingApproval = pendingApprovals[0] ?? null;
  const isComposerApprovalState = activePendingApproval !== null;
  const hasComposerHeader =
    isComposerApprovalState ||
    pendingUserInputs.length > 0 ||
    (showPlanFollowUpPrompt && activeProposedPlan !== null);
  const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;
  const lastSyncedPendingInputRef = useRef<{
    requestId: string | null;
    questionId: string | null;
  } | null>(null);
  useEffect(() => {
    const nextCustomAnswer = activePendingProgress?.customAnswer;
    if (typeof nextCustomAnswer !== "string") {
      lastSyncedPendingInputRef.current = null;
      return;
    }
    const nextRequestId = activePendingUserInput?.requestId ?? null;
    const nextQuestionId = activePendingProgress?.activeQuestion?.id ?? null;
    const questionChanged =
      lastSyncedPendingInputRef.current?.requestId !== nextRequestId ||
      lastSyncedPendingInputRef.current?.questionId !== nextQuestionId;
    const textChangedExternally = promptRef.current !== nextCustomAnswer;

    lastSyncedPendingInputRef.current = {
      requestId: nextRequestId,
      questionId: nextQuestionId,
    };

    if (!questionChanged && !textChangedExternally) {
      return;
    }

    promptRef.current = nextCustomAnswer;
    const nextCursor = collapseExpandedComposerCursor(nextCustomAnswer, nextCustomAnswer.length);
    setComposerCursor(nextCursor);
    setComposerTrigger(
      detectComposerTrigger(
        nextCustomAnswer,
        expandCollapsedComposerCursor(nextCustomAnswer, nextCursor),
      ),
    );
    setComposerHighlightedItemId(null);
  }, [
    activePendingProgress?.customAnswer,
    activePendingUserInput?.requestId,
    activePendingProgress?.activeQuestion?.id,
  ]);
  useEffect(() => {
    attachmentPreviewHandoffByMessageIdRef.current = attachmentPreviewHandoffByMessageId;
  }, [attachmentPreviewHandoffByMessageId]);
  const clearAttachmentPreviewHandoffs = useCallback(() => {
    for (const timeoutId of Object.values(attachmentPreviewHandoffTimeoutByMessageIdRef.current)) {
      window.clearTimeout(timeoutId);
    }
    attachmentPreviewHandoffTimeoutByMessageIdRef.current = {};
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    attachmentPreviewHandoffByMessageIdRef.current = {};
    setAttachmentPreviewHandoffByMessageId({});
  }, []);
  useEffect(() => {
    return () => {
      clearAttachmentPreviewHandoffs();
      for (const message of optimisticUserMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    };
  }, [clearAttachmentPreviewHandoffs]);
  const handoffAttachmentPreviews = useCallback((messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;

    const previousPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    for (const previewUrl of previousPreviewUrls) {
      if (!previewUrls.includes(previewUrl)) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    setAttachmentPreviewHandoffByMessageId((existing) => {
      const next = {
        ...existing,
        [messageId]: previewUrls,
      };
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });

    const existingTimeout = attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId];
    if (typeof existingTimeout === "number") {
      window.clearTimeout(existingTimeout);
    }
    attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId] = window.setTimeout(() => {
      const currentPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId];
      if (currentPreviewUrls) {
        for (const previewUrl of currentPreviewUrls) {
          revokeBlobPreviewUrl(previewUrl);
        }
      }
      setAttachmentPreviewHandoffByMessageId((existing) => {
        if (!(messageId in existing)) return existing;
        const next = { ...existing };
        delete next[messageId];
        attachmentPreviewHandoffByMessageIdRef.current = next;
        return next;
      });
      delete attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId];
    }, ATTACHMENT_PREVIEW_HANDOFF_TTL_MS);
  }, []);
  const serverMessages = activeThread?.messages;
  const timelineMessages = useMemo(() => {
    const messages = serverMessages ?? [];
    const serverMessagesWithPreviewHandoff =
      Object.keys(attachmentPreviewHandoffByMessageId).length === 0
        ? messages
        : // Spread only fires for the few messages that actually changed;
          // unchanged ones early-return their original reference.
          // In-place mutation would break React's immutable state contract.
          // oxlint-disable-next-line no-map-spread
          messages.map((message) => {
            if (
              message.role !== "user" ||
              !message.attachments ||
              message.attachments.length === 0
            ) {
              return message;
            }
            const handoffPreviewUrls = attachmentPreviewHandoffByMessageId[message.id];
            if (!handoffPreviewUrls || handoffPreviewUrls.length === 0) {
              return message;
            }

            let changed = false;
            let imageIndex = 0;
            const attachments = message.attachments.map((attachment) => {
              if (attachment.type !== "image") {
                return attachment;
              }
              const handoffPreviewUrl = handoffPreviewUrls[imageIndex];
              imageIndex += 1;
              if (!handoffPreviewUrl || attachment.previewUrl === handoffPreviewUrl) {
                return attachment;
              }
              changed = true;
              return {
                ...attachment,
                previewUrl: handoffPreviewUrl,
              };
            });

            return changed ? { ...message, attachments } : message;
          });

    if (optimisticUserMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    const serverIds = new Set(serverMessagesWithPreviewHandoff.map((message) => message.id));
    const pendingMessages = optimisticUserMessages.filter((message) => !serverIds.has(message.id));
    if (pendingMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    return [...serverMessagesWithPreviewHandoff, ...pendingMessages];
  }, [serverMessages, attachmentPreviewHandoffByMessageId, optimisticUserMessages]);
  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntries(timelineMessages, activeThread?.proposedPlans ?? [], workLogEntries),
    [activeThread?.proposedPlans, timelineMessages, workLogEntries],
  );
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const turnDiffSummaryByAssistantMessageId = useMemo(() => {
    const byMessageId = new Map<MessageId, TurnDiffSummary>();
    for (const summary of turnDiffSummaries) {
      if (!summary.assistantMessageId) continue;
      byMessageId.set(summary.assistantMessageId, summary);
    }
    return byMessageId;
  }, [turnDiffSummaries]);
  const revertTurnCountByUserMessageId = useMemo(() => {
    const byUserMessageId = new Map<MessageId, number>();
    for (let index = 0; index < timelineEntries.length; index += 1) {
      const entry = timelineEntries[index];
      if (!entry || entry.kind !== "message" || entry.message.role !== "user") {
        continue;
      }

      for (let nextIndex = index + 1; nextIndex < timelineEntries.length; nextIndex += 1) {
        const nextEntry = timelineEntries[nextIndex];
        if (!nextEntry || nextEntry.kind !== "message") {
          continue;
        }
        if (nextEntry.message.role === "user") {
          break;
        }
        const summary = turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id);
        if (!summary) {
          continue;
        }
        const turnCount =
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
        if (typeof turnCount !== "number") {
          break;
        }
        byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1));
        break;
      }
    }

    return byUserMessageId;
  }, [inferredCheckpointTurnCountByTurnId, timelineEntries, turnDiffSummaryByAssistantMessageId]);

  const completionSummary = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!activeLatestTurn?.startedAt) return null;
    if (!activeLatestTurn.completedAt) return null;
    if (!latestTurnHasToolActivity) return null;

    const elapsed = formatElapsed(activeLatestTurn.startedAt, activeLatestTurn.completedAt);
    return elapsed ? `Worked for ${elapsed}` : null;
  }, [
    activeLatestTurn?.completedAt,
    activeLatestTurn?.startedAt,
    latestTurnHasToolActivity,
    latestTurnSettled,
  ]);
  const completionDividerBeforeEntryId = useMemo(() => {
    if (!latestTurnSettled) return null;
    if (!activeLatestTurn?.startedAt) return null;
    if (!activeLatestTurn.completedAt) return null;
    if (!completionSummary) return null;

    const turnStartedAt = Date.parse(activeLatestTurn.startedAt);
    const turnCompletedAt = Date.parse(activeLatestTurn.completedAt);
    if (Number.isNaN(turnStartedAt)) return null;
    if (Number.isNaN(turnCompletedAt)) return null;

    let inRangeMatch: string | null = null;
    let fallbackMatch: string | null = null;
    for (const timelineEntry of timelineEntries) {
      if (timelineEntry.kind !== "message") continue;
      if (timelineEntry.message.role !== "assistant") continue;
      const messageAt = Date.parse(timelineEntry.message.createdAt);
      if (Number.isNaN(messageAt) || messageAt < turnStartedAt) continue;
      fallbackMatch = timelineEntry.id;
      if (messageAt <= turnCompletedAt) {
        inRangeMatch = timelineEntry.id;
      }
    }
    return inRangeMatch ?? fallbackMatch;
  }, [
    activeLatestTurn?.completedAt,
    activeLatestTurn?.startedAt,
    completionSummary,
    latestTurnSettled,
    timelineEntries,
  ]);
  const composerTriggerKind = composerTrigger?.kind ?? null;
  const pathTriggerQuery = composerTrigger?.kind === "path" ? composerTrigger.query : "";
  const isPathTrigger = composerTriggerKind === "path";
  const [debouncedPathQuery, composerPathQueryDebouncer] = useDebouncedValue(
    pathTriggerQuery,
    { wait: COMPOSER_PATH_QUERY_DEBOUNCE_MS },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const effectivePathQuery = pathTriggerQuery.length > 0 ? debouncedPathQuery : "";
  const branchesQuery = useQuery(gitBranchesQueryOptions(gitCwd));
  const keybindings = serverConfigQuery.data?.keybindings ?? EMPTY_KEYBINDINGS;
  const availableEditors = serverConfigQuery.data?.availableEditors ?? EMPTY_AVAILABLE_EDITORS;
  const modelOptionsByProvider = useMemo(
    () => ({
      codex: providerStatuses.find((provider) => provider.provider === "codex")?.models ?? [],
      claudeAgent:
        providerStatuses.find((provider) => provider.provider === "claudeAgent")?.models ?? [],
    }),
    [providerStatuses],
  );
  const selectedModelForPickerWithCustomFallback = useMemo(() => {
    const currentOptions = modelOptionsByProvider[selectedProvider];
    return currentOptions.some((option) => option.slug === selectedModelForPicker)
      ? selectedModelForPicker
      : (normalizeModelSlug(selectedModelForPicker, selectedProvider) ?? selectedModelForPicker);
  }, [modelOptionsByProvider, selectedModelForPicker, selectedProvider]);
  const searchableModelOptions = useMemo(
    () =>
      AVAILABLE_PROVIDER_OPTIONS.filter(
        (option) => lockedProvider === null || option.value === lockedProvider,
      ).flatMap((option) =>
        modelOptionsByProvider[option.value].map(({ slug, name }) => ({
          provider: option.value,
          providerLabel: option.label,
          slug,
          name,
          searchSlug: slug.toLowerCase(),
          searchName: name.toLowerCase(),
          searchProvider: option.label.toLowerCase(),
        })),
      ),
    [lockedProvider, modelOptionsByProvider],
  );
  const workspaceEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: gitCwd,
      query: effectivePathQuery,
      enabled: isPathTrigger,
      limit: 80,
    }),
  );
  const workspaceEntries = workspaceEntriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;
  const workspaceTerminalLogReferenceItems = useMemo(
    () =>
      activeThread && terminalOwnerId
        ? searchWorkspaceTerminalLogReferences({
            threads: [{ ...activeThread, id: terminalOwnerId }],
            terminalStateByThreadId: {
              [terminalOwnerId]: {
                terminalIds: terminalState.terminalIds,
                terminalNamesById: terminalState.terminalNamesById,
              },
            },
            workspaceId: activeThread.workspaceId ?? null,
            activeThreadId: terminalOwnerId,
            query: pathTriggerQuery,
          }).map((reference) => ({
            id: `terminal-log-reference:${reference.threadId}:${reference.terminalId}`,
            type: "terminal-log-reference" as const,
            token: reference.token,
            label: reference.title,
            description: reference.description,
          }))
        : [],
    [
      activeThread,
      pathTriggerQuery,
      terminalOwnerId,
      terminalState.terminalIds,
      terminalState.terminalNamesById,
    ],
  );
  const workspaceSessionReferenceItems = useMemo(
    () =>
      searchSessionReferences({
        threads,
        activeProjectId: activeThread?.projectId ?? null,
        activeWorkspaceId: activeThread?.workspaceId ?? null,
        activeThreadId: activeThread?.id ?? null,
        query: pathTriggerQuery,
      }).map((thread) => ({
        id: `session-reference:${thread.threadId}`,
        type: "session-reference" as const,
        token: thread.token,
        label: thread.title,
        description: thread.description,
      })),
    [
      activeThread?.id,
      activeThread?.projectId,
      activeThread?.workspaceId,
      pathTriggerQuery,
      threads,
    ],
  );
  const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === "path") {
      return [
        ...workspaceTerminalLogReferenceItems,
        ...workspaceSessionReferenceItems,
        ...workspaceEntries.map((entry) => ({
          id: `path:${entry.kind}:${entry.path}`,
          type: "path" as const,
          path: entry.path,
          pathKind: entry.kind,
          label: basenameOfPath(entry.path),
          description: entry.parentPath ?? "",
        })),
      ];
    }

    if (composerTrigger.kind === "slash-command") {
      const slashCommandItems = [
        {
          id: "slash:model",
          type: "slash-command",
          command: "model",
          label: "/model",
          description: "Switch response model for this thread",
        },
        {
          id: "slash:plan",
          type: "slash-command",
          command: "plan",
          label: "/plan",
          description: "Switch this thread into plan mode",
        },
        {
          id: "slash:default",
          type: "slash-command",
          command: "default",
          label: "/default",
          description: "Switch this thread back to normal chat mode",
        },
      ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
      const query = composerTrigger.query.trim().toLowerCase();
      if (!query) {
        return [...slashCommandItems];
      }
      return slashCommandItems.filter(
        (item) => item.command.includes(query) || item.label.slice(1).includes(query),
      );
    }

    return searchableModelOptions
      .filter(({ searchSlug, searchName, searchProvider }) => {
        const query = composerTrigger.query.trim().toLowerCase();
        if (!query) return true;
        return (
          searchSlug.includes(query) || searchName.includes(query) || searchProvider.includes(query)
        );
      })
      .map(({ provider, providerLabel, slug, name }) => ({
        id: `model:${provider}:${slug}`,
        type: "model",
        provider,
        model: slug,
        label: name,
        description: `${providerLabel} · ${slug}`,
      }));
  }, [
    composerTrigger,
    searchableModelOptions,
    workspaceEntries,
    workspaceSessionReferenceItems,
    workspaceTerminalLogReferenceItems,
  ]);
  const composerMenuOpen = Boolean(composerTrigger);
  const activeComposerMenuItem = useMemo(
    () =>
      composerMenuItems.find((item) => item.id === composerHighlightedItemId) ??
      composerMenuItems[0] ??
      null,
    [composerHighlightedItemId, composerMenuItems],
  );
  composerMenuOpenRef.current = composerMenuOpen;
  composerMenuItemsRef.current = composerMenuItems;
  activeComposerMenuItemRef.current = activeComposerMenuItem;
  const nonPersistedComposerImageIdSet = useMemo(
    () => new Set(nonPersistedComposerImageIds),
    [nonPersistedComposerImageIds],
  );
  const activeProviderStatus = useMemo(
    () => providerStatuses.find((status) => status.provider === selectedProvider) ?? null,
    [selectedProvider, providerStatuses],
  );
  const activeProjectCwd = activeProject?.cwd ?? null;
  const activeThreadWorktreePath = activeThread?.worktreePath ?? null;
  const threadTerminalRuntimeEnv = useMemo(() => {
    if (!activeProjectCwd) return {};
    return projectScriptRuntimeEnv({
      project: {
        cwd: activeProjectCwd,
      },
      worktreePath: activeThreadWorktreePath,
    });
  }, [activeProjectCwd, activeThreadWorktreePath]);
  // Default true while loading to avoid toolbar flicker.
  const isGitRepo = branchesQuery.data?.isRepo ?? true;
  const terminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: true,
        terminalOpen: Boolean(terminalState.terminalOpen),
      },
    }),
    [terminalState.terminalOpen],
  );
  const nonTerminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: false,
        terminalOpen: Boolean(terminalState.terminalOpen),
      },
    }),
    [terminalState.terminalOpen],
  );
  const terminalToggleShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.toggle"),
    [keybindings],
  );
  const splitTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.split", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const newTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.new", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const closeTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.close", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const diffPanelShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "diff.toggle", nonTerminalShortcutLabelOptions),
    [keybindings, nonTerminalShortcutLabelOptions],
  );
  const newThreadShortcutLabel = useMemo(
    () =>
      shortcutLabelForCommand(keybindings, "chat.newLocal", nonTerminalShortcutLabelOptions) ??
      shortcutLabelForCommand(keybindings, "chat.new", nonTerminalShortcutLabelOptions),
    [keybindings, nonTerminalShortcutLabelOptions],
  );
  const onToggleDiff = useCallback(() => {
    if (!diffOpen) {
      setActiveWorkspaceTabId("diff");
    } else if (resolvedWorkspaceTabId === "diff") {
      setActiveWorkspaceTabId(defaultConversationWorkspaceTabId);
    }
    void navigate({
      to: "/$threadId",
      params: { threadId },
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return diffOpen ? { ...rest, diff: undefined } : { ...rest, diff: "1" };
      },
    });
  }, [
    defaultConversationWorkspaceTabId,
    diffOpen,
    navigate,
    resolvedWorkspaceTabId,
    setActiveWorkspaceTabId,
    threadId,
  ]);

  const envLocked = Boolean(
    activeThread &&
    (activeThread.messages.length > 0 ||
      (activeThread.session !== null && activeThread.session.status !== "closed")),
  );
  const activeTerminalGroup =
    terminalState.terminalGroups.find(
      (group) => group.id === terminalState.activeTerminalGroupId,
    ) ??
    terminalState.terminalGroups.find((group) =>
      group.terminalIds.includes(terminalState.activeTerminalId),
    ) ??
    null;
  const workspaceTerminalTabIdForGroup = useCallback(
    (groupId: string) => buildTerminalWorkspaceTabId(groupId),
    [],
  );
  const workspaceTerminalTabIdForTerminal = useCallback(
    (terminalId: string) => {
      const groupId =
        findTerminalGroupByTerminalId(terminalState.terminalGroups, terminalId)?.id ??
        terminalGroupIdForTerminal(terminalId);
      return buildTerminalWorkspaceTabId(groupId);
    },
    [terminalState.terminalGroups],
  );
  const firstTerminalWorkspaceTabId = useMemo(
    () => workspaceTabs.find((tab) => tab.kind === "terminal")?.id ?? null,
    [workspaceTabs],
  );
  const hasReachedSplitLimit =
    (activeTerminalGroup?.terminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP;
  const setThreadError = useCallback(
    (targetThreadId: ThreadId | null, error: string | null) => {
      if (!targetThreadId) return;
      if (threads.some((thread) => thread.id === targetThreadId)) {
        setStoreThreadError(targetThreadId, error);
        return;
      }
      setLocalDraftErrorsByThreadId((existing) => {
        if ((existing[targetThreadId] ?? null) === error) {
          return existing;
        }
        return {
          ...existing,
          [targetThreadId]: error,
        };
      });
    },
    [setStoreThreadError, threads],
  );

  const focusComposer = useCallback(() => {
    composerEditorRef.current?.focusAtEnd();
  }, []);
  const scheduleComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      focusComposer();
    });
  }, [focusComposer]);
  const addTerminalContextToDraft = useCallback(
    (selection: TerminalContextSelection) => {
      if (!activeThread) {
        return;
      }
      const snapshot = composerEditorRef.current?.readSnapshot() ?? {
        value: promptRef.current,
        cursor: composerCursor,
        expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
        terminalContextIds: composerTerminalContexts.map((context) => context.id),
      };
      const insertion = insertInlineTerminalContextPlaceholder(
        snapshot.value,
        snapshot.expandedCursor,
      );
      const nextCollapsedCursor = collapseExpandedComposerCursor(
        insertion.prompt,
        insertion.cursor,
      );
      const inserted = insertComposerDraftTerminalContext(
        activeThread.id,
        insertion.prompt,
        {
          id: randomUUID(),
          threadId: activeThread.id,
          createdAt: new Date().toISOString(),
          ...selection,
        },
        insertion.contextIndex,
      );
      if (!inserted) {
        return;
      }
      promptRef.current = insertion.prompt;
      setComposerCursor(nextCollapsedCursor);
      setComposerTrigger(detectComposerTrigger(insertion.prompt, insertion.cursor));
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCollapsedCursor);
      });
    },
    [activeThread, composerCursor, composerTerminalContexts, insertComposerDraftTerminalContext],
  );
  const setTerminalOpen = useCallback(
    (open: boolean) => {
      if (!terminalOwnerId) return;
      storeSetTerminalOpen(terminalOwnerId, open);
    },
    [terminalOwnerId, storeSetTerminalOpen],
  );
  const setTerminalHeight = useCallback(
    (height: number) => {
      if (!terminalOwnerId) return;
      storeSetTerminalHeight(terminalOwnerId, height);
    },
    [terminalOwnerId, storeSetTerminalHeight],
  );
  const showAndFocusActiveTerminal = useCallback(() => {
    if (!terminalOwnerId) return;
    if (!terminalState.terminalOpen) {
      setTerminalOpen(true);
    }
    setActiveWorkspaceTabId(
      firstTerminalWorkspaceTabId ??
        workspaceTerminalTabIdForGroup(terminalState.activeTerminalGroupId),
    );
    setTerminalFocusRequestId((value) => value + 1);
  }, [
    terminalOwnerId,
    firstTerminalWorkspaceTabId,
    setActiveWorkspaceTabId,
    setTerminalOpen,
    terminalState.activeTerminalGroupId,
    terminalState.terminalOpen,
    workspaceTerminalTabIdForGroup,
  ]);
  const toggleTerminalVisibility = useCallback(() => {
    if (!terminalOwnerId) return;
    if (terminalState.terminalOpen && activeWorkspaceTab?.kind === "terminal") {
      setActiveWorkspaceTabId(diffOpen ? "diff" : defaultConversationWorkspaceTabId);
    } else if (!terminalState.terminalOpen) {
      setActiveWorkspaceTabId(
        firstTerminalWorkspaceTabId ??
          workspaceTerminalTabIdForGroup(terminalState.activeTerminalGroupId),
      );
    }
    setTerminalOpen(!terminalState.terminalOpen);
  }, [
    terminalOwnerId,
    activeWorkspaceTab?.kind,
    defaultConversationWorkspaceTabId,
    diffOpen,
    firstTerminalWorkspaceTabId,
    setActiveWorkspaceTabId,
    setTerminalOpen,
    terminalState.activeTerminalGroupId,
    terminalState.terminalOpen,
    workspaceTerminalTabIdForGroup,
  ]);
  const splitTerminal = useCallback(() => {
    if (!terminalOwnerId || hasReachedSplitLimit) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeSplitTerminal(terminalOwnerId, terminalId);
    setActiveWorkspaceTabId(workspaceTerminalTabIdForGroup(terminalState.activeTerminalGroupId));
    setTerminalFocusRequestId((value) => value + 1);
  }, [
    terminalOwnerId,
    hasReachedSplitLimit,
    setActiveWorkspaceTabId,
    storeSplitTerminal,
    terminalState.activeTerminalGroupId,
    workspaceTerminalTabIdForGroup,
  ]);
  const createNewTerminal = useCallback(() => {
    if (!terminalOwnerId) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeNewTerminal(terminalOwnerId, terminalId);
    setActiveWorkspaceTabId(buildTerminalWorkspaceTabId(terminalGroupIdForTerminal(terminalId)));
    setTerminalFocusRequestId((value) => value + 1);
  }, [terminalOwnerId, setActiveWorkspaceTabId, storeNewTerminal]);
  const activateTerminal = useCallback(
    (terminalId: string) => {
      if (!terminalOwnerId) return;
      storeSetActiveTerminal(terminalOwnerId, terminalId);
      setActiveWorkspaceTabId(workspaceTerminalTabIdForTerminal(terminalId));
      setTerminalFocusRequestId((value) => value + 1);
    },
    [
      terminalOwnerId,
      setActiveWorkspaceTabId,
      storeSetActiveTerminal,
      workspaceTerminalTabIdForTerminal,
    ],
  );
  const renameTerminal = useCallback(
    (terminalId: string, terminalName: string) => {
      if (!terminalOwnerId) return;
      storeSetTerminalName(terminalOwnerId, terminalId, terminalName);
    },
    [terminalOwnerId, storeSetTerminalName],
  );
  const closeRenameTerminalDialog = useCallback(() => {
    setRenameTerminalTabTarget(null);
    setRenameTerminalTabValue("");
  }, []);
  const openRenameTerminalDialog = useCallback(
    (tab: Extract<WorkspaceTab, { kind: "terminal" }>) => {
      setRenameTerminalTabTarget({
        terminalId: tab.primaryTerminalId,
        title: tab.title,
      });
      setRenameTerminalTabValue(terminalState.terminalNamesById[tab.primaryTerminalId] ?? "");
    },
    [terminalState.terminalNamesById],
  );
  const submitRenameTerminalDialog = useCallback(() => {
    if (!renameTerminalTabTarget) {
      return;
    }
    renameTerminal(renameTerminalTabTarget.terminalId, renameTerminalTabValue);
    closeRenameTerminalDialog();
  }, [closeRenameTerminalDialog, renameTerminal, renameTerminalTabTarget, renameTerminalTabValue]);
  useEffect(() => {
    if (
      renameTerminalTabTarget &&
      !terminalState.terminalIds.includes(renameTerminalTabTarget.terminalId)
    ) {
      closeRenameTerminalDialog();
    }
  }, [closeRenameTerminalDialog, renameTerminalTabTarget, terminalState.terminalIds]);
  const closeTerminal = useCallback(
    (terminalId: string) => {
      const api = readNativeApi();
      if (!terminalOwnerId || !api) return;
      const latestTerminalState = selectThreadTerminalState(
        useTerminalStateStore.getState().terminalStateByThreadId,
        terminalOwnerId,
      );
      const isFinalTerminal = latestTerminalState.terminalIds.length <= 1;
      const fallbackExitWrite = () =>
        api.terminal
          .write({ threadId: terminalOwnerId, terminalId, data: "exit\n" })
          .catch(() => undefined);
      if ("close" in api.terminal && typeof api.terminal.close === "function") {
        void (async () => {
          if (isFinalTerminal) {
            await api.terminal
              .clear({ threadId: terminalOwnerId, terminalId })
              .catch(() => undefined);
          }
          await api.terminal.close({
            threadId: terminalOwnerId,
            terminalId,
            deleteHistory: true,
          });
        })().catch(() => fallbackExitWrite());
      } else {
        void fallbackExitWrite();
      }
      storeCloseTerminal(terminalOwnerId, terminalId);
      if (isFinalTerminal && activeWorkspaceTab?.kind === "terminal") {
        setActiveWorkspaceTabId(diffOpen ? "diff" : defaultConversationWorkspaceTabId);
      }
      setTerminalFocusRequestId((value) => value + 1);
    },
    [
      terminalOwnerId,
      activeWorkspaceTab?.kind,
      defaultConversationWorkspaceTabId,
      diffOpen,
      setActiveWorkspaceTabId,
      storeCloseTerminal,
    ],
  );
  const onWorkspaceTabContextMenu = useCallback(
    async (tab: WorkspaceTab, position: { x: number; y: number }) => {
      if (tab.kind !== "terminal") {
        return;
      }
      const api = readNativeApi();
      if (!api) {
        return;
      }
      const clicked = await api.contextMenu.show(
        [{ id: "rename-terminal", label: "Rename terminal" }],
        position,
      );
      if (clicked === "rename-terminal") {
        openRenameTerminalDialog(tab);
      }
    },
    [openRenameTerminalDialog],
  );
  const runProjectScript = useCallback(
    async (
      script: ProjectScript,
      options?: {
        cwd?: string;
        env?: Record<string, string>;
        worktreePath?: string | null;
        preferNewTerminal?: boolean;
        rememberAsLastInvoked?: boolean;
      },
    ) => {
      const api = readNativeApi();
      if (!api || !terminalOwnerId || !activeProject || !activeThread) return;
      if (options?.rememberAsLastInvoked !== false) {
        setLastInvokedScriptByProjectId((current) => {
          if (current[activeProject.id] === script.id) return current;
          return { ...current, [activeProject.id]: script.id };
        });
      }
      const targetCwd = options?.cwd ?? gitCwd ?? activeProject.cwd;
      const baseTerminalId =
        terminalState.activeTerminalId ||
        terminalState.terminalIds[0] ||
        DEFAULT_THREAD_TERMINAL_ID;
      const isBaseTerminalBusy = terminalState.runningTerminalIds.includes(baseTerminalId);
      const wantsNewTerminal = Boolean(options?.preferNewTerminal) || isBaseTerminalBusy;
      const shouldCreateNewTerminal = wantsNewTerminal;
      const targetTerminalId = shouldCreateNewTerminal
        ? `terminal-${randomUUID()}`
        : baseTerminalId;

      setTerminalOpen(true);
      if (shouldCreateNewTerminal) {
        storeNewTerminal(terminalOwnerId, targetTerminalId);
        setActiveWorkspaceTabId(
          buildTerminalWorkspaceTabId(terminalGroupIdForTerminal(targetTerminalId)),
        );
      } else {
        storeSetActiveTerminal(terminalOwnerId, targetTerminalId);
        setActiveWorkspaceTabId(workspaceTerminalTabIdForTerminal(targetTerminalId));
      }
      setTerminalFocusRequestId((value) => value + 1);

      const runtimeEnv = projectScriptRuntimeEnv({
        project: {
          cwd: activeProject.cwd,
        },
        worktreePath: options?.worktreePath ?? activeThread.worktreePath ?? null,
        ...(options?.env ? { extraEnv: options.env } : {}),
      });
      const openTerminalInput: Parameters<typeof api.terminal.open>[0] = shouldCreateNewTerminal
        ? {
            threadId: terminalOwnerId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            env: runtimeEnv,
            cols: SCRIPT_TERMINAL_COLS,
            rows: SCRIPT_TERMINAL_ROWS,
          }
        : {
            threadId: terminalOwnerId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            env: runtimeEnv,
          };

      try {
        await api.terminal.open(openTerminalInput);
        await api.terminal.write({
          threadId: terminalOwnerId,
          terminalId: targetTerminalId,
          data: `${script.command}\r`,
        });
      } catch (error) {
        setThreadError(
          activeThreadId ?? terminalOwnerId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
      }
    },
    [
      activeProject,
      activeThread,
      activeThreadId,
      terminalOwnerId,
      gitCwd,
      setActiveWorkspaceTabId,
      setTerminalOpen,
      setThreadError,
      storeNewTerminal,
      storeSetActiveTerminal,
      setLastInvokedScriptByProjectId,
      terminalState.activeTerminalId,
      terminalState.runningTerminalIds,
      terminalState.terminalIds,
      workspaceTerminalTabIdForTerminal,
    ],
  );

  useEffect(() => {
    if (!pendingPullRequestSetupRequest || !activeProject || !activeThreadId || !activeThread) {
      return;
    }
    if (pendingPullRequestSetupRequest.threadId !== activeThreadId) {
      return;
    }
    if (activeThread.worktreePath !== pendingPullRequestSetupRequest.worktreePath) {
      return;
    }

    const setupScript =
      activeProject.scripts.find(
        (script) => script.id === pendingPullRequestSetupRequest.scriptId,
      ) ?? null;
    setPendingPullRequestSetupRequest(null);
    if (!setupScript) {
      return;
    }

    void runProjectScript(setupScript, {
      cwd: pendingPullRequestSetupRequest.worktreePath,
      worktreePath: pendingPullRequestSetupRequest.worktreePath,
      rememberAsLastInvoked: false,
    }).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Failed to run setup script.",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, [
    activeProject,
    activeThread,
    activeThreadId,
    pendingPullRequestSetupRequest,
    runProjectScript,
  ]);
  const persistProjectScripts = useCallback(
    async (input: {
      projectId: ProjectId;
      projectCwd: string;
      previousScripts: ProjectScript[];
      nextScripts: ProjectScript[];
      keybinding?: string | null;
      keybindingCommand: KeybindingCommand;
    }) => {
      const api = readNativeApi();
      if (!api) return;
      const targetProject = projects.find((project) => project.id === input.projectId);
      if (isHomeProject(targetProject)) {
        throw new Error("Home does not support project actions.");
      }

      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: input.projectId,
        scripts: input.nextScripts,
      });

      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding: input.keybinding,
        command: input.keybindingCommand,
      });

      if (isElectron && keybindingRule) {
        await api.server.upsertKeybinding(keybindingRule);
        await queryClient.invalidateQueries({ queryKey: serverQueryKeys.all });
      }
    },
    [projects, queryClient],
  );
  const saveProjectScript = useCallback(
    async (input: NewProjectScriptInput) => {
      if (!activeProject || activeProjectIsHome) return;
      const nextId = nextProjectScriptId(
        input.name,
        activeProject.scripts.map((script) => script.id),
      );
      const nextScript: ProjectScript = {
        id: nextId,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
      };
      const nextScripts = input.runOnWorktreeCreate
        ? [
            ...activeProject.scripts.map((script) =>
              script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
            ),
            nextScript,
          ]
        : [...activeProject.scripts, nextScript];

      await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.cwd,
        previousScripts: activeProject.scripts,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(nextId),
      });
    },
    [activeProject, activeProjectIsHome, persistProjectScripts],
  );
  const updateProjectScript = useCallback(
    async (scriptId: string, input: NewProjectScriptInput) => {
      if (!activeProject || activeProjectIsHome) return;
      const existingScript = activeProject.scripts.find((script) => script.id === scriptId);
      if (!existingScript) {
        throw new Error("Script not found.");
      }

      const updatedScript: ProjectScript = {
        ...existingScript,
        name: input.name,
        command: input.command,
        icon: input.icon,
        runOnWorktreeCreate: input.runOnWorktreeCreate,
      };
      const nextScripts = activeProject.scripts.map((script) =>
        script.id === scriptId
          ? updatedScript
          : input.runOnWorktreeCreate
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );

      await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.cwd,
        previousScripts: activeProject.scripts,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(scriptId),
      });
    },
    [activeProject, activeProjectIsHome, persistProjectScripts],
  );
  const deleteProjectScript = useCallback(
    async (scriptId: string) => {
      if (!activeProject || activeProjectIsHome) return;
      const nextScripts = activeProject.scripts.filter((script) => script.id !== scriptId);

      const deletedName = activeProject.scripts.find((s) => s.id === scriptId)?.name;

      try {
        await persistProjectScripts({
          projectId: activeProject.id,
          projectCwd: activeProject.cwd,
          previousScripts: activeProject.scripts,
          nextScripts,
          keybinding: null,
          keybindingCommand: commandForProjectScript(scriptId),
        });
        toastManager.add({
          type: "success",
          title: `Deleted action "${deletedName ?? "Unknown"}"`,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not delete action",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      }
    },
    [activeProject, activeProjectIsHome, persistProjectScripts],
  );

  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      if (mode === runtimeMode) return;
      setComposerDraftRuntimeMode(threadId, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, { runtimeMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      isLocalDraftThread,
      runtimeMode,
      scheduleComposerFocus,
      setComposerDraftRuntimeMode,
      setDraftThreadContext,
      threadId,
    ],
  );

  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      if (mode === interactionMode) return;
      setComposerDraftInteractionMode(threadId, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, { interactionMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      interactionMode,
      isLocalDraftThread,
      scheduleComposerFocus,
      setComposerDraftInteractionMode,
      setDraftThreadContext,
      threadId,
    ],
  );
  const toggleInteractionMode = useCallback(() => {
    handleInteractionModeChange(interactionMode === "plan" ? "default" : "plan");
  }, [handleInteractionModeChange, interactionMode]);

  const nextRuntimeMode = useCallback((mode: RuntimeMode): RuntimeMode => {
    switch (mode) {
      case "read-only":
        return "approval-required";
      case "approval-required":
        return "full-access";
      case "full-access":
      default:
        return "read-only";
    }
  }, []);

  const togglePlanSidebar = useCallback(() => {
    setPlanSidebarOpen((open) => {
      if (open) {
        const turnKey = activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? null;
        if (turnKey) {
          planSidebarDismissedForTurnRef.current = turnKey;
        }
      } else {
        planSidebarDismissedForTurnRef.current = null;
      }
      return !open;
    });
  }, [activePlan?.turnId, sidebarProposedPlan?.turnId]);

  const persistThreadSettingsForNextTurn = useCallback(
    async (input: {
      threadId: ThreadId;
      createdAt: string;
      modelSelection?: ModelSelection;
      runtimeMode: RuntimeMode;
      interactionMode: ProviderInteractionMode;
    }) => {
      if (!serverThread) {
        return;
      }
      const api = readNativeApi();
      if (!api) {
        return;
      }

      if (
        input.modelSelection !== undefined &&
        (input.modelSelection.model !== serverThread.modelSelection.model ||
          input.modelSelection.provider !== serverThread.modelSelection.provider ||
          JSON.stringify(input.modelSelection.options ?? null) !==
            JSON.stringify(serverThread.modelSelection.options ?? null))
      ) {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: input.threadId,
          modelSelection: input.modelSelection,
        });
      }

      if (input.runtimeMode !== serverThread.runtimeMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.runtime-mode.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          runtimeMode: input.runtimeMode,
          createdAt: input.createdAt,
        });
      }

      if (input.interactionMode !== serverThread.interactionMode) {
        await api.orchestration.dispatchCommand({
          type: "thread.interaction-mode.set",
          commandId: newCommandId(),
          threadId: input.threadId,
          interactionMode: input.interactionMode,
          createdAt: input.createdAt,
        });
      }
    },
    [serverThread],
  );

  // Auto-scroll on new messages
  const messageCount = timelineMessages.length;
  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const scrollContainer = messagesScrollRef.current;
    if (!scrollContainer) return;
    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior });
    lastKnownScrollTopRef.current = scrollContainer.scrollTop;
    shouldAutoScrollRef.current = true;
  }, []);
  const cancelPendingStickToBottom = useCallback(() => {
    const pendingFrame = pendingAutoScrollFrameRef.current;
    if (pendingFrame === null) return;
    pendingAutoScrollFrameRef.current = null;
    window.cancelAnimationFrame(pendingFrame);
  }, []);
  const cancelPendingPinnedScrollToBottom = useCallback(() => {
    const pendingFrame = pendingPinnedScrollFrameRef.current;
    if (pendingFrame === null) return;
    pendingPinnedScrollFrameRef.current = null;
    window.cancelAnimationFrame(pendingFrame);
  }, []);
  const cancelPendingInteractionAnchorAdjustment = useCallback(() => {
    const pendingFrame = pendingInteractionAnchorFrameRef.current;
    if (pendingFrame === null) return;
    pendingInteractionAnchorFrameRef.current = null;
    window.cancelAnimationFrame(pendingFrame);
  }, []);
  const scheduleStickToBottom = useCallback(() => {
    if (pendingAutoScrollFrameRef.current !== null) return;
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null;
      scrollMessagesToBottom();
    });
  }, [scrollMessagesToBottom]);
  const pinMessagesToBottom = useCallback(
    ({
      behavior = "auto",
      lockMs,
    }: {
      behavior?: ScrollBehavior;
      lockMs?: number;
    } = {}) => {
      if (typeof lockMs === "number") {
        stickToBottomLockDeadlineRef.current = Date.now() + Math.max(lockMs, 0);
      }
      pinnedScrollHeightRef.current = null;
      shouldAutoScrollRef.current = true;
      setShowScrollToBottom(false);
      cancelPendingStickToBottom();
      cancelPendingPinnedScrollToBottom();

      const tick = (nextBehavior: ScrollBehavior) => {
        pendingPinnedScrollFrameRef.current = window.requestAnimationFrame(() => {
          pendingPinnedScrollFrameRef.current = null;
          const scrollContainer = messagesScrollRef.current;
          if (!scrollContainer || !shouldAutoScrollRef.current) return;

          scrollMessagesToBottom(nextBehavior);

          const currentScrollHeight = scrollContainer.scrollHeight;
          const previousScrollHeight = pinnedScrollHeightRef.current;
          pinnedScrollHeightRef.current = currentScrollHeight;

          const hasStableScrollHeight =
            previousScrollHeight !== null &&
            Math.abs(previousScrollHeight - currentScrollHeight) < 1;

          if (
            Date.now() <= stickToBottomLockDeadlineRef.current &&
            (!hasStableScrollHeight || !isScrollContainerNearBottom(scrollContainer))
          ) {
            tick("auto");
          }
        });
      };

      tick(behavior);
    },
    [cancelPendingPinnedScrollToBottom, cancelPendingStickToBottom, scrollMessagesToBottom],
  );
  const keepSessionOpenScrolledToBottom = useCallback(() => {
    if (!shouldAutoScrollRef.current) return;
    if (Date.now() > stickToBottomLockDeadlineRef.current) return;
    pinMessagesToBottom();
  }, [pinMessagesToBottom]);
  const onMessagesClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const scrollContainer = messagesScrollRef.current;
      if (!scrollContainer || !(event.target instanceof Element)) return;

      const trigger = event.target.closest<HTMLElement>(
        "button, summary, [role='button'], [data-scroll-anchor-target]",
      );
      if (!trigger || !scrollContainer.contains(trigger)) return;
      if (trigger.closest("[data-scroll-anchor-ignore]")) return;

      pendingInteractionAnchorRef.current = {
        element: trigger,
        top: trigger.getBoundingClientRect().top,
      };

      cancelPendingInteractionAnchorAdjustment();
      pendingInteractionAnchorFrameRef.current = window.requestAnimationFrame(() => {
        pendingInteractionAnchorFrameRef.current = null;
        const anchor = pendingInteractionAnchorRef.current;
        pendingInteractionAnchorRef.current = null;
        const activeScrollContainer = messagesScrollRef.current;
        if (!anchor || !activeScrollContainer) return;
        if (!anchor.element.isConnected || !activeScrollContainer.contains(anchor.element)) return;

        const nextTop = anchor.element.getBoundingClientRect().top;
        const delta = nextTop - anchor.top;
        if (Math.abs(delta) < 0.5) return;

        activeScrollContainer.scrollTop += delta;
        lastKnownScrollTopRef.current = activeScrollContainer.scrollTop;
      });
    },
    [cancelPendingInteractionAnchorAdjustment],
  );
  const forceStickToBottom = useCallback(() => {
    pinMessagesToBottom({ lockMs: SESSION_OPEN_SCROLL_LOCK_MS });
  }, [pinMessagesToBottom]);
  const onMessagesScroll = useCallback(() => {
    const scrollContainer = messagesScrollRef.current;
    if (!scrollContainer) return;
    const currentScrollTop = scrollContainer.scrollTop;
    const isNearBottom = isScrollContainerNearBottom(scrollContainer);

    if (!shouldAutoScrollRef.current && isNearBottom) {
      shouldAutoScrollRef.current = true;
      pendingUserScrollUpIntentRef.current = false;
    } else if (shouldAutoScrollRef.current && pendingUserScrollUpIntentRef.current) {
      const scrolledUp = currentScrollTop < lastKnownScrollTopRef.current - 1;
      if (scrolledUp) {
        shouldAutoScrollRef.current = false;
      }
      pendingUserScrollUpIntentRef.current = false;
    } else if (shouldAutoScrollRef.current && isPointerScrollActiveRef.current) {
      const scrolledUp = currentScrollTop < lastKnownScrollTopRef.current - 1;
      if (scrolledUp) {
        shouldAutoScrollRef.current = false;
      }
    } else if (shouldAutoScrollRef.current && !isNearBottom) {
      // Catch-all for keyboard/assistive scroll interactions.
      const scrolledUp = currentScrollTop < lastKnownScrollTopRef.current - 1;
      if (scrolledUp) {
        shouldAutoScrollRef.current = false;
      }
    }

    setShowScrollToBottom(!shouldAutoScrollRef.current);
    lastKnownScrollTopRef.current = currentScrollTop;
  }, []);
  const onMessagesWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) {
      pendingUserScrollUpIntentRef.current = true;
    }
  }, []);
  const onMessagesPointerDown = useCallback((_event: React.PointerEvent<HTMLDivElement>) => {
    isPointerScrollActiveRef.current = true;
  }, []);
  const onMessagesPointerUp = useCallback((_event: React.PointerEvent<HTMLDivElement>) => {
    isPointerScrollActiveRef.current = false;
  }, []);
  const onMessagesPointerCancel = useCallback((_event: React.PointerEvent<HTMLDivElement>) => {
    isPointerScrollActiveRef.current = false;
  }, []);
  const onMessagesTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    lastTouchClientYRef.current = touch.clientY;
  }, []);
  const onMessagesTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    const previousTouchY = lastTouchClientYRef.current;
    if (previousTouchY !== null && touch.clientY > previousTouchY + 1) {
      pendingUserScrollUpIntentRef.current = true;
    }
    lastTouchClientYRef.current = touch.clientY;
  }, []);
  const onMessagesTouchEnd = useCallback((_event: React.TouchEvent<HTMLDivElement>) => {
    lastTouchClientYRef.current = null;
  }, []);
  useEffect(() => {
    return () => {
      cancelPendingStickToBottom();
      cancelPendingPinnedScrollToBottom();
      cancelPendingInteractionAnchorAdjustment();
    };
  }, [
    cancelPendingInteractionAnchorAdjustment,
    cancelPendingPinnedScrollToBottom,
    cancelPendingStickToBottom,
  ]);
  useLayoutEffect(() => {
    if (!activeThread?.id) return;
    pinMessagesToBottom({ lockMs: SESSION_OPEN_SCROLL_LOCK_MS });
    const timeout = window.setTimeout(() => {
      const scrollContainer = messagesScrollRef.current;
      if (!scrollContainer) return;
      if (isScrollContainerNearBottom(scrollContainer)) return;
      pinMessagesToBottom();
    }, 96);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeThread?.id, pinMessagesToBottom]);
  useLayoutEffect(() => {
    const composerForm = composerFormRef.current;
    if (!composerForm) return;
    const measureComposerFormWidth = () => composerForm.clientWidth;

    composerFormHeightRef.current = composerForm.getBoundingClientRect().height;
    setIsComposerFooterCompact(
      shouldUseCompactComposerFooter(measureComposerFormWidth(), {
        hasWideActions: composerFooterHasWideActions,
      }),
    );
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const [entry] = entries;
      if (!entry) return;

      const nextCompact = shouldUseCompactComposerFooter(measureComposerFormWidth(), {
        hasWideActions: composerFooterHasWideActions,
      });
      setIsComposerFooterCompact((previous) => (previous === nextCompact ? previous : nextCompact));

      const nextHeight = entry.contentRect.height;
      const previousHeight = composerFormHeightRef.current;
      composerFormHeightRef.current = nextHeight;

      if (previousHeight > 0 && Math.abs(nextHeight - previousHeight) < 0.5) return;
      if (!shouldAutoScrollRef.current) return;
      scheduleStickToBottom();
    });

    observer.observe(composerForm);
    return () => {
      observer.disconnect();
    };
  }, [activeThread?.id, composerFooterHasWideActions, scheduleStickToBottom]);
  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    scheduleStickToBottom();
  }, [messageCount, scheduleStickToBottom]);
  useEffect(() => {
    if (phase !== "running") return;
    if (!shouldAutoScrollRef.current) return;
    scheduleStickToBottom();
  }, [phase, scheduleStickToBottom, timelineEntries]);

  useEffect(() => {
    setExpandedWorkGroups({});
    setPullRequestDialogState(null);
    if (planSidebarOpenOnNextThreadRef.current) {
      planSidebarOpenOnNextThreadRef.current = false;
      setPlanSidebarOpen(true);
    } else {
      setPlanSidebarOpen(false);
    }
    planSidebarDismissedForTurnRef.current = null;
  }, [activeThread?.id]);

  useEffect(() => {
    if (!composerMenuOpen) {
      setComposerHighlightedItemId(null);
      return;
    }
    setComposerHighlightedItemId((existing) =>
      existing && composerMenuItems.some((item) => item.id === existing)
        ? existing
        : (composerMenuItems[0]?.id ?? null),
    );
  }, [composerMenuItems, composerMenuOpen]);

  useEffect(() => {
    setIsRevertingCheckpoint(false);
  }, [activeThread?.id]);

  useEffect(() => {
    if (!activeThread?.id || terminalState.terminalOpen) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposer, terminalState.terminalOpen]);

  useEffect(() => {
    composerImagesRef.current = composerImages;
  }, [composerImages]);

  useEffect(() => {
    composerTerminalContextsRef.current = composerTerminalContexts;
  }, [composerTerminalContexts]);

  useEffect(() => {
    composerDiffCommentsRef.current = composerDiffComments;
  }, [composerDiffComments]);

  useEffect(() => {
    if (!activeThread?.id) return;
    if (activeThread.messages.length === 0) {
      return;
    }
    const serverIds = new Set(activeThread.messages.map((message) => message.id));
    const removedMessages = optimisticUserMessages.filter((message) => serverIds.has(message.id));
    if (removedMessages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOptimisticUserMessages((existing) =>
        existing.filter((message) => !serverIds.has(message.id)),
      );
    }, 0);
    for (const removedMessage of removedMessages) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviews(removedMessage.id, previewUrls);
        continue;
      }
      revokeUserMessagePreviewUrls(removedMessage);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThread?.id, activeThread?.messages, handoffAttachmentPreviews, optimisticUserMessages]);

  useEffect(() => {
    promptRef.current = prompt;
    setComposerCursor((existing) => clampCollapsedComposerCursor(prompt, existing));
  }, [prompt]);

  useEffect(() => {
    setOptimisticUserMessages((existing) => {
      for (const message of existing) {
        revokeUserMessagePreviewUrls(message);
      }
      return [];
    });
    setSendPhase("idle");
    setSendStartedAt(null);
    setComposerHighlightedItemId(null);
    setComposerCursor(collapseExpandedComposerCursor(promptRef.current, promptRef.current.length));
    setComposerTrigger(detectComposerTrigger(promptRef.current, promptRef.current.length));
    dragDepthRef.current = 0;
    setIsDragOverComposer(false);
    setExpandedImage(null);
  }, [threadId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (composerImages.length === 0) {
        clearComposerDraftPersistedAttachments(threadId);
        return;
      }
      const getPersistedAttachmentsForThread = () =>
        useComposerDraftStore.getState().draftsByThreadId[threadId]?.persistedAttachments ?? [];
      try {
        const currentPersistedAttachments = getPersistedAttachmentsForThread();
        const existingPersistedById = new Map(
          currentPersistedAttachments.map((attachment) => [attachment.id, attachment]),
        );
        const stagedAttachmentById = new Map<string, PersistedComposerImageAttachment>();
        await Promise.all(
          composerImages.map(async (image) => {
            try {
              const dataUrl = await readFileAsDataUrl(image.file);
              stagedAttachmentById.set(image.id, {
                id: image.id,
                name: image.name,
                mimeType: image.mimeType,
                sizeBytes: image.sizeBytes,
                dataUrl,
              });
            } catch {
              const existingPersisted = existingPersistedById.get(image.id);
              if (existingPersisted) {
                stagedAttachmentById.set(image.id, existingPersisted);
              }
            }
          }),
        );
        const serialized = Array.from(stagedAttachmentById.values());
        if (cancelled) {
          return;
        }
        // Stage attachments in persisted draft state first so persist middleware can write them.
        syncComposerDraftPersistedAttachments(threadId, serialized);
      } catch {
        const currentImageIds = new Set(composerImages.map((image) => image.id));
        const fallbackPersistedAttachments = getPersistedAttachmentsForThread();
        const fallbackPersistedIds = fallbackPersistedAttachments
          .map((attachment) => attachment.id)
          .filter((id) => currentImageIds.has(id));
        const fallbackPersistedIdSet = new Set(fallbackPersistedIds);
        const fallbackAttachments = fallbackPersistedAttachments.filter((attachment) =>
          fallbackPersistedIdSet.has(attachment.id),
        );
        if (cancelled) {
          return;
        }
        syncComposerDraftPersistedAttachments(threadId, fallbackAttachments);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    clearComposerDraftPersistedAttachments,
    composerImages,
    syncComposerDraftPersistedAttachments,
    threadId,
  ]);

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, []);
  const navigateExpandedImage = useCallback((direction: -1 | 1) => {
    setExpandedImage((existing) => {
      if (!existing || existing.images.length <= 1) {
        return existing;
      }
      const nextIndex =
        (existing.index + direction + existing.images.length) % existing.images.length;
      if (nextIndex === existing.index) {
        return existing;
      }
      return { ...existing, index: nextIndex };
    });
  }, []);

  useEffect(() => {
    if (!expandedImage) {
      return;
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeExpandedImage();
        return;
      }
      if (expandedImage.images.length <= 1) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        navigateExpandedImage(-1);
        return;
      }
      if (event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      navigateExpandedImage(1);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeExpandedImage, expandedImage, navigateExpandedImage]);

  const activeWorktreePath = activeThread?.worktreePath;
  const envMode: DraftThreadEnvMode = activeWorktreePath
    ? "worktree"
    : isLocalDraftThread
      ? (draftThread?.envMode ?? "local")
      : "local";

  useEffect(() => {
    if (phase !== "running") return;
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [phase]);

  const beginSendPhase = useCallback((nextPhase: Exclude<SendPhase, "idle">) => {
    setSendStartedAt((current) => current ?? new Date().toISOString());
    setSendPhase(nextPhase);
  }, []);

  const resetSendPhase = useCallback(() => {
    setSendPhase("idle");
    setSendStartedAt(null);
  }, []);

  useEffect(() => {
    if (sendPhase === "idle") {
      return;
    }
    if (
      phase === "running" ||
      activePendingApproval !== null ||
      activePendingUserInput !== null ||
      activeThread?.error
    ) {
      resetSendPhase();
    }
  }, [
    activePendingApproval,
    activePendingUserInput,
    activeThread?.error,
    phase,
    resetSendPhase,
    sendPhase,
  ]);

  useEffect(() => {
    if (!terminalOwnerId) return;
    const previous = terminalOpenByThreadRef.current[terminalOwnerId] ?? false;
    const current = Boolean(terminalState.terminalOpen);

    if (!previous && current) {
      terminalOpenByThreadRef.current[terminalOwnerId] = current;
      setTerminalFocusRequestId((value) => value + 1);
      return;
    } else if (previous && !current) {
      terminalOpenByThreadRef.current[terminalOwnerId] = current;
      const frame = window.requestAnimationFrame(() => {
        focusComposer();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalOpenByThreadRef.current[terminalOwnerId] = current;
  }, [terminalOwnerId, focusComposer, terminalState.terminalOpen]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!activeThreadId || event.defaultPrevented || isWorkspaceCommandPaletteOpen) return;
      if (isFocusComposerShortcut(event)) {
        if (isConnecting || isComposerApprovalState) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (resolvedWorkspaceTabId !== "chat") {
          setActiveWorkspaceTabId("chat");
          window.requestAnimationFrame(() => {
            scheduleComposerFocus();
          });
          return;
        }
        scheduleComposerFocus();
        return;
      }
      const shortcutContext = {
        terminalFocus: isTerminalFocused(),
        terminalOpen: Boolean(terminalState.terminalOpen),
      };

      const command = resolveShortcutCommand(event, keybindings, {
        context: shortcutContext,
      });
      if (!command) return;

      if (command === "terminal.toggle") {
        event.preventDefault();
        event.stopPropagation();
        if (terminalState.terminalOpen && !shortcutContext.terminalFocus) {
          showAndFocusActiveTerminal();
          return;
        }
        toggleTerminalVisibility();
        return;
      }

      if (command === "terminal.split") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) {
          setTerminalOpen(true);
        }
        splitTerminal();
        return;
      }

      if (command === "terminal.close") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) return;
        closeTerminal(terminalState.activeTerminalId);
        return;
      }

      if (command === "terminal.new") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalState.terminalOpen) {
          setTerminalOpen(true);
        }
        createNewTerminal();
        return;
      }

      if (command === "diff.toggle") {
        event.preventDefault();
        event.stopPropagation();
        onToggleDiff();
        return;
      }

      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId || !activeProject) return;
      const script = activeProject.scripts.find((entry) => entry.id === scriptId);
      if (!script) return;
      event.preventDefault();
      event.stopPropagation();
      void runProjectScript(script);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    activeProject,
    isComposerApprovalState,
    isConnecting,
    terminalState.terminalOpen,
    terminalState.activeTerminalId,
    activeThreadId,
    closeTerminal,
    createNewTerminal,
    isWorkspaceCommandPaletteOpen,
    setTerminalOpen,
    runProjectScript,
    showAndFocusActiveTerminal,
    splitTerminal,
    keybindings,
    onToggleDiff,
    resolvedWorkspaceTabId,
    scheduleComposerFocus,
    setActiveWorkspaceTabId,
    toggleTerminalVisibility,
  ]);

  const addComposerImages = (files: File[]) => {
    if (!activeThreadId || files.length === 0) return;

    if (pendingUserInputs.length > 0) {
      toastManager.add({
        type: "error",
        title: "Attach images after answering plan questions.",
      });
      return;
    }

    const { images: nextImages, error } = processImageFiles(
      files,
      composerImagesRef.current.length,
    );

    if (nextImages.length === 1 && nextImages[0]) {
      addComposerImage(nextImages[0]);
    } else if (nextImages.length > 1) {
      addComposerImagesToDraft(nextImages);
    }
    setThreadError(activeThreadId, error);
  };

  const removeComposerImage = (imageId: string) => {
    removeComposerImageFromDraft(imageId);
  };

  const onComposerPaste = (event: React.ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) {
      return;
    }
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return;
    }
    event.preventDefault();
    addComposerImages(imageFiles);
  };

  const onComposerDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOverComposer(true);
  };

  const onComposerDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragOverComposer(true);
  };

  const onComposerDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOverComposer(false);
    }
  };

  const onComposerDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOverComposer(false);
    const files = Array.from(event.dataTransfer.files);
    addComposerImages(files);
    focusComposer();
  };

  const onRevertToTurnCount = useCallback(
    async (turnCount: number) => {
      const api = readNativeApi();
      if (!api || !activeThread || isRevertingCheckpoint) return;

      if (phase === "running" || isSendBusy || isConnecting) {
        setThreadError(activeThread.id, "Interrupt the current turn before reverting checkpoints.");
        return;
      }
      const confirmed = await api.dialogs.confirm(
        [
          `Revert this thread to checkpoint ${turnCount}?`,
          "This will discard newer messages and turn diffs in this thread.",
          "This action cannot be undone.",
        ].join("\n"),
      );
      if (!confirmed) {
        return;
      }

      setIsRevertingCheckpoint(true);
      setThreadError(activeThread.id, null);
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.checkpoint.revert",
          commandId: newCommandId(),
          threadId: activeThread.id,
          turnCount,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        setThreadError(
          activeThread.id,
          err instanceof Error ? err.message : "Failed to revert thread state.",
        );
      }
      setIsRevertingCheckpoint(false);
    },
    [activeThread, isConnecting, isRevertingCheckpoint, isSendBusy, phase, setThreadError],
  );

  const clearComposerInput = useCallback(
    (targetThreadId: ThreadId) => {
      promptRef.current = "";
      clearComposerDraftContent(targetThreadId);
      setComposerHighlightedItemId(null);
      setComposerCursor(0);
      setComposerTrigger(null);
    },
    [clearComposerDraftContent],
  );

  const restorePreparedSubmissionToComposer = useCallback(
    (prepared: PreparedComposerSubmission) => {
      promptRef.current = prepared.restorePrompt;
      setPrompt(prepared.restorePrompt);
      setComposerCursor(
        collapseExpandedComposerCursor(prepared.restorePrompt, prepared.restorePrompt.length),
      );
      addComposerImagesToDraft(prepared.restoreImages.map(cloneComposerImageForRetry));
      addComposerTerminalContextsToDraft(prepared.restoreTerminalContexts);
      addComposerDiffCommentsToDraft(prepared.restoreDiffComments);
      setComposerTrigger(
        detectComposerTrigger(prepared.restorePrompt, prepared.restorePrompt.length),
      );
    },
    [
      addComposerDiffCommentsToDraft,
      addComposerImagesToDraft,
      addComposerTerminalContextsToDraft,
      setPrompt,
    ],
  );

  const prepareComposerSubmission =
    useCallback(async (): Promise<PreparedComposerSubmission | null> => {
      const api = readNativeApi();
      if (!api || !activeThread) {
        return null;
      }

      const promptForSend = promptRef.current;
      const {
        trimmedPrompt: trimmed,
        sendableTerminalContexts,
        sendableDiffComments,
        expiredTerminalContextCount,
        hasSendableContent,
      } = deriveComposerSendState({
        prompt: promptForSend,
        imageCount: composerImages.length,
        terminalContexts: composerTerminalContexts,
        diffComments: composerDiffComments,
      });
      if (!hasSendableContent) {
        if (expiredTerminalContextCount > 0) {
          const toastCopy = buildExpiredTerminalContextToastCopy(
            expiredTerminalContextCount,
            "empty",
          );
          toastManager.add({
            type: "warning",
            title: toastCopy.title,
            description: toastCopy.description,
          });
        }
        return null;
      }

      const composerImagesSnapshot = [...composerImages];
      const composerTerminalContextsSnapshot = [...sendableTerminalContexts];
      const composerDiffCommentsSnapshot = [...sendableDiffComments];
      const promptWithTerminalContexts = appendTerminalContextsToPrompt(
        promptForSend,
        composerTerminalContextsSnapshot,
      );
      const messageTextForSend = appendDiffCommentsToPrompt(
        promptWithTerminalContexts,
        composerDiffCommentsSnapshot,
      );
      const messageTextWithTerminalLogReferences = await appendTerminalLogReferencesToPrompt(
        messageTextForSend,
        async (reference) => {
          try {
            return await api.terminal.readHistory({
              threadId: reference.threadId,
              terminalId: reference.terminalId,
            });
          } catch {
            return null;
          }
        },
      );
      const messageTextWithSessionReferences = appendSessionReferencesToPrompt(
        messageTextWithTerminalLogReferences,
        {
          threads,
          activeProjectId: activeThread.projectId,
          activeWorkspaceId: activeWorkspaceContext.workspaceId,
          currentThreadId: activeThread.id,
        },
      );

      let titleSeed = trimmed;
      if (!titleSeed) {
        if (composerImagesSnapshot[0]) {
          titleSeed = `Image: ${composerImagesSnapshot[0].name}`;
        } else if (composerTerminalContextsSnapshot[0]) {
          titleSeed = formatTerminalContextLabel(composerTerminalContextsSnapshot[0]);
        } else if (composerDiffCommentsSnapshot[0]) {
          titleSeed = formatDiffCommentLabel(composerDiffCommentsSnapshot[0]);
        } else {
          titleSeed = "New thread";
        }
      }

      const formattedText = formatOutgoingPrompt({
        provider: selectedProvider,
        model: selectedModel,
        models: selectedProviderModels,
        effort: selectedPromptEffort,
        text: messageTextWithSessionReferences || IMAGE_ONLY_BOOTSTRAP_PROMPT,
      });
      const attachments = await Promise.all(
        composerImagesSnapshot.map(async (image) => ({
          id: image.id,
          name: image.name,
          mimeType: image.mimeType,
          sizeBytes: image.sizeBytes,
          dataUrl: await readFileAsDataUrl(image.file),
          previewUrl: image.previewUrl,
        })),
      );

      return {
        summary: truncate(trimmed || titleSeed, 120),
        outgoingMessageText: formattedText,
        titleSeed: truncate(titleSeed),
        modelSelection: selectedModelSelection,
        runtimeMode,
        interactionMode,
        attachments,
        restorePrompt: promptForSend,
        restoreImages: composerImagesSnapshot,
        restoreTerminalContexts: composerTerminalContextsSnapshot,
        restoreDiffComments: composerDiffCommentsSnapshot,
        expiredTerminalContextCount,
      };
    }, [
      activeThread,
      activeWorkspaceContext.workspaceId,
      composerDiffComments,
      composerImages,
      composerTerminalContexts,
      interactionMode,
      runtimeMode,
      selectedModel,
      selectedModelSelection,
      selectedPromptEffort,
      selectedProvider,
      selectedProviderModels,
      threads,
    ]);

  const dispatchPreparedComposerSubmission = useCallback(
    async (
      prepared: PreparedComposerSubmission,
      options: {
        queuedMessageId?: string;
        restoreComposerOnFailure: boolean;
        failureMessage: string;
      },
    ): Promise<boolean> => {
      const api = readNativeApi();
      if (!api || !activeThread || !activeProject) {
        return false;
      }

      const threadIdForSend = activeThread.id;
      const isFirstMessage = !isServerThread || activeThread.messages.length === 0;
      const baseBranchForWorktree =
        isFirstMessage && envMode === "worktree" && !activeThread.worktreePath
          ? activeThread.branch
          : null;
      const shouldCreateWorktree =
        isFirstMessage && envMode === "worktree" && !activeThread.worktreePath;
      if (shouldCreateWorktree && !activeThread.branch) {
        const message = "Select a base branch before sending in New worktree mode.";
        setStoreThreadError(threadIdForSend, message);
        if (options.queuedMessageId) {
          markQueuedComposerMessageFailed(threadIdForSend, options.queuedMessageId, message);
        }
        return false;
      }

      sendInFlightRef.current = true;
      beginSendPhase(baseBranchForWorktree ? "preparing-worktree" : "sending-turn");

      const messageIdForSend = newMessageId();
      const messageCreatedAt = new Date().toISOString();
      const optimisticAttachments = prepared.attachments.map((attachment) => ({
        type: "image" as const,
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        ...(attachment.previewUrl ? { previewUrl: attachment.previewUrl } : {}),
      }));
      setOptimisticUserMessages((existing) => [
        ...existing,
        {
          id: messageIdForSend,
          role: "user",
          text: prepared.outgoingMessageText,
          ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
          createdAt: messageCreatedAt,
          streaming: false,
        },
      ]);
      shouldAutoScrollRef.current = true;
      forceStickToBottom();

      setThreadError(threadIdForSend, null);
      if (prepared.expiredTerminalContextCount > 0) {
        const toastCopy = buildExpiredTerminalContextToastCopy(
          prepared.expiredTerminalContextCount,
          "omitted",
        );
        toastManager.add({
          type: "warning",
          title: toastCopy.title,
          description: toastCopy.description,
        });
      }

      let createdServerThreadForLocalDraft = false;
      let turnStartSucceeded = false;
      let nextThreadBranch = activeThread.branch;
      let nextThreadWorktreePath = activeThread.worktreePath;

      await (async () => {
        if (baseBranchForWorktree) {
          beginSendPhase("preparing-worktree");
          const newBranch = buildTemporaryWorktreeBranchName();
          const result = await createWorktreeMutation.mutateAsync({
            cwd: activeProject.cwd,
            branch: baseBranchForWorktree,
            newBranch,
          });
          nextThreadBranch = result.worktree.branch;
          nextThreadWorktreePath = result.worktree.path;
          if (isServerThread) {
            await api.orchestration.dispatchCommand({
              type: "thread.meta.update",
              commandId: newCommandId(),
              threadId: threadIdForSend,
              branch: result.worktree.branch,
              worktreePath: result.worktree.path,
            });
            setStoreThreadBranch(threadIdForSend, result.worktree.branch, result.worktree.path);
          }
        }

        if (isLocalDraftThread) {
          const threadCreateWorkspaceContext = resolveExistingWorkspaceContext({
            workspaceId: activeThread.workspaceId,
            branch: nextThreadBranch,
            worktreePath: nextThreadWorktreePath,
            workspaces,
          });
          await api.orchestration.dispatchCommand({
            type: "thread.create",
            commandId: newCommandId(),
            threadId: threadIdForSend,
            projectId: activeProject.id,
            workspaceId: threadCreateWorkspaceContext.workspaceId,
            title: prepared.titleSeed,
            modelSelection: prepared.modelSelection,
            runtimeMode: prepared.runtimeMode,
            interactionMode: prepared.interactionMode,
            branch: threadCreateWorkspaceContext.branch,
            worktreePath: threadCreateWorkspaceContext.worktreePath,
            createdAt: activeThread.createdAt,
          });
          createdServerThreadForLocalDraft = true;
        }

        const setupScript = baseBranchForWorktree
          ? setupProjectScript(activeProject.scripts)
          : null;
        if (setupScript && (isServerThread || createdServerThreadForLocalDraft)) {
          const setupScriptOptions: Parameters<typeof runProjectScript>[1] = {
            worktreePath: nextThreadWorktreePath,
            rememberAsLastInvoked: false,
          };
          if (nextThreadWorktreePath) {
            setupScriptOptions.cwd = nextThreadWorktreePath;
          }
          await runProjectScript(setupScript, setupScriptOptions);
        }

        if (isFirstMessage && isServerThread) {
          await api.orchestration.dispatchCommand({
            type: "thread.meta.update",
            commandId: newCommandId(),
            threadId: threadIdForSend,
            title: prepared.titleSeed,
          });
        }

        if (isServerThread) {
          await persistThreadSettingsForNextTurn({
            threadId: threadIdForSend,
            createdAt: messageCreatedAt,
            modelSelection: prepared.modelSelection,
            runtimeMode: prepared.runtimeMode,
            interactionMode: prepared.interactionMode,
          });
        }

        beginSendPhase("sending-turn");
        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: prepared.outgoingMessageText,
            attachments: prepared.attachments.map(
              ({ id: _id, previewUrl: _previewUrl, ...rest }) => ({
                type: "image" as const,
                ...rest,
              }),
            ),
          },
          modelSelection: prepared.modelSelection,
          titleSeed: prepared.titleSeed,
          runtimeMode: prepared.runtimeMode,
          interactionMode: prepared.interactionMode,
          createdAt: messageCreatedAt,
        });
        turnStartSucceeded = true;
      })().catch(async (err: unknown) => {
        if (createdServerThreadForLocalDraft && !turnStartSucceeded) {
          await api.orchestration
            .dispatchCommand({
              type: "thread.delete",
              commandId: newCommandId(),
              threadId: threadIdForSend,
            })
            .catch(() => undefined);
        }

        setOptimisticUserMessages((existing) => {
          const removed = existing.filter((message) => message.id === messageIdForSend);
          for (const message of removed) {
            revokeUserMessagePreviewUrls(message);
          }
          const next = existing.filter((message) => message.id !== messageIdForSend);
          return next.length === existing.length ? existing : next;
        });

        if (
          options.restoreComposerOnFailure &&
          promptRef.current.length === 0 &&
          composerImagesRef.current.length === 0 &&
          composerTerminalContextsRef.current.length === 0 &&
          composerDiffCommentsRef.current.length === 0
        ) {
          restorePreparedSubmissionToComposer(prepared);
        }

        const message = err instanceof Error ? err.message : options.failureMessage;
        setThreadError(threadIdForSend, message);
        if (options.queuedMessageId) {
          markQueuedComposerMessageFailed(threadIdForSend, options.queuedMessageId, message);
        }
      });

      sendInFlightRef.current = false;
      if (!turnStartSucceeded) {
        resetSendPhase();
        return false;
      }
      if (options.queuedMessageId) {
        consumeQueuedComposerMessage(threadIdForSend, options.queuedMessageId);
      }
      return true;
    },
    [
      activeProject,
      activeThread,
      beginSendPhase,
      consumeQueuedComposerMessage,
      createWorktreeMutation,
      envMode,
      forceStickToBottom,
      isLocalDraftThread,
      isServerThread,
      markQueuedComposerMessageFailed,
      persistThreadSettingsForNextTurn,
      resetSendPhase,
      restorePreparedSubmissionToComposer,
      runProjectScript,
      setStoreThreadBranch,
      setStoreThreadError,
      setThreadError,
      workspaces,
    ],
  );

  const onQueueMessage = async () => {
    if (!activeThread || activePendingProgress) {
      return;
    }

    const promptForSend = promptRef.current;
    const {
      trimmedPrompt: trimmed,
      sendableTerminalContexts,
      sendableDiffComments,
    } = deriveComposerSendState({
      prompt: promptForSend,
      imageCount: composerImages.length,
      terminalContexts: composerTerminalContexts,
      diffComments: composerDiffComments,
    });
    const standaloneSlashCommand =
      composerImages.length === 0 &&
      sendableTerminalContexts.length === 0 &&
      sendableDiffComments.length === 0
        ? parseStandaloneComposerSlashCommand(trimmed)
        : null;
    if (standaloneSlashCommand) {
      return;
    }

    const prepared = await prepareComposerSubmission();
    if (!prepared) {
      return;
    }

    clearComposerInput(activeThread.id);
    enqueueQueuedComposerMessage(activeThread.id, {
      id: randomUUID(),
      threadId: activeThread.id,
      createdAt: new Date().toISOString(),
      summary: prepared.summary,
      text: prepared.outgoingMessageText,
      titleSeed: prepared.titleSeed,
      attachments: prepared.attachments,
      modelSelection: prepared.modelSelection,
      runtimeMode: prepared.runtimeMode,
      interactionMode: prepared.interactionMode,
      status: "queued",
      error: null,
    });
  };

  const onSend = async (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    const api = readNativeApi();
    if (!api || !activeThread || isSendBusy || isConnecting || sendInFlightRef.current) return;
    if (activePendingProgress) {
      onAdvanceActivePendingUserInput();
      return;
    }

    const promptForSend = promptRef.current;
    const {
      trimmedPrompt: trimmed,
      sendableTerminalContexts,
      sendableDiffComments,
    } = deriveComposerSendState({
      prompt: promptForSend,
      imageCount: composerImages.length,
      terminalContexts: composerTerminalContexts,
      diffComments: composerDiffComments,
    });

    if (showPlanFollowUpPrompt && activeProposedPlan) {
      const followUp = resolvePlanFollowUpSubmission({
        draftText: trimmed,
        planMarkdown: activeProposedPlan.planMarkdown,
      });
      clearComposerInput(activeThread.id);
      await onSubmitPlanFollowUp({
        text: followUp.text,
        interactionMode: followUp.interactionMode,
      });
      return;
    }

    const standaloneSlashCommand =
      composerImages.length === 0 &&
      sendableTerminalContexts.length === 0 &&
      sendableDiffComments.length === 0
        ? parseStandaloneComposerSlashCommand(trimmed)
        : null;
    if (standaloneSlashCommand) {
      handleInteractionModeChange(standaloneSlashCommand);
      clearComposerInput(activeThread.id);
      return;
    }

    const prepared = await prepareComposerSubmission();
    if (!prepared) {
      return;
    }

    clearComposerInput(activeThread.id);
    await dispatchPreparedComposerSubmission(prepared, {
      restoreComposerOnFailure: true,
      failureMessage: "Failed to send message.",
    });
  };

  useEffect(() => {
    const nextQueuedMessage = queuedComposerMessages[0];
    if (!activeThread || !nextQueuedMessage || nextQueuedMessage.status !== "queued") {
      return;
    }
    if (
      sendInFlightRef.current ||
      sendPhase !== "idle" ||
      phase === "running" ||
      isConnecting ||
      activePendingApproval !== null ||
      activePendingUserInput !== null ||
      activeThread.error
    ) {
      return;
    }

    markQueuedComposerMessageSending(activeThread.id, nextQueuedMessage.id);
    void dispatchPreparedComposerSubmission(
      {
        summary: nextQueuedMessage.summary,
        outgoingMessageText: nextQueuedMessage.text,
        titleSeed: nextQueuedMessage.titleSeed,
        modelSelection: nextQueuedMessage.modelSelection,
        runtimeMode: nextQueuedMessage.runtimeMode,
        interactionMode: nextQueuedMessage.interactionMode,
        attachments: nextQueuedMessage.attachments,
        restorePrompt: "",
        restoreImages: [],
        restoreTerminalContexts: [],
        restoreDiffComments: [],
        expiredTerminalContextCount: 0,
      },
      {
        queuedMessageId: nextQueuedMessage.id,
        restoreComposerOnFailure: false,
        failureMessage: "Failed to send queued message.",
      },
    );
  }, [
    activePendingApproval,
    activePendingUserInput,
    activeThread,
    dispatchPreparedComposerSubmission,
    isConnecting,
    markQueuedComposerMessageSending,
    phase,
    queuedComposerMessages,
    sendPhase,
  ]);

  // Auto-send: when the user submitted from NewThreadScreen with content,
  // automatically send the initial message without requiring a second Enter.
  useEffect(() => {
    if (!activeThread || isSendBusy || isConnecting || sendInFlightRef.current) {
      return;
    }
    const shouldAutoSend = consumePendingAutoSend(threadId);
    if (!shouldAutoSend) {
      return;
    }
    void onSend();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally one-shot
  }, [threadId, activeThread, isSendBusy, isConnecting]);

  const onInterrupt = async () => {
    const api = readNativeApi();
    if (!api || !activeThread) return;
    await api.orchestration.dispatchCommand({
      type: "thread.turn.interrupt",
      commandId: newCommandId(),
      threadId: activeThread.id,
      createdAt: new Date().toISOString(),
    });
  };

  const onRespondToApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      const api = readNativeApi();
      if (!api || !activeThreadId) return;

      setRespondingRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "thread.approval.respond",
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          decision,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setStoreThreadError(
            activeThreadId,
            err instanceof Error ? err.message : "Failed to submit approval decision.",
          );
        });
      setRespondingRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeThreadId, setStoreThreadError],
  );

  const onRespondToUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: Record<string, unknown>) => {
      const api = readNativeApi();
      if (!api || !activeThreadId) return;

      setRespondingUserInputRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      await api.orchestration
        .dispatchCommand({
          type: "thread.user-input.respond",
          commandId: newCommandId(),
          threadId: activeThreadId,
          requestId,
          answers,
          createdAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          setStoreThreadError(
            activeThreadId,
            err instanceof Error ? err.message : "Failed to submit user input.",
          );
        });
      setRespondingUserInputRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [activeThreadId, setStoreThreadError],
  );

  const setActivePendingUserInputQuestionIndex = useCallback(
    (nextQuestionIndex: number) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputQuestionIndexByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: nextQuestionIndex,
      }));
    },
    [activePendingUserInput],
  );

  const onSelectActivePendingUserInputOption = useCallback(
    (questionId: string, optionLabel: string) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: {
            selectedOptionLabel: optionLabel,
            customAnswer: "",
          },
        },
      }));
      promptRef.current = "";
      setComposerCursor(0);
      setComposerTrigger(null);
    },
    [activePendingUserInput],
  );

  const onChangeActivePendingUserInputCustomAnswer = useCallback(
    (
      questionId: string,
      value: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
    ) => {
      if (!activePendingUserInput) {
        return;
      }
      promptRef.current = value;
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: setPendingUserInputCustomAnswer(
            existing[activePendingUserInput.requestId]?.[questionId],
            value,
          ),
        },
      }));
      setComposerCursor(nextCursor);
      setComposerTrigger(
        cursorAdjacentToMention ? null : detectComposerTrigger(value, expandedCursor),
      );
    },
    [activePendingUserInput],
  );

  const onAdvanceActivePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || !activePendingProgress) {
      return;
    }
    if (activePendingProgress.isLastQuestion) {
      if (activePendingResolvedAnswers) {
        void onRespondToUserInput(activePendingUserInput.requestId, activePendingResolvedAnswers);
      }
      return;
    }
    setActivePendingUserInputQuestionIndex(activePendingProgress.questionIndex + 1);
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingUserInput,
    onRespondToUserInput,
    setActivePendingUserInputQuestionIndex,
  ]);

  const onPreviousActivePendingUserInputQuestion = useCallback(() => {
    if (!activePendingProgress) {
      return;
    }
    setActivePendingUserInputQuestionIndex(Math.max(activePendingProgress.questionIndex - 1, 0));
  }, [activePendingProgress, setActivePendingUserInputQuestionIndex]);

  const onSubmitPlanFollowUp = useCallback(
    async ({
      text,
      interactionMode: nextInteractionMode,
    }: {
      text: string;
      interactionMode: "default" | "plan";
    }) => {
      const api = readNativeApi();
      if (
        !api ||
        !activeThread ||
        !isServerThread ||
        isSendBusy ||
        isConnecting ||
        sendInFlightRef.current
      ) {
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const threadIdForSend = activeThread.id;
      const messageIdForSend = newMessageId();
      const messageCreatedAt = new Date().toISOString();
      const outgoingMessageText = formatOutgoingPrompt({
        provider: selectedProvider,
        model: selectedModel,
        models: selectedProviderModels,
        effort: selectedPromptEffort,
        text: trimmed,
      });

      sendInFlightRef.current = true;
      beginSendPhase("sending-turn");
      setThreadError(threadIdForSend, null);
      setOptimisticUserMessages((existing) => [
        ...existing,
        {
          id: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          createdAt: messageCreatedAt,
          streaming: false,
        },
      ]);
      shouldAutoScrollRef.current = true;
      forceStickToBottom();

      try {
        await persistThreadSettingsForNextTurn({
          threadId: threadIdForSend,
          createdAt: messageCreatedAt,
          modelSelection: selectedModelSelection,
          runtimeMode,
          interactionMode: nextInteractionMode,
        });

        // Keep the mode toggle and plan-follow-up banner in sync immediately
        // while the same-thread implementation turn is starting.
        setComposerDraftInteractionMode(threadIdForSend, nextInteractionMode);

        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            attachments: [],
          },
          modelSelection: selectedModelSelection,
          titleSeed: activeThread.title,
          runtimeMode,
          interactionMode: nextInteractionMode,
          ...(nextInteractionMode === "default" && activeProposedPlan
            ? {
                sourceProposedPlan: {
                  threadId: activeThread.id,
                  planId: activeProposedPlan.id,
                },
              }
            : {}),
          createdAt: messageCreatedAt,
        });
        // Optimistically open the plan sidebar when implementing (not refining).
        // "default" mode here means the agent is executing the plan, which produces
        // step-tracking activities that the sidebar will display.
        if (nextInteractionMode === "default") {
          planSidebarDismissedForTurnRef.current = null;
          setPlanSidebarOpen(true);
        }
        sendInFlightRef.current = false;
      } catch (err) {
        setOptimisticUserMessages((existing) =>
          existing.filter((message) => message.id !== messageIdForSend),
        );
        setThreadError(
          threadIdForSend,
          err instanceof Error ? err.message : "Failed to send plan follow-up.",
        );
        sendInFlightRef.current = false;
        resetSendPhase();
      }
    },
    [
      activeThread,
      activeProposedPlan,
      beginSendPhase,
      forceStickToBottom,
      isConnecting,
      isSendBusy,
      isServerThread,
      persistThreadSettingsForNextTurn,
      resetSendPhase,
      runtimeMode,
      selectedPromptEffort,
      selectedModelSelection,
      selectedProvider,
      selectedProviderModels,
      setComposerDraftInteractionMode,
      setThreadError,
      selectedModel,
    ],
  );

  const onImplementPlanInNewThread = useCallback(async () => {
    const api = readNativeApi();
    if (
      !api ||
      !activeThread ||
      !activeProject ||
      !activeProposedPlan ||
      !isServerThread ||
      isSendBusy ||
      isConnecting ||
      sendInFlightRef.current
    ) {
      return;
    }

    const createdAt = new Date().toISOString();
    const nextThreadId = newThreadId();
    const planMarkdown = activeProposedPlan.planMarkdown;
    const implementationPrompt = buildPlanImplementationPrompt(planMarkdown);
    const outgoingImplementationPrompt = formatOutgoingPrompt({
      provider: selectedProvider,
      model: selectedModel,
      models: selectedProviderModels,
      effort: selectedPromptEffort,
      text: implementationPrompt,
    });
    const nextThreadTitle = truncate(buildPlanImplementationThreadTitle(planMarkdown));
    const nextThreadModelSelection: ModelSelection = selectedModelSelection;

    sendInFlightRef.current = true;
    beginSendPhase("sending-turn");
    const finish = () => {
      sendInFlightRef.current = false;
      resetSendPhase();
    };
    const implementationWorkspaceContext = resolveExistingWorkspaceContext({
      workspaceId: activeThread.workspaceId,
      branch: activeThread.branch,
      worktreePath: activeThread.worktreePath,
      workspaces,
    });

    await api.orchestration
      .dispatchCommand({
        type: "thread.create",
        commandId: newCommandId(),
        threadId: nextThreadId,
        projectId: activeProject.id,
        workspaceId: implementationWorkspaceContext.workspaceId,
        title: nextThreadTitle,
        modelSelection: nextThreadModelSelection,
        runtimeMode,
        interactionMode: "default",
        branch: implementationWorkspaceContext.branch,
        worktreePath: implementationWorkspaceContext.worktreePath,
        createdAt,
      })
      .then(() => {
        return api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingImplementationPrompt,
            attachments: [],
          },
          modelSelection: selectedModelSelection,
          titleSeed: nextThreadTitle,
          runtimeMode,
          interactionMode: "default",
          createdAt,
        });
      })
      .then(() => api.orchestration.getSnapshot())
      .then((snapshot) => {
        syncServerReadModel(snapshot);
        // Signal that the plan sidebar should open on the new thread.
        planSidebarOpenOnNextThreadRef.current = true;
        return navigate({
          to: "/$threadId",
          params: { threadId: nextThreadId },
        });
      })
      .catch(async (err) => {
        await api.orchestration
          .dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: nextThreadId,
          })
          .catch(() => undefined);
        await api.orchestration
          .getSnapshot()
          .then((snapshot) => {
            syncServerReadModel(snapshot);
          })
          .catch(() => undefined);
        toastManager.add({
          type: "error",
          title: "Could not start implementation thread",
          description:
            err instanceof Error ? err.message : "An error occurred while creating the new thread.",
        });
      })
      .then(finish, finish);
  }, [
    activeProject,
    activeProposedPlan,
    activeThread,
    beginSendPhase,
    isConnecting,
    isSendBusy,
    isServerThread,
    navigate,
    resetSendPhase,
    runtimeMode,
    selectedPromptEffort,
    selectedModelSelection,
    selectedProvider,
    selectedProviderModels,
    syncServerReadModel,
    selectedModel,
    workspaces,
  ]);

  const onProviderModelSelect = useCallback(
    (provider: ProviderKind, model: string) => {
      if (!activeThread) return;
      if (lockedProvider !== null && provider !== lockedProvider) {
        scheduleComposerFocus();
        return;
      }
      const resolvedProvider = resolveSelectableProvider(providerStatuses, provider);
      const resolvedModel = resolveAppModelSelection(
        resolvedProvider,
        settings,
        providerStatuses,
        model,
      );
      const nextModelSelection: ModelSelection = {
        provider: resolvedProvider,
        model: resolvedModel,
      };
      setComposerDraftModelSelection(activeThread.id, nextModelSelection);
      setStickyComposerModelSelection(nextModelSelection);
      scheduleComposerFocus();
    },
    [
      activeThread,
      lockedProvider,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      providerStatuses,
      settings,
    ],
  );
  const setPromptFromTraits = useCallback(
    (nextPrompt: string) => {
      const currentPrompt = promptRef.current;
      if (nextPrompt === currentPrompt) {
        scheduleComposerFocus();
        return;
      }
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
      setComposerCursor(nextCursor);
      setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
      scheduleComposerFocus();
    },
    [scheduleComposerFocus, setPrompt],
  );
  const providerTraitsMenuContent = renderProviderTraitsMenuContent({
    provider: selectedProvider,
    threadId,
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedProvider],
    prompt,
    onPromptChange: setPromptFromTraits,
  });
  const providerTraitsPicker = renderProviderTraitsPicker({
    provider: selectedProvider,
    threadId,
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedProvider],
    prompt,
    onPromptChange: setPromptFromTraits,
  });
  const onEnvModeChange = useCallback(
    (mode: DraftThreadEnvMode) => {
      if (isLocalDraftThread) {
        setDraftThreadContext(threadId, { envMode: mode });
      }
      scheduleComposerFocus();
    },
    [isLocalDraftThread, scheduleComposerFocus, setDraftThreadContext, threadId],
  );

  const applyPromptReplacement = useCallback(
    (
      rangeStart: number,
      rangeEnd: number,
      replacement: string,
      options?: { expectedText?: string },
    ): boolean => {
      const currentText = promptRef.current;
      const safeStart = Math.max(0, Math.min(currentText.length, rangeStart));
      const safeEnd = Math.max(safeStart, Math.min(currentText.length, rangeEnd));
      if (
        options?.expectedText !== undefined &&
        currentText.slice(safeStart, safeEnd) !== options.expectedText
      ) {
        return false;
      }
      const next = replaceTextRange(promptRef.current, rangeStart, rangeEnd, replacement);
      const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
      promptRef.current = next.text;
      const activePendingQuestion = activePendingProgress?.activeQuestion;
      if (activePendingQuestion && activePendingUserInput) {
        setPendingUserInputAnswersByRequestId((existing) => ({
          ...existing,
          [activePendingUserInput.requestId]: {
            ...existing[activePendingUserInput.requestId],
            [activePendingQuestion.id]: setPendingUserInputCustomAnswer(
              existing[activePendingUserInput.requestId]?.[activePendingQuestion.id],
              next.text,
            ),
          },
        }));
      } else {
        setPrompt(next.text);
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(
        detectComposerTrigger(next.text, expandCollapsedComposerCursor(next.text, nextCursor)),
      );
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCursor);
      });
      return true;
    },
    [activePendingProgress?.activeQuestion, activePendingUserInput, setPrompt],
  );

  const readComposerSnapshot = useCallback((): {
    value: string;
    cursor: number;
    expandedCursor: number;
    terminalContextIds: string[];
  } => {
    const editorSnapshot = composerEditorRef.current?.readSnapshot();
    if (editorSnapshot) {
      return editorSnapshot;
    }
    return {
      value: promptRef.current,
      cursor: composerCursor,
      expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
      terminalContextIds: composerTerminalContexts.map((context) => context.id),
    };
  }, [composerCursor, composerTerminalContexts]);

  const resolveActiveComposerTrigger = useCallback((): {
    snapshot: { value: string; cursor: number; expandedCursor: number };
    trigger: ComposerTrigger | null;
  } => {
    const snapshot = readComposerSnapshot();
    return {
      snapshot,
      trigger: detectComposerTrigger(snapshot.value, snapshot.expandedCursor),
    };
  }, [readComposerSnapshot]);

  const onSelectComposerItem = useCallback(
    (item: ComposerCommandItem) => {
      if (composerSelectLockRef.current) return;
      composerSelectLockRef.current = true;
      window.requestAnimationFrame(() => {
        composerSelectLockRef.current = false;
      });
      const { snapshot, trigger } = resolveActiveComposerTrigger();
      if (!trigger) return;
      if (item.type === "path") {
        const replacement = `@${item.path} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          {
            expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
          },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "session-reference") {
        const replacement = `@${item.token} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          {
            expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
          },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "terminal-log-reference") {
        const replacement = `@${item.token} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          {
            expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
          },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "slash-command") {
        if (item.command === "model") {
          const replacement = "/model ";
          const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
            snapshot.value,
            trigger.rangeEnd,
            replacement,
          );
          const applied = applyPromptReplacement(
            trigger.rangeStart,
            replacementRangeEnd,
            replacement,
            {
              expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
            },
          );
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        void handleInteractionModeChange(item.command === "plan" ? "plan" : "default");
        const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
          expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
        });
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      onProviderModelSelect(item.provider, item.model);
      const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
        expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
      });
      if (applied) {
        setComposerHighlightedItemId(null);
      }
    },
    [
      applyPromptReplacement,
      handleInteractionModeChange,
      onProviderModelSelect,
      resolveActiveComposerTrigger,
    ],
  );
  const onComposerMenuItemHighlighted = useCallback((itemId: string | null) => {
    setComposerHighlightedItemId(itemId);
  }, []);
  const nudgeComposerMenuHighlight = useCallback(
    (key: "ArrowDown" | "ArrowUp") => {
      if (composerMenuItems.length === 0) {
        return;
      }
      const highlightedIndex = composerMenuItems.findIndex(
        (item) => item.id === composerHighlightedItemId,
      );
      const normalizedIndex =
        highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
      const offset = key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length;
      const nextItem = composerMenuItems[nextIndex];
      setComposerHighlightedItemId(nextItem?.id ?? null);
    },
    [composerHighlightedItemId, composerMenuItems],
  );
  const isComposerMenuLoading =
    composerTriggerKind === "path" &&
    ((pathTriggerQuery.length > 0 && composerPathQueryDebouncer.state.isPending) ||
      workspaceEntriesQuery.isLoading ||
      workspaceEntriesQuery.isFetching);

  const onPromptChange = useCallback(
    (
      nextPrompt: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
      terminalContextIds: string[],
    ) => {
      if (activePendingProgress?.activeQuestion && activePendingUserInput) {
        onChangeActivePendingUserInputCustomAnswer(
          activePendingProgress.activeQuestion.id,
          nextPrompt,
          nextCursor,
          expandedCursor,
          cursorAdjacentToMention,
        );
        return;
      }
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      if (!terminalContextIdListsEqual(composerTerminalContexts, terminalContextIds)) {
        setComposerDraftTerminalContexts(
          threadId,
          syncTerminalContextsByIds(composerTerminalContexts, terminalContextIds),
        );
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(
        cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
      );
    },
    [
      activePendingProgress?.activeQuestion,
      activePendingUserInput,
      composerTerminalContexts,
      onChangeActivePendingUserInputCustomAnswer,
      setPrompt,
      setComposerDraftTerminalContexts,
      threadId,
    ],
  );

  const onComposerCommandKey = (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
  ) => {
    if (key === "Tab" && event.shiftKey) {
      toggleInteractionMode();
      return true;
    }

    const { trigger } = resolveActiveComposerTrigger();
    const menuIsActive = composerMenuOpenRef.current || trigger !== null;

    if (menuIsActive) {
      const currentItems = composerMenuItemsRef.current;
      if (key === "ArrowDown" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowDown");
        return true;
      }
      if (key === "ArrowUp" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowUp");
        return true;
      }
      if (key === "Tab" || key === "Enter") {
        const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0];
        if (selectedItem) {
          onSelectComposerItem(selectedItem);
          return true;
        }
      }
    }

    if (key === "Tab" && !event.shiftKey) {
      const queueSendState = deriveComposerSendState({
        prompt: promptRef.current,
        imageCount: composerImages.length,
        terminalContexts: composerTerminalContexts,
        diffComments: composerDiffComments,
      });
      const standaloneSlashCommand =
        composerImages.length === 0 &&
        queueSendState.sendableTerminalContexts.length === 0 &&
        queueSendState.sendableDiffComments.length === 0
          ? parseStandaloneComposerSlashCommand(queueSendState.trimmedPrompt)
          : null;
      if (!queueSendState.hasSendableContent || standaloneSlashCommand || showPlanFollowUpPrompt) {
        return false;
      }
      void onQueueMessage();
      return true;
    }

    if (key === "Enter" && !event.shiftKey) {
      void onSend();
      return true;
    }
    return false;
  };
  const onComposerEscapeKey = useCallback(() => requestCancelActiveDiffComment(), []);
  const onToggleWorkGroup = useCallback((groupId: string) => {
    setExpandedWorkGroups((existing) => ({
      ...existing,
      [groupId]: !existing[groupId],
    }));
  }, []);
  const onExpandTimelineImage = useCallback((preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  }, []);
  const expandedImageItem = expandedImage ? expandedImage.images[expandedImage.index] : null;
  const onOpenTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      setActiveWorkspaceTabId("diff");
      void navigate({
        to: "/$threadId",
        params: { threadId },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return filePath
            ? { ...rest, diff: "1", diffTurnId: turnId, diffFilePath: filePath }
            : { ...rest, diff: "1", diffTurnId: turnId };
        },
      });
    },
    [navigate, setActiveWorkspaceTabId, threadId],
  );
  const onRevertUserMessage = (messageId: MessageId) => {
    const targetTurnCount = revertTurnCountByUserMessageId.get(messageId);
    if (typeof targetTurnCount !== "number") {
      return;
    }
    void onRevertToTurnCount(targetTurnCount);
  };
  const isChatWorkspaceActive =
    activeWorkspaceTab?.kind === "chat" ||
    activeWorkspaceTab?.kind === "session" ||
    !activeWorkspaceTab;
  const openReviewWorkspace = useCallback(() => {
    if (!isGitRepo) {
      return;
    }
    if (diffOpen) {
      setActiveWorkspaceTabId("diff");
      return;
    }
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
    setActiveWorkspaceTabId("diff");
  }, [diffOpen, isGitRepo, navigate, setActiveWorkspaceTabId, threadId]);
  const openFilesWorkspace = useCallback(() => {
    if (!activeProjectSupportsWorkspace) {
      return;
    }
    setActiveWorkspaceTabId("files");
  }, [activeProjectSupportsWorkspace, setActiveWorkspaceTabId]);
  const openWorkspaceFileFromPalette = useCallback(
    (relativePath: string) => {
      if (!activeProjectSupportsWorkspace || !activeThreadId) {
        return;
      }
      openWorkspaceEditorFile(activeThreadId, relativePath);
      ensureWorkspaceEditorDirectoriesExpanded(activeThreadId, directoryAncestorsOf(relativePath));
      setActiveWorkspaceTabId(buildFileWorkspaceTabId(relativePath));
    },
    [
      activeProjectSupportsWorkspace,
      activeThreadId,
      ensureWorkspaceEditorDirectoriesExpanded,
      openWorkspaceEditorFile,
      setActiveWorkspaceTabId,
    ],
  );
  const selectWorkspaceTab = useCallback(
    (tabId: WorkspaceTabId) => {
      const targetTab = workspaceTabs.find((tab) => tab.id === tabId);
      if (!targetTab) {
        setActiveWorkspaceTabId(tabId);
        return;
      }

      if (targetTab.kind === "session") {
        setActiveWorkspaceTabId(tabId);
        if (targetTab.threadId !== threadId) {
          void navigate({
            to: "/$threadId",
            params: { threadId: targetTab.threadId },
          });
        }
        return;
      }

      if (!isTerminalWorkspaceTabId(tabId) || targetTab.kind !== "terminal") {
        setActiveWorkspaceTabId(tabId);
        return;
      }

      activateTerminal(targetTab.primaryTerminalId);
    },
    [activateTerminal, navigate, setActiveWorkspaceTabId, threadId, workspaceTabs],
  );
  useWindowKeydownListener(
    (event) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !activeThreadId ||
        isWorkspaceCommandPaletteOpen
      ) {
        return;
      }

      const direction = workspaceTabTraversalDirection(event);
      if (direction === null) {
        return;
      }

      const nextTabId = getAdjacentWorkspaceTabId({
        activeTabId: resolvedWorkspaceTabId,
        tabs: workspaceTabs,
        direction,
      });
      if (!nextTabId || nextTabId === resolvedWorkspaceTabId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      selectWorkspaceTab(nextTabId);
    },
    { enabled: activeThreadId !== null },
  );
  const createSessionWorkspace = useCallback(() => {
    if (!activeProject || !activeThread) {
      return;
    }
    const nextWorkspaceContext = resolveExistingWorkspaceContext({
      workspaceId: activeThread.workspaceId,
      branch: activeThread.branch,
      worktreePath: activeThread.worktreePath,
      workspaces,
    });
    if (!nextWorkspaceContext.workspaceId && !nextWorkspaceContext.worktreePath) {
      return;
    }
    void handleNewThread(activeProject.id, {
      workspaceId: nextWorkspaceContext.workspaceId,
      branch: nextWorkspaceContext.branch,
      worktreePath: nextWorkspaceContext.worktreePath,
      envMode: nextWorkspaceContext.worktreePath
        ? "worktree"
        : (draftThread?.envMode ?? "worktree"),
    });
  }, [activeProject, activeThread, draftThread?.envMode, handleNewThread, workspaces]);
  const createTerminalWorkspace = useCallback(() => {
    if (!activeProjectSupportsWorkspace || !activeProject) {
      return;
    }
    if (
      shouldReuseHiddenDefaultTerminalForWorkspaceCreation({
        terminalOpen: terminalState.terminalOpen,
        terminalIds: terminalState.terminalIds,
      })
    ) {
      setTerminalOpen(true);
      activateTerminal(DEFAULT_THREAD_TERMINAL_ID);
      return;
    }
    if (!terminalState.terminalOpen) {
      setTerminalOpen(true);
    }
    createNewTerminal();
  }, [
    activateTerminal,
    activeProject,
    activeProjectSupportsWorkspace,
    createNewTerminal,
    setTerminalOpen,
    terminalState.terminalIds,
    terminalState.terminalOpen,
  ]);
  const closeWorkspaceTab = useCallback(
    (tabId: WorkspaceTabId) => {
      const targetTab = workspaceTabs.find((tab) => tab.id === tabId);
      if (targetTab?.kind === "session") {
        if (targetTab.isDraft) {
          return;
        }
        void confirmAndArchiveThread(targetTab.threadId, { forceConfirm: true }).catch((error) => {
          toastManager.add({
            type: "error",
            title: "Failed to archive thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        });
        return;
      }

      if (tabId === "diff") {
        if (diffOpen) {
          onToggleDiff();
        }
        return;
      }
      if (tabId === "files") {
        if (resolvedWorkspaceTabId === tabId) {
          const fallbackTabId =
            workspaceTabs.find((tab) => tab.id !== tabId)?.id ?? (diffOpen ? "diff" : "chat");
          setActiveWorkspaceTabId(fallbackTabId);
        }
        return;
      }
      if (isFileWorkspaceTabId(tabId)) {
        const relativePath = tabId.slice("file:".length);
        if (!activeThreadId) {
          return;
        }
        if (resolvedWorkspaceTabId === tabId) {
          const fallbackTabId =
            workspaceTabs.find((tab) => tab.id !== tabId)?.id ?? (diffOpen ? "diff" : "chat");
          setActiveWorkspaceTabId(fallbackTabId);
        }
        const api = readNativeApi();
        if (api && activeProjectSupportsWorkspace && activeProject) {
          void api.projects
            .syncLspDocument({
              cwd: activeProject.cwd,
              relativePath,
              event: "close",
            })
            .catch(() => {
              // Ignore close sync failures; the file tab still needs to close locally.
            });
        }
        closeWorkspaceEditorFile(activeThreadId, relativePath);
        return;
      }
      if (!isTerminalWorkspaceTabId(tabId) || !terminalState.terminalOpen) {
        return;
      }

      const targetTerminalTab = workspaceTabs.find(
        (tab) => tab.kind === "terminal" && tab.id === tabId,
      );
      if (!targetTerminalTab || targetTerminalTab.kind !== "terminal") {
        return;
      }

      if (resolvedWorkspaceTabId === tabId) {
        const fallbackTabId =
          workspaceTabs.find((tab) => tab.id !== tabId)?.id ??
          (diffOpen ? "diff" : defaultConversationWorkspaceTabId);
        setActiveWorkspaceTabId(fallbackTabId);
      }

      targetTerminalTab.terminalIds.forEach((terminalId) => {
        closeTerminal(terminalId);
      });
    },
    [
      activeThreadId,
      activeProject,
      activeProjectSupportsWorkspace,
      closeWorkspaceEditorFile,
      closeTerminal,
      confirmAndArchiveThread,
      diffOpen,
      defaultConversationWorkspaceTabId,
      onToggleDiff,
      resolvedWorkspaceTabId,
      setActiveWorkspaceTabId,
      terminalState.terminalOpen,
      workspaceTabs,
    ],
  );
  const workspaceCommandPaletteItems = useMemo<WorkspaceCommandPaletteItem[]>(() => {
    const paletteThreads = activeThread
      ? [activeThread, ...threads.filter((thread) => thread.id !== activeThread.id)]
      : threads;
    const items = buildWorkspaceCommandPaletteNavigationItems({
      projects,
      threads: paletteThreads,
      activeThreadId: activeThread?.id ?? null,
      selectedProjectId: activeProject?.id ?? null,
      ...(newThreadShortcutLabel ? { newThreadShortcutLabel } : {}),
      onOpenNewThread: () => {
        void navigate({ to: "/" });
      },
      onOpenNewWorkItem: (projectId) => {
        openCreateWorkItemDialog(projectId);
      },
      onOpenWorkSurface: (projectId) => {
        void navigate({
          to: "/work",
          ...(projectId ? { search: { projectId } } : {}),
        });
      },
      onSelectProject: (projectId) => {
        void navigate({
          to: "/",
          search: { projectId },
        });
      },
      onSelectThread: (threadId) => {
        if (threadId === activeThread?.id) {
          return;
        }
        void navigate({
          to: "/$threadId",
          params: { threadId },
        });
      },
    });

    if (activeProjectSupportsWorkspace && activeProject) {
      items.push({
        id: "action:browse-files",
        group: "actions",
        title: "Browse files",
        subtitle: activeProject.name,
        keywords: "explorer files editor workspace",
        icon: FolderIcon,
        onSelect: () => {
          openFilesWorkspace();
        },
      });
      items.push({
        id: "action:new-terminal",
        group: "actions",
        title: "New terminal",
        subtitle: activeProject.name,
        keywords: "create terminal shell tab",
        icon: PlusIcon,
        ...(newTerminalShortcutLabel ? { shortcut: newTerminalShortcutLabel } : {}),
        onSelect: () => {
          if (!terminalState.terminalOpen) {
            setTerminalOpen(true);
          }
          createNewTerminal();
        },
      });
    }

    workspaceTabs.forEach((tab) => {
      if (tab.kind !== "terminal") {
        return;
      }

      const isCurrentTerminalTab = resolvedWorkspaceTabId === tab.id;
      items.push({
        id: `switch:${tab.id}`,
        group: "terminals",
        title: tab.title,
        subtitle: isCurrentTerminalTab
          ? "Current terminal tab"
          : tab.terminalIds.length > 1
            ? `${tab.terminalIds.length} split panes`
            : "Terminal tab",
        keywords: `terminal shell ${tab.title}`,
        icon: TerminalSquareIcon,
        onSelect: () => {
          if (!terminalState.terminalOpen) {
            setTerminalOpen(true);
          }
          activateTerminal(tab.primaryTerminalId);
        },
      });
    });

    return items;
  }, [
    activeProject,
    activeProjectSupportsWorkspace,
    activeThread,
    activateTerminal,
    createNewTerminal,
    navigate,
    newThreadShortcutLabel,
    newTerminalShortcutLabel,
    openCreateWorkItemDialog,
    openFilesWorkspace,
    projects,
    resolvedWorkspaceTabId,
    setTerminalOpen,
    terminalState.terminalOpen,
    threads,
    workspaceTabs,
  ]);

  // Empty state: no active thread
  if (!activeThread) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground/40">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 md:hidden">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0" />
              <span className="text-sm font-medium text-foreground">Threads</span>
            </div>
          </header>
        )}
        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs text-muted-foreground/50">No active thread</span>
          </div>
        )}
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm">Select a thread or create a new one to get started.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
      <div className="border-b border-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--card)_82%,transparent),color-mix(in_srgb,var(--background)_92%,transparent))]">
        <header
          className={cn(
            "px-3 sm:px-5",
            isElectron ? "drag-region flex h-[46px] items-center" : "py-1.5 sm:py-2",
          )}
        >
          <ChatHeader
            activeThreadId={activeThread.id}
            activeThreadTitle={activeThread.title}
            activeProjectName={activeProject?.name}
            activeProjectIsHome={activeProjectIsHome}
            isGitRepo={isGitRepo}
            openInCwd={activeProjectSupportsWorkspace ? gitCwd : null}
            activeProjectScripts={
              activeProjectSupportsWorkspace ? activeProject?.scripts : undefined
            }
            preferredScriptId={
              activeProject ? (lastInvokedScriptByProjectId[activeProject.id] ?? null) : null
            }
            keybindings={keybindings}
            availableEditors={availableEditors}
            terminalAvailable={activeProjectSupportsWorkspace}
            terminalOpen={terminalState.terminalOpen}
            terminalToggleShortcutLabel={terminalToggleShortcutLabel}
            diffToggleShortcutLabel={diffPanelShortcutLabel}
            gitCwd={gitCwd}
            diffOpen={diffOpen}
            onRunProjectScript={(script) => {
              void runProjectScript(script);
            }}
            onAddProjectScript={saveProjectScript}
            onUpdateProjectScript={updateProjectScript}
            onDeleteProjectScript={deleteProjectScript}
            onToggleTerminal={toggleTerminalVisibility}
            onToggleDiff={onToggleDiff}
          />
        </header>

        {activeProjectSupportsWorkspace ? (
          <WorkspaceTabBar
            tabs={workspaceTabs}
            activeTabId={resolvedWorkspaceTabId}
            onSelectTab={selectWorkspaceTab}
            onOpenTabContextMenu={onWorkspaceTabContextMenu}
            onReorderTab={reorderWorkspaceTabs}
            onCloseTab={closeWorkspaceTab}
            canCreateSession={activeWorkspaceContext.workspaceId !== null}
            canCreateTerminal={activeProjectSupportsWorkspace}
            canOpenFiles={activeProjectSupportsWorkspace}
            canOpenReview={isGitRepo}
            onCreateSession={createSessionWorkspace}
            onCreateTerminal={createTerminalWorkspace}
            onOpenFiles={openFilesWorkspace}
            onOpenReview={openReviewWorkspace}
          />
        ) : null}
      </div>

      <ProviderStatusBanner status={activeProviderStatus} />
      <ThreadErrorBanner
        error={activeThread.error}
        onDismiss={() => setThreadError(activeThread.id, null)}
      />
      <WorkspaceCommandPalette
        open={isWorkspaceCommandPaletteOpen}
        onOpenChange={setIsWorkspaceCommandPaletteOpen}
        items={workspaceCommandPaletteItems}
        placeholder="Type command or search threads"
        emptyText="No matching terminal, thread, or action."
      />
      <WorkspaceFilePalette
        open={isWorkspaceFilePaletteOpen}
        onOpenChange={setIsWorkspaceFilePaletteOpen}
        cwd={workspaceFileRoot}
        projectName={activeProject?.name ?? null}
        resolvedTheme={resolvedTheme}
        onSelectFile={
          activeProjectSupportsWorkspace && activeThreadId ? openWorkspaceFileFromPalette : null
        }
        unavailableText="Open a workspace-backed session to browse project files in Flow."
      />
      <WorkItemEditorDialog
        open={workItemDialogState !== null}
        mode={workItemDialogState?.mode ?? "create"}
        values={workItemEditorValues}
        projects={userProjects}
        workspaces={workItemWorkspaceOptions}
        onOpenChange={closeWorkItemDialog}
        onValuesChange={setWorkItemEditorValues}
        onSubmit={handleSubmitWorkItemDialog}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        {isChatWorkspaceActive ? (
          <>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="relative flex min-h-0 flex-1 flex-col">
                <div
                  ref={setMessagesScrollContainerRef}
                  className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 pb-3 pt-3 sm:px-5 sm:pb-4 sm:pt-4"
                  onScroll={onMessagesScroll}
                  onClickCapture={onMessagesClickCapture}
                  onWheel={onMessagesWheel}
                  onPointerDown={onMessagesPointerDown}
                  onPointerUp={onMessagesPointerUp}
                  onPointerCancel={onMessagesPointerCancel}
                  onTouchStart={onMessagesTouchStart}
                  onTouchMove={onMessagesTouchMove}
                  onTouchEnd={onMessagesTouchEnd}
                  onTouchCancel={onMessagesTouchEnd}
                >
                  <MessagesTimeline
                    key={activeThread.id}
                    hasMessages={timelineEntries.length > 0}
                    isWorking={isWorking}
                    activeTurnInProgress={isWorking || !latestTurnSettled}
                    activeTurnStartedAt={activeWorkStartedAt}
                    scrollContainer={messagesScrollElement}
                    timelineEntries={timelineEntries}
                    completionDividerBeforeEntryId={completionDividerBeforeEntryId}
                    completionSummary={completionSummary}
                    turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
                    nowIso={nowIso}
                    expandedWorkGroups={expandedWorkGroups}
                    onToggleWorkGroup={onToggleWorkGroup}
                    onOpenTurnDiff={onOpenTurnDiff}
                    revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
                    onRevertUserMessage={onRevertUserMessage}
                    isRevertingCheckpoint={isRevertingCheckpoint}
                    onImageExpand={onExpandTimelineImage}
                    onLayoutChange={keepSessionOpenScrolledToBottom}
                    markdownCwd={gitCwd ?? undefined}
                    onOpenFileTarget={openFileTargetInWorkspace}
                    resolvedTheme={resolvedTheme}
                    timestampFormat={timestampFormat}
                    workspaceRoot={
                      activeProjectSupportsWorkspace ? (workspaceFileRoot ?? undefined) : undefined
                    }
                  />
                </div>

                {showScrollToBottom && (
                  <div className="pointer-events-none absolute bottom-1 left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        pinMessagesToBottom({
                          behavior: "smooth",
                          lockMs: SESSION_OPEN_SCROLL_LOCK_MS,
                        })
                      }
                      className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-muted-foreground text-xs shadow-sm transition-colors hover:border-border hover:text-foreground hover:cursor-pointer"
                    >
                      <ChevronDownIcon className="size-3.5" />
                      Scroll to bottom
                    </button>
                  </div>
                )}
              </div>

              <div
                className={cn("px-3 pt-1.5 sm:px-5 sm:pt-2", isGitRepo ? "pb-1" : "pb-3 sm:pb-4")}
              >
                <form
                  ref={composerFormRef}
                  onSubmit={onSend}
                  className="mx-auto w-full min-w-0 max-w-3xl"
                  data-chat-composer-form="true"
                >
                  <div
                    className={cn(
                      "group rounded-[22px] p-px transition-colors duration-200",
                      composerProviderState.composerFrameClassName,
                    )}
                    onDragEnter={onComposerDragEnter}
                    onDragOver={onComposerDragOver}
                    onDragLeave={onComposerDragLeave}
                    onDrop={onComposerDrop}
                  >
                    <div
                      className={cn(
                        "rounded-[20px] border bg-card transition-colors duration-200 has-focus-visible:border-ring/45",
                        isDragOverComposer ? "border-primary/70 bg-accent/30" : "border-border",
                        composerProviderState.composerSurfaceClassName,
                      )}
                    >
                      {activePendingApproval ? (
                        <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
                          <ComposerPendingApprovalPanel
                            approval={activePendingApproval}
                            pendingCount={pendingApprovals.length}
                          />
                        </div>
                      ) : pendingUserInputs.length > 0 ? (
                        <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
                          <ComposerPendingUserInputPanel
                            pendingUserInputs={pendingUserInputs}
                            respondingRequestIds={respondingRequestIds}
                            answers={activePendingDraftAnswers}
                            questionIndex={activePendingQuestionIndex}
                            onSelectOption={onSelectActivePendingUserInputOption}
                            onAdvance={onAdvanceActivePendingUserInput}
                          />
                        </div>
                      ) : showPlanFollowUpPrompt && activeProposedPlan ? (
                        <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
                          <ComposerPlanFollowUpBanner
                            key={activeProposedPlan.id}
                            planTitle={proposedPlanTitle(activeProposedPlan.planMarkdown) ?? null}
                          />
                        </div>
                      ) : null}
                      <ComposerQueuePanel
                        queuedMessages={queuedComposerMessages}
                        onRetryMessage={(messageId) =>
                          retryQueuedComposerMessage(threadId, messageId)
                        }
                        onRemoveMessage={(messageId) =>
                          removeQueuedComposerMessage(threadId, messageId)
                        }
                      />
                      <div
                        className={cn(
                          "relative px-3 pb-2 sm:px-4",
                          hasComposerHeader ? "pt-2.5 sm:pt-3" : "pt-3.5 sm:pt-4",
                        )}
                      >
                        {composerMenuOpen && !isComposerApprovalState && (
                          <div className="absolute inset-x-0 bottom-full z-20 mb-2 px-1">
                            <ComposerCommandMenu
                              items={composerMenuItems}
                              resolvedTheme={resolvedTheme}
                              isLoading={isComposerMenuLoading}
                              triggerKind={composerTriggerKind}
                              activeItemId={activeComposerMenuItem?.id ?? null}
                              onHighlightedItemChange={onComposerMenuItemHighlighted}
                              onSelect={onSelectComposerItem}
                            />
                          </div>
                        )}

                        {!isComposerApprovalState &&
                          pendingUserInputs.length === 0 &&
                          composerImages.length > 0 && (
                            <div className="mb-3 flex flex-wrap gap-2">
                              {composerImages.map((image) => (
                                <div
                                  key={image.id}
                                  className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-background"
                                >
                                  {image.previewUrl ? (
                                    <button
                                      type="button"
                                      className="h-full w-full cursor-zoom-in"
                                      aria-label={`Preview ${image.name}`}
                                      onClick={() => {
                                        const preview = buildExpandedImagePreview(
                                          composerImages,
                                          image.id,
                                        );
                                        if (!preview) return;
                                        setExpandedImage(preview);
                                      }}
                                    >
                                      <img
                                        src={image.previewUrl}
                                        alt={image.name}
                                        className="h-full w-full object-cover"
                                      />
                                    </button>
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground/70">
                                      {image.name}
                                    </div>
                                  )}
                                  {nonPersistedComposerImageIdSet.has(image.id) && (
                                    <Tooltip>
                                      <TooltipTrigger
                                        render={
                                          <span
                                            role="img"
                                            aria-label="Draft attachment may not persist"
                                            className="absolute left-1 top-1 inline-flex items-center justify-center rounded bg-background/85 p-0.5 text-amber-600"
                                          >
                                            <CircleAlertIcon className="size-3" />
                                          </span>
                                        }
                                      />
                                      <TooltipPopup
                                        side="top"
                                        className="max-w-64 whitespace-normal leading-tight"
                                      >
                                        Draft attachment could not be saved locally and may be lost
                                        on navigation.
                                      </TooltipPopup>
                                    </Tooltip>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="absolute right-1 top-1 bg-background/80 hover:bg-background/90"
                                    onClick={() => removeComposerImage(image.id)}
                                    aria-label={`Remove ${image.name}`}
                                  >
                                    <XIcon />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        {!isComposerApprovalState &&
                          pendingUserInputs.length === 0 &&
                          composerDiffComments.length > 0 && (
                            <ComposerPendingDiffComments
                              comments={composerDiffComments}
                              className="mb-3"
                              onRemove={removeComposerDiffCommentFromDraft}
                            />
                          )}
                        <ComposerPromptEditor
                          ref={composerEditorRef}
                          value={
                            isComposerApprovalState
                              ? ""
                              : activePendingProgress
                                ? activePendingProgress.customAnswer
                                : prompt
                          }
                          cursor={composerCursor}
                          terminalContexts={
                            !isComposerApprovalState && pendingUserInputs.length === 0
                              ? composerTerminalContexts
                              : []
                          }
                          onRemoveTerminalContext={removeComposerTerminalContextFromDraft}
                          onChange={onPromptChange}
                          onCommandKeyDown={onComposerCommandKey}
                          onEscapeKeyDown={onComposerEscapeKey}
                          onPaste={onComposerPaste}
                          placeholder={
                            isComposerApprovalState
                              ? (activePendingApproval?.detail ??
                                "Resolve this approval request to continue")
                              : activePendingProgress
                                ? "Type your own answer, or leave this blank to use the selected option"
                                : showPlanFollowUpPrompt && activeProposedPlan
                                  ? "Add feedback to refine the plan, or leave this blank to implement it"
                                  : phase === "disconnected"
                                    ? "Ask for follow-up changes or attach images"
                                    : "Ask anything, @tag files/folders, or use / to show available commands"
                          }
                          disabled={isConnecting || isComposerApprovalState}
                        />
                      </div>

                      {activePendingApproval ? (
                        <div className="flex items-center justify-end gap-2 px-2.5 pb-2.5 sm:px-3 sm:pb-3">
                          <ComposerPendingApprovalActions
                            requestId={activePendingApproval.requestId}
                            isResponding={respondingRequestIds.includes(
                              activePendingApproval.requestId,
                            )}
                            onRespondToApproval={onRespondToApproval}
                          />
                        </div>
                      ) : (
                        <div
                          data-chat-composer-footer="true"
                          className={cn(
                            "flex items-center justify-between px-2.5 pb-2.5 sm:px-3 sm:pb-3",
                            isComposerFooterCompact
                              ? "gap-1.5"
                              : "flex-wrap gap-2 sm:flex-nowrap sm:gap-0",
                          )}
                        >
                          <div
                            className={cn(
                              "flex min-w-0 flex-1 items-center",
                              isComposerFooterCompact
                                ? "gap-1 overflow-hidden"
                                : "gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:min-w-max sm:overflow-visible",
                            )}
                          >
                            <ProviderModelPicker
                              compact={isComposerFooterCompact}
                              provider={selectedProvider}
                              model={selectedModelForPickerWithCustomFallback}
                              lockedProvider={lockedProvider}
                              providers={providerStatuses}
                              modelOptionsByProvider={modelOptionsByProvider}
                              {...(composerProviderState.modelPickerIconClassName
                                ? {
                                    activeProviderIconClassName:
                                      composerProviderState.modelPickerIconClassName,
                                  }
                                : {})}
                              onProviderModelChange={onProviderModelSelect}
                            />

                            {isComposerFooterCompact ? (
                              <CompactComposerControlsMenu
                                activePlan={Boolean(
                                  activePlan || sidebarProposedPlan || planSidebarOpen,
                                )}
                                interactionMode={interactionMode}
                                planSidebarOpen={planSidebarOpen}
                                runtimeMode={runtimeMode}
                                traitsMenuContent={providerTraitsMenuContent}
                                onToggleInteractionMode={toggleInteractionMode}
                                onTogglePlanSidebar={togglePlanSidebar}
                                onRuntimeModeChange={handleRuntimeModeChange}
                              />
                            ) : (
                              <>
                                {providerTraitsPicker ? (
                                  <>
                                    <Separator
                                      orientation="vertical"
                                      className="mx-0.5 hidden h-4 sm:block"
                                    />
                                    {providerTraitsPicker}
                                  </>
                                ) : null}

                                <Separator
                                  orientation="vertical"
                                  className="mx-0.5 hidden h-4 sm:block"
                                />

                                <Button
                                  variant="ghost"
                                  className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
                                  size="sm"
                                  type="button"
                                  onClick={toggleInteractionMode}
                                  title={
                                    interactionMode === "plan"
                                      ? "Plan mode — click to return to normal chat mode"
                                      : "Default mode — click to enter plan mode"
                                  }
                                >
                                  <BotIcon />
                                  <span className="sr-only sm:not-sr-only">
                                    {interactionMode === "plan" ? "Plan" : "Chat"}
                                  </span>
                                </Button>

                                <Separator
                                  orientation="vertical"
                                  className="mx-0.5 hidden h-4 sm:block"
                                />

                                <Button
                                  variant="ghost"
                                  className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
                                  size="sm"
                                  type="button"
                                  onClick={() =>
                                    void handleRuntimeModeChange(nextRuntimeMode(runtimeMode))
                                  }
                                  title={
                                    runtimeMode === "full-access"
                                      ? "Full access — click for read-only mode"
                                      : runtimeMode === "approval-required"
                                        ? "Supervised — click for full access"
                                        : "Read-only — click for supervised mode"
                                  }
                                >
                                  {runtimeMode === "full-access" ? <LockOpenIcon /> : <LockIcon />}
                                  <span className="sr-only sm:not-sr-only">
                                    {runtimeMode === "full-access"
                                      ? "Full access"
                                      : runtimeMode === "approval-required"
                                        ? "Supervised"
                                        : "Read-only"}
                                  </span>
                                </Button>

                                {activePlan || sidebarProposedPlan || planSidebarOpen ? (
                                  <>
                                    <Separator
                                      orientation="vertical"
                                      className="mx-0.5 hidden h-4 sm:block"
                                    />
                                    <Button
                                      variant="ghost"
                                      className={cn(
                                        "shrink-0 whitespace-nowrap px-2 sm:px-3",
                                        planSidebarOpen
                                          ? "text-blue-400 hover:text-blue-300"
                                          : "text-muted-foreground/70 hover:text-foreground/80",
                                      )}
                                      size="sm"
                                      type="button"
                                      onClick={togglePlanSidebar}
                                      title={
                                        planSidebarOpen ? "Hide plan sidebar" : "Show plan sidebar"
                                      }
                                    >
                                      <ListTodoIcon />
                                      <span className="sr-only sm:not-sr-only">Plan</span>
                                    </Button>
                                  </>
                                ) : null}
                              </>
                            )}
                          </div>

                          <div
                            data-chat-composer-actions="right"
                            className="flex shrink-0 items-center gap-2"
                          >
                            {activeContextWindow ? (
                              <ContextWindowMeter usage={activeContextWindow} />
                            ) : null}
                            {isPreparingWorktree ? (
                              <span className="text-muted-foreground/70 text-xs">
                                Preparing worktree...
                              </span>
                            ) : null}
                            {pendingUserInputs.length === 0 && !showPlanFollowUpPrompt ? (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="rounded-full px-3"
                                      onClick={() => void onQueueMessage()}
                                      disabled={!composerSendState.hasSendableContent}
                                    >
                                      <ListOrderedIcon className="size-3.5" />
                                      <span className="hidden sm:inline">Queue</span>
                                    </Button>
                                  }
                                />
                                <TooltipPopup
                                  side="top"
                                  align="end"
                                  className="max-w-56 whitespace-normal leading-tight"
                                >
                                  Press{" "}
                                  <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[11px]">
                                    Tab
                                  </kbd>{" "}
                                  to queue this message.
                                </TooltipPopup>
                              </Tooltip>
                            ) : null}
                            {activePendingProgress ? (
                              <div className="flex items-center gap-2">
                                {activePendingProgress.questionIndex > 0 ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="rounded-full"
                                    onClick={onPreviousActivePendingUserInputQuestion}
                                    disabled={activePendingIsResponding}
                                  >
                                    Previous
                                  </Button>
                                ) : null}
                                <Button
                                  type="submit"
                                  size="sm"
                                  className="rounded-full px-4"
                                  disabled={
                                    activePendingIsResponding ||
                                    (activePendingProgress.isLastQuestion
                                      ? !activePendingResolvedAnswers
                                      : !activePendingProgress.canAdvance)
                                  }
                                >
                                  {activePendingIsResponding
                                    ? "Submitting..."
                                    : activePendingProgress.isLastQuestion
                                      ? "Submit answers"
                                      : "Next question"}
                                </Button>
                              </div>
                            ) : phase === "running" ? (
                              <button
                                type="button"
                                className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-rose-500/90 text-white transition-all duration-150 hover:bg-rose-500 hover:scale-105 sm:h-8 sm:w-8"
                                onClick={() => void onInterrupt()}
                                aria-label="Stop generation"
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 12 12"
                                  fill="currentColor"
                                  aria-hidden="true"
                                >
                                  <rect x="2" y="2" width="8" height="8" rx="1.5" />
                                </svg>
                              </button>
                            ) : pendingUserInputs.length === 0 ? (
                              showPlanFollowUpPrompt ? (
                                prompt.trim().length > 0 ? (
                                  <Button
                                    type="submit"
                                    size="sm"
                                    className="h-9 rounded-full px-4 sm:h-8"
                                    disabled={isSendBusy || isConnecting}
                                  >
                                    {isConnecting || isSendBusy ? "Sending..." : "Refine"}
                                  </Button>
                                ) : (
                                  <div className="flex items-center">
                                    <Button
                                      type="submit"
                                      size="sm"
                                      className="h-9 rounded-l-full rounded-r-none px-4 sm:h-8"
                                      disabled={isSendBusy || isConnecting}
                                    >
                                      {isConnecting || isSendBusy ? "Sending..." : "Implement"}
                                    </Button>
                                    <Menu>
                                      <MenuTrigger
                                        render={
                                          <Button
                                            size="sm"
                                            variant="default"
                                            className="h-9 rounded-l-none rounded-r-full border-l-white/12 px-2 sm:h-8"
                                            aria-label="Implementation actions"
                                            disabled={isSendBusy || isConnecting}
                                          />
                                        }
                                      >
                                        <ChevronDownIcon className="size-3.5" />
                                      </MenuTrigger>
                                      <MenuPopup align="end" side="top">
                                        <MenuItem
                                          disabled={isSendBusy || isConnecting}
                                          onClick={() => void onImplementPlanInNewThread()}
                                        >
                                          Implement in a new thread
                                        </MenuItem>
                                      </MenuPopup>
                                    </Menu>
                                  </div>
                                )
                              ) : (
                                <button
                                  type="submit"
                                  className="flex h-9 w-9 enabled:cursor-pointer items-center justify-center rounded-full bg-primary/90 text-primary-foreground transition-all duration-150 hover:bg-primary hover:scale-105 disabled:pointer-events-none disabled:opacity-30 disabled:hover:scale-100 sm:h-8 sm:w-8"
                                  disabled={
                                    isSendBusy ||
                                    isConnecting ||
                                    !composerSendState.hasSendableContent
                                  }
                                  aria-label={
                                    isConnecting
                                      ? "Connecting"
                                      : isPreparingWorktree
                                        ? "Preparing worktree"
                                        : isSendBusy
                                          ? "Sending"
                                          : "Send message"
                                  }
                                >
                                  {isConnecting || isSendBusy ? (
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 14 14"
                                      fill="none"
                                      className="animate-spin"
                                      aria-hidden="true"
                                    >
                                      <circle
                                        cx="7"
                                        cy="7"
                                        r="5.5"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeDasharray="20 12"
                                      />
                                    </svg>
                                  ) : (
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 14 14"
                                      fill="none"
                                      aria-hidden="true"
                                    >
                                      <path
                                        d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  )}
                                </button>
                              )
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </form>
              </div>

              {activeProjectSupportsWorkspace && isGitRepo && (
                <BranchToolbar
                  threadId={activeThread.id}
                  onEnvModeChange={onEnvModeChange}
                  envLocked={envLocked}
                  onComposerFocusRequest={scheduleComposerFocus}
                  {...(canCheckoutPullRequestIntoThread
                    ? { onCheckoutPullRequestRequest: openPullRequestDialog }
                    : {})}
                />
              )}
              {pullRequestDialogState ? (
                <PullRequestThreadDialog
                  key={pullRequestDialogState.key}
                  open
                  cwd={activeProjectSupportsWorkspace ? (activeProject?.cwd ?? null) : null}
                  initialReference={pullRequestDialogState.initialReference}
                  onOpenChange={(open) => {
                    if (!open) {
                      closePullRequestDialog();
                    }
                  }}
                  onPrepared={handlePreparedPullRequestThread}
                />
              ) : null}
            </div>

            {planSidebarOpen ? (
              <PlanSidebar
                activePlan={activePlan}
                activeProposedPlan={sidebarProposedPlan}
                markdownCwd={gitCwd ?? undefined}
                workspaceRoot={
                  activeProjectSupportsWorkspace ? (workspaceFileRoot ?? undefined) : undefined
                }
                timestampFormat={timestampFormat}
                onOpenFileTarget={openFileTargetInWorkspace}
                onClose={() => {
                  setPlanSidebarOpen(false);
                  const turnKey = activePlan?.turnId ?? sidebarProposedPlan?.turnId ?? null;
                  if (turnKey) {
                    planSidebarDismissedForTurnRef.current = turnKey;
                  }
                }}
              />
            ) : null}
          </>
        ) : (activeFilesWorkspaceTab || activeFileWorkspaceTab) &&
          activeProjectSupportsWorkspace &&
          activeProject ? (
          <div className="flex-1 overflow-hidden">
            <WorkspaceEditorSurface
              threadId={activeThread.id}
              workspaceRoot={workspaceFileRoot ?? activeProject.cwd}
              resolvedTheme={resolvedTheme}
              activeRelativePath={activeFileWorkspaceTab?.relativePath ?? null}
              onSelectWorkspaceTab={selectWorkspaceTab}
            />
          </div>
        ) : activeWorkspaceTab?.kind === "diff" ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <ThreadDiffWorkspace mode="sheet" />
          </div>
        ) : activeTerminalWorkspaceTab && activeProjectSupportsWorkspace && activeProject ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <ThreadTerminalDrawer
              key={`${terminalOwnerId}:${activeTerminalWorkspaceTab.terminalGroupId}`}
              variant="panel"
              threadId={terminalOwnerId ?? activeThread.id}
              cwd={gitCwd ?? activeProject.cwd}
              runtimeEnv={threadTerminalRuntimeEnv}
              terminalIds={activeTerminalWorkspaceTab.terminalIds}
              terminalNamesById={terminalState.terminalNamesById}
              activeTerminalId={
                activeTerminalWorkspaceTab.terminalIds.includes(terminalState.activeTerminalId)
                  ? terminalState.activeTerminalId
                  : activeTerminalWorkspaceTab.primaryTerminalId
              }
              terminalGroups={[
                {
                  id: activeTerminalWorkspaceTab.terminalGroupId,
                  terminalIds: activeTerminalWorkspaceTab.terminalIds,
                },
              ]}
              activeTerminalGroupId={activeTerminalWorkspaceTab.terminalGroupId}
              focusRequestId={terminalFocusRequestId}
              onSplitTerminal={splitTerminal}
              onNewTerminal={createNewTerminal}
              splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
              newShortcutLabel={newTerminalShortcutLabel ?? undefined}
              closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
              onActiveTerminalChange={activateTerminal}
              onCloseTerminal={closeTerminal}
              onHeightChange={setTerminalHeight}
              onAddTerminalContext={addTerminalContextToDraft}
            />
          </div>
        ) : null}
      </div>

      {expandedImage && expandedImageItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 [-webkit-app-region:no-drag]"
          role="dialog"
          aria-modal="true"
          aria-label="Expanded image preview"
        >
          <button
            type="button"
            className="absolute inset-0 z-0 cursor-zoom-out"
            aria-label="Close image preview"
            onClick={closeExpandedImage}
          />
          {expandedImage.images.length > 1 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute left-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:left-6"
              aria-label="Previous image"
              onClick={() => {
                navigateExpandedImage(-1);
              }}
            >
              <ChevronLeftIcon className="size-5" />
            </Button>
          )}
          <div className="relative isolate z-10 max-h-[92vh] max-w-[92vw]">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="absolute right-2 top-2"
              onClick={closeExpandedImage}
              aria-label="Close image preview"
            >
              <XIcon />
            </Button>
            <img
              src={expandedImageItem.src}
              alt={expandedImageItem.name}
              className="max-h-[86vh] max-w-[92vw] select-none rounded-lg border border-border/70 bg-background object-contain shadow-2xl"
              draggable={false}
            />
            <p className="mt-2 max-w-[92vw] truncate text-center text-xs text-muted-foreground/80">
              {expandedImageItem.name}
              {expandedImage.images.length > 1
                ? ` (${expandedImage.index + 1}/${expandedImage.images.length})`
                : ""}
            </p>
          </div>
          {expandedImage.images.length > 1 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute right-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:right-6"
              aria-label="Next image"
              onClick={() => {
                navigateExpandedImage(1);
              }}
            >
              <ChevronRightIcon className="size-5" />
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={renameTerminalTabTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeRenameTerminalDialog();
          }
        }}
      >
        <DialogPopup className="max-w-xs" showCloseButton={false}>
          <DialogHeader className="gap-1 p-4 pb-2">
            <DialogTitle className="text-sm">Rename terminal</DialogTitle>
            <DialogDescription className="text-xs">
              Leave blank to use the default name.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-2 px-4 pb-2 pt-0">
            <Input
              nativeInput
              autoFocus
              value={renameTerminalTabValue}
              placeholder={renameTerminalTabTarget?.title ?? "Terminal"}
              size="sm"
              onChange={(event) => setRenameTerminalTabValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }
                event.preventDefault();
                submitRenameTerminalDialog();
              }}
            />
          </DialogPanel>
          <DialogFooter variant="bare" className="px-4 pb-4 pt-0">
            <Button size="sm" variant="outline" onClick={closeRenameTerminalDialog}>
              Cancel
            </Button>
            <Button size="sm" onClick={submitRenameTerminalDialog}>
              Save
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
