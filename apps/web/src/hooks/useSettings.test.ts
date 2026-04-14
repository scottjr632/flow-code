import { beforeEach, describe, expect, it } from "vitest";
import {
  buildLegacyClientSettingsMigrationPatch,
  LEGACY_WORKSPACE_EDITOR_VIM_MODE_KEY,
  migrateLocalSettingsToServer,
} from "./useSettings";

const CLIENT_SETTINGS_STORAGE_KEY = "flow:client-settings:v1";

function createMockStorage() {
  const store = new Map<string, string>();
  return {
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
}

describe("buildLegacyClientSettingsMigrationPatch", () => {
  beforeEach(() => {
    const storage = createMockStorage();

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

  it("migrates archive confirmation from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        confirmThreadArchive: true,
        confirmThreadDelete: false,
      }),
    ).toEqual({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
    });
  });

  it("migrates vim mode from the legacy settings payload", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        vimMode: true,
      }),
    ).toEqual({
      vimMode: true,
    });
  });

  it("migrates the standalone workspace editor vim preference into client settings", () => {
    localStorage.setItem(LEGACY_WORKSPACE_EDITOR_VIM_MODE_KEY, "true");

    migrateLocalSettingsToServer();

    expect(
      localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY) &&
        JSON.parse(localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY) ?? "{}"),
    ).toMatchObject({
      vimMode: true,
    });
    expect(localStorage.getItem(LEGACY_WORKSPACE_EDITOR_VIM_MODE_KEY)).toBeNull();
  });
});
