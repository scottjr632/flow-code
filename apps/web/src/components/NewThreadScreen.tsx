import type { ProjectId, ThreadId, WorkspaceId } from "@t3tools/contracts";
import { ArrowUpIcon, FolderIcon } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { cn } from "~/lib/utils";

import { isElectron } from "../env";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { formatShortcutLabel } from "../keybindings";
import { useStore } from "../store";
import { type Thread, type Workspace } from "../types";
import { ProjectFavicon } from "./ProjectFavicon";
import { deriveDefaultWorkspaceTitle, type SidebarNewThreadEnvMode } from "./Sidebar.logic";
import { Button } from "./ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "./ui/select";
import { SidebarTrigger } from "./ui/sidebar";
import { isMacPlatform } from "../lib/utils";

const LOCAL_TARGET_VALUE = "local";
const NEW_WORKSPACE_TARGET_VALUE = "new-workspace";

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

export function NewThreadScreen({
  requestedEnvMode,
  requestedProjectId,
}: {
  requestedEnvMode?: SidebarNewThreadEnvMode;
  requestedProjectId?: string;
}) {
  const { handleNewThread, projects } = useHandleNewThread();
  const threads = useStore((store) => store.threads);
  const threadMruIds = useStore((store) => store.threadMruIds ?? []);
  const workspaces = useStore((store) => store.workspaces);
  const [prompt, setPrompt] = useState("");
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
  const effectiveEnvMode = selectedWorkspace || isNewWorkspaceTarget ? "worktree" : "local";
  const targetLabel = selectedWorkspace
    ? resolveWorkspaceLabel(selectedWorkspace)
    : isNewWorkspaceTarget
      ? "New workspace"
      : "Local";
  const targetDescription = selectedWorkspace
    ? (selectedWorkspace.branch ?? selectedWorkspace.worktreePath)
    : isNewWorkspaceTarget
      ? "Create a fresh worktree on first send"
      : "Use the main repo checkout";
  const targetShortcutLabel = selectedWorkspace
    ? null
    : isNewWorkspaceTarget
      ? newWorkspaceShortcutLabel
      : localShortcutLabel;

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedProjectId) {
        return;
      }

      if (selectedWorkspace) {
        void handleNewThread(selectedProjectId, {
          workspaceId: selectedWorkspace.id,
          branch: selectedWorkspace.branch,
          worktreePath: selectedWorkspace.worktreePath,
          envMode: "worktree",
          ...(prompt.trim().length > 0 ? { initialPrompt: prompt } : {}),
        });
        return;
      }

      void handleNewThread(selectedProjectId, {
        workspaceId: null,
        branch: null,
        worktreePath: null,
        envMode: isNewWorkspaceTarget ? "worktree" : "local",
        ...(prompt.trim().length > 0 ? { initialPrompt: prompt } : {}),
      });
    },
    [handleNewThread, isNewWorkspaceTarget, prompt, selectedProjectId, selectedWorkspace],
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
                Let&apos;s build
              </h1>

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
                      <ProjectFavicon cwd={selectedProject.cwd} className="size-4.5" />
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
                          <ProjectFavicon cwd={project.cwd} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">
                              {project.name}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {project.cwd}
                            </div>
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>

                {projectWorkspaces.length > 0 ? (
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
                              Create a fresh worktree on first send
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
                ) : selectedProject ? (
                  <div className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground/70">
                    <span>{isNewWorkspaceTarget ? "New workspace" : "Local"}</span>
                    <span className="rounded bg-white/[0.04] px-1 py-0.5 font-medium text-[10px] tracking-[0.08em] text-muted-foreground/58">
                      {targetShortcutLabel}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-3xl px-4 pb-5 sm:px-5 sm:pb-7">
            <div className="rounded-[22px] border border-border bg-card/90 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset] backdrop-blur-sm">
              <div className="px-4 pb-2 pt-4 sm:px-5 sm:pt-4.5">
                <textarea
                  autoFocus={projects.length > 0}
                  data-testid="new-thread-prompt-input"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={handlePromptKeyDown}
                  placeholder="Ask Codex anything, @ to add files, / for commands"
                  disabled={!selectedProject}
                  rows={1}
                  className="field-sizing-content min-h-14 max-h-56 w-full resize-none bg-transparent text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/55 disabled:cursor-not-allowed"
                />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border/60 px-3 pb-3 pt-2.5 sm:px-4">
                <div className="flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground/70">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    {selectedProject ? (
                      <ProjectFavicon cwd={selectedProject.cwd} className="size-3.5 shrink-0" />
                    ) : (
                      <FolderIcon className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate">
                      {selectedProject?.name ??
                        (projects.length > 0 ? "Choose a project" : "No projects")}
                    </span>
                  </span>
                  <span className="text-border">/</span>
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{targetLabel}</span>
                    {targetShortcutLabel ? (
                      <span className="rounded bg-white/[0.04] px-1 py-0.5 font-medium text-[10px] tracking-[0.08em] text-muted-foreground/58">
                        {targetShortcutLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="hidden truncate text-muted-foreground/50 sm:inline">
                    {targetDescription}
                  </span>
                </div>
                <Button
                  type="submit"
                  size="icon-sm"
                  className={cn("rounded-full", prompt.trim().length === 0 && "bg-primary/85")}
                  disabled={!selectedProject}
                  data-testid="create-thread-submit-button"
                  aria-label={`Create ${effectiveEnvMode === "worktree" ? "workspace" : "local"} thread`}
                >
                  <ArrowUpIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
