import { beforeEach, describe, expect, it } from "vitest";

import {
  getPreferredWorkSurfaceView,
  setPreferredWorkSurfaceView,
} from "./workSurfaceViewPreference";

describe("workSurfaceViewPreference", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const storage = {
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    } satisfies Storage;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: storage,
      },
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    storage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(getPreferredWorkSurfaceView()).toBeNull();
  });

  it("persists and restores a valid view", () => {
    setPreferredWorkSurfaceView("list");

    expect(getPreferredWorkSurfaceView()).toBe("list");
  });

  it("ignores malformed stored values", () => {
    localStorage.setItem("flow:work-surface-view:v1", "calendar");

    expect(getPreferredWorkSurfaceView()).toBeNull();
  });
});
