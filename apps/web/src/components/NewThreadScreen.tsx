import type {
  GitBranch,
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
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "~/lib/utils";

import { isElectron } from "../env";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { formatShortcutLabel } from "../keybindings";
import { gitBranchesQueryOptions, gitCreateWorktreeMutationOptions } from "../lib/gitReactQuery";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { selectThreadMruIds, useStore } from "../store";
import {
  type Thread,
  type Workspace,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_INTERACTION_MODE,
} from "../types";
import { isHomeProject } from "../systemProject";
import { type ComposerImageAttachment, useComposerDraftStore } from "../composerDraftStore";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import {
  getDefaultServerModel,
  getProviderModels,
  resolveSelectableProvider,
} from "../providerModels";
import { resolveAppModelSelection } from "../modelSelection";
import { useSettings } from "../hooks/useSettings";
import { ProjectFavicon } from "./ProjectFavicon";
import { buildTemporaryWorktreeBranchName, processImageFiles } from "./ChatView.logic";
import { deriveDefaultWorkspaceTitle, type SidebarNewThreadEnvMode } from "./Sidebar.logic";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";
import { TraitsPicker } from "./chat/TraitsPicker";
import { toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "./ui/select";
import { Separator } from "./ui/separator";
import { SidebarTrigger } from "./ui/sidebar";
import { isMacPlatform } from "../lib/utils";

const LOCAL_TARGET_VALUE = "local";
const NEW_WORKSPACE_TARGET_VALUE = "new-workspace";

const EMPTY_PROVIDERS: ServerProvider[] = [];

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

function resolveNewWorkspaceBaseBranch(
  branches: ReadonlyArray<Pick<GitBranch, "name" | "current" | "isDefault" | "isRemote">>,
): string | null {
  const localBranches = branches.filter((branch) => !branch.isRemote);
  return (
    localBranches.find((branch) => branch.current)?.name ??
    localBranches.find((branch) => branch.isDefault)?.name ??
    localBranches[0]?.name ??
    null
  );
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

export function NewThreadScreen({
  requestedEnvMode,
  requestedProjectId,
}: {
  requestedEnvMode?: SidebarNewThreadEnvMode;
  requestedProjectId?: string;
}) {
  const { handleNewThread, projects } = useHandleNewThread();
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
  const projectWorkspaces = useMemo(
    () => sortProjectWorkspaces(workspaces, selectedProjectId),
    [selectedProjectId, workspaces],
  );
  const [selectedTargetValue, setSelectedTargetValue] = useState(() =>
    resolveInitialTargetValue(requestedEnvMode),
  );

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
  const selectedProjectBranchesQuery = useQuery(
    gitBranchesQueryOptions(selectedProject?.cwd ?? null),
  );
  const selectedProjectIsHome = isHomeProject(selectedProject);
  const selectedWorkspaceId = decodeWorkspaceTargetValue(selectedTargetValue);
  const selectedWorkspace = useMemo(
    () => projectWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [projectWorkspaces, selectedWorkspaceId],
  );
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
  const targetLabel = selectedProjectIsHome
    ? "Home"
    : selectedWorkspace
      ? resolveWorkspaceLabel(selectedWorkspace)
      : isNewWorkspaceTarget
        ? "New workspace"
        : "Local";
  const _targetDescription = selectedProjectIsHome
    ? "General chat without repo tools"
    : selectedWorkspace
      ? (selectedWorkspace.branch ?? selectedWorkspace.worktreePath)
      : isNewWorkspaceTarget
        ? "Create a fresh worktree now"
        : "Use the main repo checkout";
  const targetShortcutLabel = selectedProjectIsHome
    ? null
    : selectedWorkspace
      ? null
      : isNewWorkspaceTarget
        ? newWorkspaceShortcutLabel
        : localShortcutLabel;

  useEffect(() => {
    if (!selectedProjectIsHome) {
      return;
    }
    setSelectedTargetValue(LOCAL_TARGET_VALUE);
  }, [selectedProjectIsHome]);

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
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
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

  // Whether the traits picker should render (only when there are options to show).
  const hasTraitsOptions = selectedProviderModels.length > 0;

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

  const handlePromptKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }, []);

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

      <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
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
                    className="h-auto min-w-0 justify-center gap-1.5 rounded-md border-transparent bg-transparent px-2 py-1 text-base font-medium text-muted-foreground shadow-none hover:bg-muted/35 hover:text-foreground data-[popup-open]:bg-muted/35 data-[popup-open]:text-foreground focus-visible:ring-0 disabled:opacity-100 sm:text-lg"
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
                    <span
                      className={selectedProject ? "text-foreground/88" : "text-muted-foreground"}
                    >
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

                {selectedProjectIsHome ? null : projectWorkspaces.length > 0 ? (
                  <Select
                    value={selectedTargetValue}
                    onValueChange={(value) => {
                      if (typeof value === "string" && value.length > 0) {
                        setSelectedTargetValue(value);
                      }
                    }}
                    items={[
                      { value: LOCAL_TARGET_VALUE, label: "Local" },
                      { value: NEW_WORKSPACE_TARGET_VALUE, label: "New workspace" },
                      ...projectWorkspaces.map((workspace) => ({
                        value: encodeWorkspaceTargetValue(workspace.id),
                        label: resolveWorkspaceLabel(workspace),
                      })),
                    ]}
                  >
                    <SelectTrigger
                      aria-label="Choose where to start the new thread"
                      variant="ghost"
                      size="xs"
                      disabled={!selectedProject}
                      data-testid="new-thread-target-select"
                      className="h-auto min-w-0 justify-center gap-1 rounded-md border-transparent bg-transparent px-2 py-1 text-xs font-medium text-muted-foreground shadow-none hover:bg-muted/30 hover:text-foreground data-[popup-open]:bg-muted/30 data-[popup-open]:text-foreground focus-visible:ring-0 disabled:opacity-100"
                    >
                      <span className="text-muted-foreground/70">Open in</span>
                      <span className="text-sm text-foreground/82">{targetLabel}</span>
                    </SelectTrigger>
                    <SelectPopup align="center" className="min-w-72">
                      <SelectItem value={LOCAL_TARGET_VALUE}>
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-foreground">Local</div>
                            <div className="truncate text-xs text-muted-foreground">
                              Use the main repo checkout
                            </div>
                          </div>
                          <span className="rounded bg-white/[0.04] px-1 py-0.5 font-medium text-[10px] tracking-[0.08em] text-muted-foreground/58">
                            {localShortcutLabel}
                          </span>
                        </div>
                      </SelectItem>
                      <SelectItem value={NEW_WORKSPACE_TARGET_VALUE}>
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-foreground">
                              New workspace
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              Create a fresh worktree now
                            </div>
                          </div>
                          <span className="rounded bg-white/[0.04] px-1 py-0.5 font-medium text-[10px] tracking-[0.08em] text-muted-foreground/58">
                            {newWorkspaceShortcutLabel}
                          </span>
                        </div>
                      </SelectItem>
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
                ) : selectedProject && !selectedProjectIsHome ? (
                  <div className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground/70">
                    <span>{targetLabel}</span>
                    {targetShortcutLabel ? (
                      <span className="rounded bg-white/[0.04] px-1 py-0.5 font-medium text-[10px] tracking-[0.08em] text-muted-foreground/58">
                        {targetShortcutLabel}
                      </span>
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
              <div className="px-4 pb-2 pt-4 sm:px-5 sm:pt-4.5">
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

                <textarea
                  autoFocus={projects.length > 0}
                  data-testid="new-thread-prompt-input"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={handlePromptKeyDown}
                  onPaste={onPaste}
                  placeholder={
                    selectedProjectIsHome
                      ? "Ask anything\u2026"
                      : "Ask Codex anything, @ to add files, / for commands"
                  }
                  disabled={!selectedProject}
                  rows={1}
                  className="field-sizing-content min-h-14 max-h-56 w-full resize-none bg-transparent text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/55 disabled:cursor-not-allowed"
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
                        onPromptChange={setPrompt}
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
