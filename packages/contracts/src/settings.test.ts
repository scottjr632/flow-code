import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_TERMINAL_FONT_FAMILY,
} from "./settings";

describe("DEFAULT_CLIENT_SETTINGS", () => {
  it("includes archive confirmation with a false default", () => {
    expect(DEFAULT_CLIENT_SETTINGS.confirmThreadArchive).toBe(false);
  });

  it("includes the default terminal font family", () => {
    expect(DEFAULT_CLIENT_SETTINGS.terminalFontFamily).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
  });
});

describe("DEFAULT_SERVER_SETTINGS", () => {
  it("includes the default git branch name prefix", () => {
    expect(DEFAULT_SERVER_SETTINGS.gitBranchNamePrefix).toBe("feature");
  });
});
