import { describe, expect, it } from "vitest";
import { DEFAULT_CLIENT_SETTINGS, DEFAULT_SERVER_SETTINGS } from "./settings";

describe("DEFAULT_CLIENT_SETTINGS", () => {
  it("includes archive confirmation with a false default", () => {
    expect(DEFAULT_CLIENT_SETTINGS.confirmThreadArchive).toBe(false);
  });
});

describe("DEFAULT_SERVER_SETTINGS", () => {
  it("includes the default git branch name prefix", () => {
    expect(DEFAULT_SERVER_SETTINGS.gitBranchNamePrefix).toBe("feature");
  });
});
