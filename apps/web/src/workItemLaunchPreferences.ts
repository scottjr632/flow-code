import type { ProjectId } from "@t3tools/contracts";

export type WorkItemLaunchMode = "local" | "workspace";

const STORAGE_KEY = "flow:work-item-launch-mode-by-project:v1";

function readLaunchModeMap(): Record<string, WorkItemLaunchMode> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([projectId, value]) =>
        value === "local" || value === "workspace" ? [[projectId, value] as const] : [],
      ),
    );
  } catch {
    return {};
  }
}

function writeLaunchModeMap(value: Record<string, WorkItemLaunchMode>): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures so launch still works.
  }
}

export function getPreferredWorkItemLaunchMode(projectId: ProjectId): WorkItemLaunchMode | null {
  const stored = readLaunchModeMap()[projectId];
  return stored ?? null;
}

export function setPreferredWorkItemLaunchMode(
  projectId: ProjectId,
  mode: WorkItemLaunchMode,
): void {
  const next = readLaunchModeMap();
  next[projectId] = mode;
  writeLaunchModeMap(next);
}

export function resolveDefaultWorkItemLaunchMode(input: {
  readonly projectId: ProjectId;
  readonly hasWorkspace: boolean;
}): WorkItemLaunchMode {
  const stored = getPreferredWorkItemLaunchMode(input.projectId);
  if (stored) {
    return stored;
  }
  return input.hasWorkspace ? "workspace" : "local";
}
