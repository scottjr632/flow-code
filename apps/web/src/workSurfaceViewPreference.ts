export type PersistedWorkSurfaceView = "board" | "list";

const STORAGE_KEY = "flow:work-surface-view:v1";

function isPersistedWorkSurfaceView(value: unknown): value is PersistedWorkSurfaceView {
  return value === "board" || value === "list";
}

export function getPreferredWorkSurfaceView(): PersistedWorkSurfaceView | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isPersistedWorkSurfaceView(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function setPreferredWorkSurfaceView(view: PersistedWorkSurfaceView): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // Ignore storage failures so the work surface remains usable.
  }
}
