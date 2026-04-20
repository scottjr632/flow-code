import type {
  ProjectEntry,
  ProjectId,
  ProviderInteractionMode,
  ProviderKind,
  ProviderModelOptions,
  RuntimeMode,
  ServerProvider,
  ThreadId,
  WorkspaceId,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpIcon,
  BotIcon,
  FolderIcon,
  ImageIcon,
  LockIcon,
  LockOpenIcon,
  MessageSquareTextIcon,
  XIcon,
} from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "~/lib/utils";

import { isElectron } from "../env";
import { useCreateWorkItemDialog } from "../hooks/useCreateWorkItemDialog";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useTheme } from "../hooks/useTheme";
import { useWorkspaceCommandPalette } from "../hooks/useWorkspaceCommandPalette";
import { useWorkspaceFilePalette } from "../hooks/useWorkspaceFilePalette";
import { formatShortcutLabel } from "../keybindings";
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  extendReplacementRangeForTrailingSpace,
  expandCollapsedComposerCursor,
  replaceTextRange,
  type ComposerTrigger,
} from "../composer-logic";
import { gitBranchesQueryOptions, gitCreateWorktreeMutationOptions } from "../lib/gitReactQuery";
import { projectSearchEntriesQueryOptions } from "../lib/projectReactQuery";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { selectThreadMruIds, useStore } from "../store";
import {
  type Thread,
  type Workspace,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_INTERACTION_MODE,
} from "../types";
import { isHomeProject, isUserProject } from "../systemProject";
import { type ComposerImageAttachment, useComposerDraftStore } from "../composerDraftStore";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import {
  getDefaultServerModel,
  getProviderModels,
  resolveSelectableProvider,
} from "../providerModels";
import { resolveAppModelSelection } from "../modelSelection";
import { useSettings } from "../hooks/useSettings";
import { resolveNewWorkspaceBaseBranch } from "../threadLaunch";
import { ProjectFavicon } from "./ProjectFavicon";
import { buildTemporaryWorktreeBranchName, processImageFiles } from "./ChatView.logic";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "./ComposerPromptEditor";
import { deriveDefaultWorkspaceTitle, type SidebarNewThreadEnvMode } from "./Sidebar.logic";
import { WorkItemEditorDialog } from "./WorkItemEditorDialog";
import { ComposerCommandMenu, type ComposerCommandItem } from "./chat/ComposerCommandMenu";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";
import { TraitsPicker } from "./chat/TraitsPicker";
import { toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import { SegmentGroup, SegmentItem } from "./ui/segment-group";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "./ui/select";
import { Separator } from "./ui/separator";
import { SidebarTrigger } from "./ui/sidebar";
import { isMacPlatform } from "../lib/utils";
import { WorkspaceCommandPalette } from "./WorkspaceCommandPalette";
import { WorkspaceFilePalette } from "./WorkspaceFilePalette";
import { buildWorkspaceCommandPaletteNavigationItems } from "../workspaceCommandPaletteItems";
import { basenameOfPath } from "../vscode-icons";

const LOCAL_TARGET_VALUE = "local";
const NEW_WORKSPACE_TARGET_VALUE = "new-workspace";
const EMPTY_PROJECT_ENTRIES: ProjectEntry[] = [];
const NEW_THREAD_PATH_QUERY_DEBOUNCE_MS = 120;

const EMPTY_PROVIDERS: ServerProvider[] = [];
type PathComposerTrigger = ComposerTrigger & { kind: "path" };

function toSortableTimestamp(iso: string | undefined): number {
  if (!iso) {
    return Number.NEGATIVE_INFINITY;
  }

  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function resolveInitialProjectId(
  projects: ReadonlyArray<{ id: ProjectId }>,
  threads: ReadonlyArray<Thread>,
  threadMruIds: ReadonlyArray<ThreadId>,
  requestedProjectId?: string,
): ProjectId | null {
  if (requestedProjectId) {
    const requestedProject = projects.find((project) => project.id === requestedProjectId);
    if (requestedProject) {
      return requestedProject.id;
    }
  }

  const availableProjectIds = new Set(projects.map((project) => project.id));
  const activeThreadsById = new Map(
    threads
      .filter((thread) => thread.archivedAt === null && availableProjectIds.has(thread.projectId))
      .map((thread) => [thread.id, thread] as const),
  );

  for (const threadId of threadMruIds) {
    const thread = activeThreadsById.get(threadId);
    if (thread) {
      return thread.projectId;
    }
  }

  const mostRecentThread = threads
    .filter((thread) => thread.archivedAt === null && availableProjectIds.has(thread.projectId))
    .toSorted((left, right) => {
      const rightTimestamp = toSortableTimestamp(right.lastVisitedAt ?? right.createdAt);
      const leftTimestamp = toSortableTimestamp(left.lastVisitedAt ?? left.createdAt);
      if (rightTimestamp !== leftTimestamp) {
        return rightTimestamp > leftTimestamp ? 1 : -1;
      }
      return right.id.localeCompare(left.id);
    })[0];

  if (mostRecentThread) {
    return mostRecentThread.projectId;
  }

  return projects[0]?.id ?? null;
}

function sortProjectWorkspaces(workspaces: ReadonlyArray<Workspace>, projectId: ProjectId | null) {
  return workspaces
    .filter((workspace) => workspace.projectId === projectId)
    .toSorted((left, right) => {
      const rightTimestamp = toSortableTimestamp(right.updatedAt ?? right.createdAt);
      const leftTimestamp = toSortableTimestamp(left.updatedAt ?? left.createdAt);
      if (rightTimestamp !== leftTimestamp) {
        return rightTimestamp > leftTimestamp ? 1 : -1;
      }
      return left.name.localeCompare(right.name);
    });
}

function orderCommandPaletteThreads(
  threads: ReadonlyArray<Thread>,
  threadMruIds: ReadonlyArray<ThreadId>,
) {
  const activeThreads = threads.filter((thread) => thread.archivedAt === null);
  const activeThreadsById = new Map(activeThreads.map((thread) => [thread.id, thread] as const));
  const orderedThreads: Thread[] = [];
  const seenThreadIds = new Set<ThreadId>();

  for (const threadId of threadMruIds) {
    const thread = activeThreadsById.get(threadId);
    if (!thread || seenThreadIds.has(thread.id)) {
      continue;
    }
    orderedThreads.push(thread);
    seenThreadIds.add(thread.id);
  }

  activeThreads
    .toSorted((left, right) => {
      const rightTimestamp = toSortableTimestamp(right.lastVisitedAt ?? right.createdAt);
      const leftTimestamp = toSortableTimestamp(left.lastVisitedAt ?? left.createdAt);
      if (rightTimestamp !== leftTimestamp) {
        return rightTimestamp > leftTimestamp ? 1 : -1;
      }
      return right.id.localeCompare(left.id);
    })
    .forEach((thread) => {
      if (seenThreadIds.has(thread.id)) {
        return;
      }
      orderedThreads.push(thread);
    });

  return orderedThreads;
}

function encodeWorkspaceTargetValue(workspaceId: WorkspaceId): string {
  return `workspace:${workspaceId}`;
}

function decodeWorkspaceTargetValue(value: string): WorkspaceId | null {
  if (!value.startsWith("workspace:")) {
    return null;
  }

  const workspaceId = value.slice("workspace:".length);
  return workspaceId.length > 0 ? (workspaceId as WorkspaceId) : null;
}

function resolveInitialTargetValue(requestedEnvMode?: SidebarNewThreadEnvMode): string {
  if (requestedEnvMode === "worktree") {
    return NEW_WORKSPACE_TARGET_VALUE;
  }

  return LOCAL_TARGET_VALUE;
}

function resolveWorkspaceLabel(workspace: Workspace): string {
  return workspace.name.trim().length > 0 ? workspace.name : deriveDefaultWorkspaceTitle(workspace);
}

function matchesModShiftShortcut(event: globalThis.KeyboardEvent, key: string): boolean {
  if (event.defaultPrevented || event.isComposing || event.altKey || !event.shiftKey) {
    return false;
  }

  const useMetaForMod = isMacPlatform(navigator.platform);
  if (useMetaForMod ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) {
    return false;
  }

  return event.key.toLowerCase() === key;
}

function nextRuntimeMode(mode: RuntimeMode): RuntimeMode {
  switch (mode) {
    case "read-only":
      return "approval-required";
    case "approval-required":
      return "full-access";
    case "full-access":
    default:
      return "read-only";
  }
}

function detectPathComposerTrigger(
  text: string,
  cursor: number,
  cursorAdjacentToMention = false,
): PathComposerTrigger | null {
  if (cursorAdjacentToMention) {
    return null;
  }
  const trigger = detectComposerTrigger(text, cursor);
  if (trigger?.kind !== "path") {
    return null;
  }
  return {
    kind: "path",
    query: trigger.query,
    rangeStart: trigger.rangeStart,
    rangeEnd: trigger.rangeEnd,
  };
}

export function NewThreadScreen({
  requestedEnvMode,
  requestedProjectId,
}: {
  requestedEnvMode?: SidebarNewThreadEnvMode;
  requestedProjectId?: string;
}) {
  const navigate = useNavigate();
  const { handleNewThread, projects } = useHandleNewThread();
  const { isOpen: isWorkspaceCommandPaletteOpen, setIsOpen: setIsWorkspaceCommandPaletteOpen } =
    useWorkspaceCommandPalette();
  const { isOpen: isWorkspaceFilePaletteOpen, setIsOpen: setIsWorkspaceFilePaletteOpen } =
    useWorkspaceFilePalette();
  const threads = useStore((store) => store.threads);
  const threadMruIds = useStore(selectThreadMruIds);
  const workspaces = useStore((store) => store.workspaces);
  const queryClient = useQueryClient();
  const settings = useSettings();
  const createWorktreeMutation = useMutation(gitCreateWorktreeMutationOptions({ queryClient }));
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<ComposerImageAttachment[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | null>(() =>
    resolveInitialProjectId(projects, threads, threadMruIds, requestedProjectId),
  );
  const userProjects = useMemo(
    () =>
      projects
        .filter(isUserProject)
        .toSorted((left, right) => left.name.localeCompare(right.name))
        .map((project) => ({ id: project.id, name: project.name })),
    [projects],
  );
  const projectWorkspaces = useMemo(
    () => sortProjectWorkspaces(workspaces, selectedProjectId),
    [selectedProjectId, workspaces],
  );
  const [selectedTargetValue, setSelectedTargetValue] = useState(() =>
    resolveInitialTargetValue(requestedEnvMode),
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

  // --- Model / Provider / Mode state ---
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const providerStatuses = serverConfigQuery.data?.providers ?? EMPTY_PROVIDERS;
  const stickyActiveProvider = useComposerDraftStore((s) => s.stickyActiveProvider);
  const stickyModelSelectionByProvider = useComposerDraftStore(
    (s) => s.stickyModelSelectionByProvider,
  );
  const setStickyModelSelection = useComposerDraftStore((s) => s.setStickyModelSelection);

  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(DEFAULT_RUNTIME_MODE);
  const [interactionMode, setInteractionMode] =
    useState<ProviderInteractionMode>(DEFAULT_INTERACTION_MODE);

  const selectedProvider = resolveSelectableProvider(
    providerStatuses,
    stickyActiveProvider ?? "codex",
  );
  const selectedModel = useMemo(() => {
    const stickySelection = stickyModelSelectionByProvider[selectedProvider];
    if (stickySelection?.model) {
      return resolveAppModelSelection(
        selectedProvider,
        settings,
        providerStatuses,
        stickySelection.model,
      );
    }
    return getDefaultServerModel(providerStatuses, selectedProvider);
  }, [providerStatuses, selectedProvider, settings, stickyModelSelectionByProvider]);

  const selectedProviderModels = getProviderModels(providerStatuses, selectedProvider);
  const modelOptionsByProvider = useMemo(
    () => ({
      codex: providerStatuses.find((p) => p.provider === "codex")?.models ?? [],
      claudeAgent: providerStatuses.find((p) => p.provider === "claudeAgent")?.models ?? [],
    }),
    [providerStatuses],
  );

  // Model options for traits picker (reasoning, etc.).
  // Uses the `onModelOptionsChange` path (no threadId yet).
  // Changes are synced to sticky state so `applyStickyState` picks them up.
  const [localModelOptions, setLocalModelOptions] = useState<
    ProviderModelOptions[ProviderKind] | undefined
  >(undefined);

  const onModelOptionsChange = useCallback(
    (nextOptions: ProviderModelOptions[ProviderKind] | undefined) => {
      setLocalModelOptions(nextOptions);
      // Persist to sticky state so the new thread inherits these options.
      // `setStickyModelSelection` runs through `normalizeModelSelection` which
      // wraps the options correctly for the provider.
      const currentSticky = useComposerDraftStore.getState().stickyModelSelectionByProvider;
      const currentForProvider = currentSticky[selectedProvider];
      setStickyModelSelection({
        provider: selectedProvider,
        model: currentForProvider?.model ?? selectedModel,
        ...(nextOptions ? { options: nextOptions } : {}),
      } as import("@t3tools/contracts").ModelSelection);
    },
    [selectedModel, selectedProvider, setStickyModelSelection],
  );

  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Derived convenience values ---
  useEffect(() => {
    setSelectedProjectId((current) => {
      if (current && projects.some((project) => project.id === current)) {
        return current;
      }

      return resolveInitialProjectId(projects, threads, threadMruIds, requestedProjectId);
    });
  }, [projects, requestedProjectId, threadMruIds, threads]);

  useEffect(() => {
    setSelectedTargetValue((current) => {
      if (current === LOCAL_TARGET_VALUE || current === NEW_WORKSPACE_TARGET_VALUE) {
        return current;
      }

      const selectedWorkspaceId = decodeWorkspaceTargetValue(current);
      if (
        selectedWorkspaceId &&
        projectWorkspaces.some((workspace) => workspace.id === selectedWorkspaceId)
      ) {
        return current;
      }

      return resolveInitialTargetValue(requestedEnvMode);
    });
  }, [projectWorkspaces, requestedEnvMode]);

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (matchesModShiftShortcut(event, "l")) {
        event.preventDefault();
        event.stopPropagation();
        setSelectedTargetValue(LOCAL_TARGET_VALUE);
        return;
      }

      if (matchesModShiftShortcut(event, "n")) {
        event.preventDefault();
        event.stopPropagation();
        setSelectedTargetValue(NEW_WORKSPACE_TARGET_VALUE);
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, []);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const workspaceCommandPaletteItems = useMemo(
    () =>
      buildWorkspaceCommandPaletteNavigationItems({
        projects: userProjects,
        threads: orderCommandPaletteThreads(threads, threadMruIds),
        selectedProjectId,
        onOpenNewThread: () => {
          void navigate({
            to: "/",
            ...(selectedProjectId ? { search: { projectId: selectedProjectId } } : {}),
          });
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
          setSelectedProjectId(projectId);
        },
        onSelectThread: (threadId) => {
          void navigate({
            to: "/$threadId",
            params: { threadId },
          });
        },
      }),
    [navigate, openCreateWorkItemDialog, selectedProjectId, threadMruIds, threads, userProjects],
  );
  const selectedProjectBranchesQuery = useQuery(
    gitBranchesQueryOptions(selectedProject?.cwd ?? null),
  );
  const selectedProjectIsHome = isHomeProject(selectedProject);
  const selectedWorkspaceId = decodeWorkspaceTargetValue(selectedTargetValue);
  const selectedWorkspace = useMemo(
    () => projectWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [projectWorkspaces, selectedWorkspaceId],
  );
  const selectedProjectSearchCwd = selectedWorkspace?.worktreePath ?? selectedProject?.cwd ?? null;
  const { resolvedTheme } = useTheme();
  const promptRef = useRef(prompt);
  const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
  const composerSelectLockRef = useRef(false);
  const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
  const [composerCursor, setComposerCursor] = useState(() =>
    collapseExpandedComposerCursor(prompt, prompt.length),
  );
  const [composerTrigger, setComposerTrigger] = useState<PathComposerTrigger | null>(() =>
    detectPathComposerTrigger(prompt, prompt.length),
  );
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
  const localShortcutLabel = useMemo(
    () =>
      formatShortcutLabel({
        key: "l",
        modKey: true,
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
    [],
  );
  const newWorkspaceShortcutLabel = useMemo(
    () =>
      formatShortcutLabel({
        key: "n",
        modKey: true,
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
    [],
  );
  const isNewWorkspaceTarget = selectedTargetValue === NEW_WORKSPACE_TARGET_VALUE;
  const selectedProjectBaseBranch = useMemo(
    () => resolveNewWorkspaceBaseBranch(selectedProjectBranchesQuery.data?.branches ?? []),
    [selectedProjectBranchesQuery.data?.branches],
  );
  const effectiveEnvMode =
    selectedProjectIsHome || (!selectedWorkspace && !isNewWorkspaceTarget) ? "local" : "worktree";
  const effectiveRuntimeMode = selectedProjectIsHome ? ("read-only" as RuntimeMode) : runtimeMode;
  const _targetDescription = selectedProjectIsHome
    ? "General chat without repo tools"
    : selectedWorkspace
      ? (selectedWorkspace.branch ?? selectedWorkspace.worktreePath)
      : isNewWorkspaceTarget
        ? "Create a fresh worktree now"
        : "Use the main repo checkout";
  const pathTriggerQuery = composerTrigger?.query ?? "";
  const [debouncedPathQuery, composerPathQueryDebouncer] = useDebouncedValue(
    pathTriggerQuery,
    { wait: NEW_THREAD_PATH_QUERY_DEBOUNCE_MS },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const effectivePathQuery = pathTriggerQuery.length > 0 ? debouncedPathQuery : "";
  const workspaceEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: selectedProjectSearchCwd,
      query: effectivePathQuery,
      enabled: composerTrigger !== null,
      limit: 80,
    }),
  );
  const workspaceEntries = workspaceEntriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES;
  const composerMenuItems = useMemo<ComposerCommandItem[]>(
    () =>
      workspaceEntries.map((entry) => ({
        id: `path:${entry.kind}:${entry.path}`,
        type: "path" as const,
        path: entry.path,
        pathKind: entry.kind,
        label: basenameOfPath(entry.path),
        description: entry.parentPath ?? "",
      })),
    [workspaceEntries],
  );
  const activeComposerMenuItem = useMemo(
    () =>
      composerMenuItems.find((item) => item.id === composerHighlightedItemId) ??
      composerMenuItems[0] ??
      null,
    [composerHighlightedItemId, composerMenuItems],
  );
  const isComposerMenuLoading =
    (pathTriggerQuery.length > 0 && composerPathQueryDebouncer.state.isPending) ||
    workspaceEntriesQuery.isLoading ||
    workspaceEntriesQuery.isFetching;
  const composerMenuOpen = composerTrigger !== null;
  composerMenuItemsRef.current = composerMenuItems;

  useEffect(() => {
    if (!selectedProjectIsHome) {
      return;
    }
    setSelectedTargetValue(LOCAL_TARGET_VALUE);
  }, [selectedProjectIsHome]);

  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  useEffect(() => {
    if (projects.length === 0) {
      return;
    }
    composerEditorRef.current?.focusAtEnd();
  }, [projects.length]);

  // --- Image handling ---
  const addImages = useCallback((files: File[]) => {
    setImages((prev) => {
      const { images: nextImages, error } = processImageFiles(files, prev.length);
      if (error) {
        toastManager.add({ type: "error", title: error });
      }
      return [...prev, ...nextImages];
    });
  }, []);

  const removeImage = useCallback((imageId: string) => {
    setImages((prev) => {
      const image = prev.find((img) => img.id === imageId);
      if (image?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(image.previewUrl);
      }
      return prev.filter((img) => img.id !== imageId);
    });
  }, []);

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLElement>) => {
      const files = Array.from(event.clipboardData.files);
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length > 0) {
        event.preventDefault();
        addImages(imageFiles);
      }
    },
    [addImages],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const files = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
      if (files.length > 0) {
        addImages(files);
      }
    },
    [addImages],
  );

  const onFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length > 0) {
        addImages(files);
      }
      // Reset so the same file can be selected again
      event.target.value = "";
    },
    [addImages],
  );

  // --- Provider model change handler ---
  const onProviderModelChange = useCallback(
    (provider: ProviderKind, model: string) => {
      const resolved = resolveSelectableProvider(providerStatuses, provider);
      const resolvedModel = resolveAppModelSelection(resolved, settings, providerStatuses, model);
      setStickyModelSelection({
        provider: resolved,
        model: resolvedModel,
      });
    },
    [providerStatuses, setStickyModelSelection, settings],
  );
  const onRemoveTerminalContext = useCallback(() => {}, []);

  const setPromptFromTraits = useCallback((nextPrompt: string) => {
    promptRef.current = nextPrompt;
    setPrompt(nextPrompt);
    const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
    setComposerCursor(nextCursor);
    setComposerTrigger(detectPathComposerTrigger(nextPrompt, nextPrompt.length));
    window.requestAnimationFrame(() => {
      composerEditorRef.current?.focusAtEnd();
    });
  }, []);

  // Whether the traits picker should render (only when there are options to show).
  const hasTraitsOptions = selectedProviderModels.length > 0;

  const onPromptChange = useCallback(
    (
      nextPrompt: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
    ) => {
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      setComposerCursor(nextCursor);
      setComposerTrigger(
        detectPathComposerTrigger(nextPrompt, expandedCursor, cursorAdjacentToMention),
      );
    },
    [],
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
      const next = replaceTextRange(currentText, safeStart, safeEnd, replacement);
      const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
      promptRef.current = next.text;
      setPrompt(next.text);
      setComposerCursor(nextCursor);
      setComposerTrigger(
        detectPathComposerTrigger(next.text, expandCollapsedComposerCursor(next.text, nextCursor)),
      );
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCursor);
      });
      return true;
    },
    [],
  );

  const onSelectComposerItem = useCallback(
    (item: ComposerCommandItem) => {
      if (composerSelectLockRef.current) {
        return;
      }
      composerSelectLockRef.current = true;
      window.requestAnimationFrame(() => {
        composerSelectLockRef.current = false;
      });
      const snapshot = composerEditorRef.current?.readSnapshot() ?? {
        value: promptRef.current,
        cursor: composerCursor,
        expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
        terminalContextIds: [],
      };
      const trigger = detectPathComposerTrigger(snapshot.value, snapshot.expandedCursor);
      if (!trigger || item.type !== "path") {
        return;
      }
      const replacement = `@${item.path} `;
      const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
        snapshot.value,
        trigger.rangeEnd,
        replacement,
      );
      const applied = applyPromptReplacement(trigger.rangeStart, replacementRangeEnd, replacement, {
        expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd),
      });
      if (applied) {
        setComposerHighlightedItemId(null);
      }
    },
    [applyPromptReplacement, composerCursor],
  );

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
      setComposerHighlightedItemId(composerMenuItems[nextIndex]?.id ?? null);
    },
    [composerHighlightedItemId, composerMenuItems],
  );

  const onComposerCommandKey = useCallback(
    (key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab", event: KeyboardEvent) => {
      const menuItems = composerMenuItemsRef.current;
      const menuIsActive = composerTrigger !== null;

      if (menuIsActive) {
        if ((key === "ArrowDown" || key === "ArrowUp") && menuItems.length > 0) {
          nudgeComposerMenuHighlight(key);
          return true;
        }
        if ((key === "Enter" || key === "Tab") && activeComposerMenuItem) {
          onSelectComposerItem(activeComposerMenuItem);
          return true;
        }
      }

      if (key !== "Enter" || event.shiftKey || event.isComposing) {
        return false;
      }

      formRef.current?.requestSubmit();
      return true;
    },
    [activeComposerMenuItem, composerTrigger, nudgeComposerMenuHighlight, onSelectComposerItem],
  );

  const onComposerEscapeKey = useCallback(() => {
    if (composerTrigger === null) {
      return false;
    }
    setComposerTrigger(null);
    setComposerHighlightedItemId(null);
    return true;
  }, [composerTrigger]);

  // --- Submit ---
  const hasContent = prompt.trim().length > 0 || images.length > 0;

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedProjectId) {
        return;
      }

      const commonOptions = {
        ...(prompt.trim().length > 0 ? { initialPrompt: prompt } : {}),
        ...(images.length > 0 ? { initialImages: images } : {}),
        ...(!selectedProjectIsHome ? { runtimeMode: effectiveRuntimeMode } : {}),
        ...(!selectedProjectIsHome ? { interactionMode } : {}),
      };

      if (selectedProjectIsHome) {
        void handleNewThread(selectedProjectId, {
          workspaceId: null,
          branch: null,
          worktreePath: null,
          envMode: "local",
          ...commonOptions,
        });
        return;
      }

      if (selectedWorkspace) {
        void handleNewThread(selectedProjectId, {
          workspaceId: selectedWorkspace.id,
          branch: selectedWorkspace.branch,
          worktreePath: selectedWorkspace.worktreePath,
          envMode: "worktree",
          ...commonOptions,
        });
        return;
      }

      if (isNewWorkspaceTarget) {
        void (async () => {
          if (!selectedProject) {
            return;
          }
          const api = readNativeApi();
          if (!api) {
            throw new Error("Native API not found");
          }
          if (!selectedProjectBaseBranch) {
            toastManager.add({
              type: "error",
              title: "Could not create workspace",
              description: "No local base branch is available for this project.",
            });
            return;
          }
          let createdWorktreePath: string | null = null;
          try {
            const worktree = await createWorktreeMutation.mutateAsync({
              cwd: selectedProject.cwd,
              branch: selectedProjectBaseBranch,
              newBranch: buildTemporaryWorktreeBranchName(),
            });
            createdWorktreePath = worktree.worktree.path;
            const workspaceId = crypto.randomUUID() as WorkspaceId;
            const createdAt = new Date().toISOString();

            await api.orchestration.dispatchCommand({
              type: "workspace.create",
              commandId: newCommandId(),
              workspaceId,
              projectId: selectedProjectId,
              title: worktree.worktree.branch,
              branch: worktree.worktree.branch,
              worktreePath: worktree.worktree.path,
              createdAt,
            });

            await handleNewThread(selectedProjectId, {
              workspaceId,
              branch: worktree.worktree.branch,
              worktreePath: worktree.worktree.path,
              envMode: "worktree",
              ...commonOptions,
            });
          } catch (error) {
            if (createdWorktreePath) {
              await api.git
                .removeWorktree({
                  cwd: selectedProject.cwd,
                  path: createdWorktreePath,
                  force: true,
                })
                .catch(() => undefined);
            }
            throw error;
          }
        })().catch((error) => {
          const description =
            error instanceof Error ? error.message : "Unknown error creating workspace.";
          toastManager.add({
            type: "error",
            title: "Could not create workspace",
            description,
          });
        });
        return;
      }

      void handleNewThread(selectedProjectId, {
        workspaceId: null,
        branch: null,
        worktreePath: null,
        envMode: isNewWorkspaceTarget ? "worktree" : "local",
        ...commonOptions,
      });
    },
    [
      createWorktreeMutation,
      effectiveRuntimeMode,
      handleNewThread,
      images,
      interactionMode,
      isNewWorkspaceTarget,
      prompt,
      selectedProject,
      selectedProjectIsHome,
      selectedProjectBaseBranch,
      selectedProjectId,
      selectedWorkspace,
    ],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {!isElectron && (
        <header className="border-b border-border px-3 py-2 md:hidden">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="size-7 shrink-0" />
            <span className="text-sm font-medium text-foreground">New thread</span>
          </div>
        </header>
      )}

      {isElectron && (
        <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
          <span className="text-xs font-medium tracking-wide text-foreground/80">New thread</span>
        </div>
      )}

      <form ref={formRef} className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
        <WorkspaceCommandPalette
          open={isWorkspaceCommandPaletteOpen}
          onOpenChange={setIsWorkspaceCommandPaletteOpen}
          items={workspaceCommandPaletteItems}
          placeholder="Type command or search"
          emptyText="No matching project, thread, or action."
        />
        <WorkspaceFilePalette
          open={isWorkspaceFilePaletteOpen}
          onOpenChange={setIsWorkspaceFilePaletteOpen}
          cwd={selectedProjectSearchCwd}
          projectName={selectedProject?.name ?? null}
          resolvedTheme={resolvedTheme}
          onSelectFile={null}
          unavailableText="Open a session workspace to browse project files in Flow."
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
        <div className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10 pt-16 sm:px-8 sm:pt-18">
            <div className="max-w-xl text-center">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {selectedProjectIsHome ? "Ask anything" : "Let\u2019s build"}
              </h1>
              {selectedProjectIsHome ? (
                <p className="mt-1.5 text-sm text-muted-foreground/70">
                  General chat without repository tools
                </p>
              ) : null}

              <div className="mt-3 flex flex-col items-center gap-1.5">
                <Select
                  value={selectedProject?.id ?? ""}
                  onValueChange={(value) => {
                    setSelectedProjectId(
                      typeof value === "string" && value.length > 0 ? (value as ProjectId) : null,
                    );
                  }}
                  items={projects.map((project) => ({
                    value: project.id,
                    label: project.name,
                  }))}
                >
                  <SelectTrigger
                    aria-label="Choose a project for the new thread"
                    variant="ghost"
                    size="sm"
                    disabled={projects.length === 0}
                    data-testid="new-thread-project-select"
                    className={cn(
                      "h-auto min-w-0 cursor-pointer justify-center gap-1.5 rounded-lg border-transparent px-3 py-1.5 text-base font-medium shadow-none disabled:opacity-100 sm:text-lg",
                      selectedProject
                        ? "bg-accent/60 text-foreground hover:bg-accent/80 data-[popup-open]:bg-accent/80"
                        : "bg-transparent text-muted-foreground hover:bg-muted/35 hover:text-foreground data-[popup-open]:bg-muted/35 data-[popup-open]:text-foreground",
                    )}
                  >
                    {selectedProject ? (
                      selectedProjectIsHome ? (
                        <MessageSquareTextIcon className="size-4.5 text-muted-foreground/70" />
                      ) : (
                        <ProjectFavicon cwd={selectedProject.cwd} className="size-4.5" />
                      )
                    ) : (
                      <FolderIcon className="size-4.5 text-muted-foreground/70" />
                    )}
                    <span className={selectedProject ? "text-foreground" : "text-muted-foreground"}>
                      {selectedProject?.name ??
                        (projects.length > 0 ? "Choose a project" : "No projects")}
                    </span>
                  </SelectTrigger>
                  <SelectPopup align="center" className="min-w-80">
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        <div className="flex min-w-0 items-center gap-2">
                          {isHomeProject(project) ? (
                            <MessageSquareTextIcon className="size-4 text-muted-foreground/70" />
                          ) : (
                            <ProjectFavicon cwd={project.cwd} />
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">
                              {project.name}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {isHomeProject(project) ? "General chat" : project.cwd}
                            </div>
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>

                {!selectedProjectIsHome && selectedProject ? (
                  <div className="flex items-center gap-2" data-testid="new-thread-target-select">
                    <SegmentGroup
                      value={selectedTargetValue}
                      onValueChange={setSelectedTargetValue}
                    >
                      <SegmentItem
                        value={LOCAL_TARGET_VALUE}
                        title={`Local \u2014 Use the main repo checkout (${localShortcutLabel})`}
                      >
                        Local
                        <span className="text-[10px] font-medium tracking-[0.06em] opacity-40">
                          {localShortcutLabel}
                        </span>
                      </SegmentItem>
                      <SegmentItem
                        value={NEW_WORKSPACE_TARGET_VALUE}
                        title={`New workspace \u2014 Create a fresh worktree now (${newWorkspaceShortcutLabel})`}
                      >
                        New workspace
                        <span className="text-[10px] font-medium tracking-[0.06em] opacity-40">
                          {newWorkspaceShortcutLabel}
                        </span>
                      </SegmentItem>
                    </SegmentGroup>
                    {projectWorkspaces.length > 0 ? (
                      <Select
                        value={
                          selectedWorkspaceId ? encodeWorkspaceTargetValue(selectedWorkspaceId) : ""
                        }
                        onValueChange={(value) => {
                          if (typeof value === "string" && value.length > 0) {
                            setSelectedTargetValue(value);
                          }
                        }}
                        items={projectWorkspaces.map((workspace) => ({
                          value: encodeWorkspaceTargetValue(workspace.id),
                          label: resolveWorkspaceLabel(workspace),
                        }))}
                      >
                        <SelectTrigger
                          aria-label="Choose an existing workspace"
                          variant="ghost"
                          size="xs"
                          className={cn(
                            "h-auto min-w-0 cursor-pointer gap-1 rounded-lg border-transparent px-3 py-2 text-xs font-medium shadow-none sm:h-auto",
                            selectedWorkspaceId
                              ? "bg-accent/80 text-accent-foreground shadow-sm ring-1 ring-border/50"
                              : "bg-muted/50 text-muted-foreground/50 ring-1 ring-border/40 hover:bg-accent/30 hover:text-foreground/70",
                          )}
                        >
                          {selectedWorkspace
                            ? resolveWorkspaceLabel(selectedWorkspace)
                            : "Workspaces"}
                        </SelectTrigger>
                        <SelectPopup align="center" className="min-w-72">
                          {projectWorkspaces.map((workspace) => (
                            <SelectItem
                              key={workspace.id}
                              value={encodeWorkspaceTargetValue(workspace.id)}
                            >
                              <div className="min-w-0">
                                <div className="truncate font-medium text-foreground">
                                  {resolveWorkspaceLabel(workspace)}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {workspace.branch ?? workspace.worktreePath}
                                </div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-3xl px-4 pb-5 sm:px-5 sm:pb-7">
            <div
              className="rounded-[22px] border border-border bg-card/90 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset] backdrop-blur-sm"
              onDragOver={onDragOver}
              onDrop={onDrop}
            >
              <div className="relative px-4 pb-2 pt-4 sm:px-5 sm:pt-4.5">
                {composerMenuOpen && (
                  <div className="absolute inset-x-0 bottom-full z-20 mb-2 px-1">
                    <ComposerCommandMenu
                      items={composerMenuItems}
                      resolvedTheme={resolvedTheme}
                      isLoading={isComposerMenuLoading}
                      triggerKind="path"
                      activeItemId={activeComposerMenuItem?.id ?? null}
                      onHighlightedItemChange={setComposerHighlightedItemId}
                      onSelect={onSelectComposerItem}
                    />
                  </div>
                )}

                {/* Image previews */}
                {images.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {images.map((image) => (
                      <div
                        key={image.id}
                        className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-background"
                      >
                        {image.previewUrl ? (
                          <img
                            src={image.previewUrl}
                            alt={image.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground/60">
                            <ImageIcon className="size-5" />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeImage(image.id)}
                          className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-foreground/80 text-background hover:bg-foreground"
                          aria-label={`Remove ${image.name}`}
                        >
                          <XIcon className="size-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <ComposerPromptEditor
                  ref={composerEditorRef}
                  dataTestId="new-thread-prompt-input"
                  value={prompt}
                  cursor={composerCursor}
                  terminalContexts={[]}
                  onRemoveTerminalContext={onRemoveTerminalContext}
                  onChange={onPromptChange}
                  onCommandKeyDown={onComposerCommandKey}
                  onEscapeKeyDown={onComposerEscapeKey}
                  onPaste={onPaste}
                  placeholder={
                    selectedProjectIsHome
                      ? "Ask anything\u2026"
                      : "Ask Codex anything, @ to add files, / for commands"
                  }
                  disabled={!selectedProject}
                  className="min-h-14 max-h-56 text-[15px] leading-6 disabled:cursor-not-allowed"
                />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border/60 px-3 pb-3 pt-2.5 sm:px-4">
                <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <ProviderModelPicker
                    provider={selectedProvider}
                    model={selectedModel}
                    lockedProvider={null}
                    providers={providerStatuses}
                    modelOptionsByProvider={modelOptionsByProvider}
                    onProviderModelChange={onProviderModelChange}
                  />

                  {hasTraitsOptions ? (
                    <>
                      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
                      <TraitsPicker
                        provider={selectedProvider}
                        models={selectedProviderModels}
                        model={selectedModel}
                        modelOptions={localModelOptions}
                        prompt={prompt}
                        onPromptChange={setPromptFromTraits}
                        onModelOptionsChange={onModelOptionsChange}
                      />
                    </>
                  ) : null}

                  {!selectedProjectIsHome && (
                    <>
                      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />

                      <Button
                        variant="ghost"
                        className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
                        size="sm"
                        type="button"
                        onClick={() =>
                          setInteractionMode((m) => (m === "plan" ? "default" : "plan"))
                        }
                        title={
                          interactionMode === "plan"
                            ? "Plan mode \u2014 click to return to normal chat mode"
                            : "Default mode \u2014 click to enter plan mode"
                        }
                      >
                        <BotIcon />
                        <span className="sr-only sm:not-sr-only">
                          {interactionMode === "plan" ? "Plan" : "Chat"}
                        </span>
                      </Button>

                      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />

                      <Button
                        variant="ghost"
                        className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
                        size="sm"
                        type="button"
                        onClick={() => setRuntimeMode((m) => nextRuntimeMode(m))}
                        title={
                          runtimeMode === "full-access"
                            ? "Full access \u2014 click for read-only mode"
                            : runtimeMode === "approval-required"
                              ? "Supervised \u2014 click for full access"
                              : "Read-only \u2014 click for supervised mode"
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
                    </>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {/* Hidden file input for image upload */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={onFileInputChange}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground/70 hover:text-foreground/80"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach images"
                    title="Attach images"
                  >
                    <ImageIcon className="size-4" />
                  </Button>

                  <Button
                    type="submit"
                    size="icon-sm"
                    className={cn("rounded-full", !hasContent && "bg-primary/85")}
                    disabled={!selectedProject || createWorktreeMutation.isPending}
                    data-testid="create-thread-submit-button"
                    aria-label={
                      selectedProjectIsHome
                        ? "Create Home thread"
                        : `Create ${effectiveEnvMode === "worktree" ? "workspace" : "local"} thread`
                    }
                  >
                    <ArrowUpIcon className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
