import { beforeEach, describe, expect, it } from "vitest";
import { removeLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";
import {
  buildLegacyClientSettingsMigrationPatch,
  LEGACY_WORKSPACE_EDITOR_VIM_MODE_KEY,
  migrateLocalSettingsToServer,
} from "./useSettings";
import { Schema } from "effect";

const CLIENT_SETTINGS_STORAGE_KEY = "flow:client-settings:v1";

describe("buildLegacyClientSettingsMigrationPatch", () => {
  beforeEach(() => {
    removeLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY);
    removeLocalStorageItem(LEGACY_WORKSPACE_EDITOR_VIM_MODE_KEY);
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
    setLocalStorageItem(LEGACY_WORKSPACE_EDITOR_VIM_MODE_KEY, true, Schema.Boolean);

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
