import { assert, describe, it } from "vitest";

import { isWindowsPlatform, matchesModEnterShortcut } from "./utils";

describe("isWindowsPlatform", () => {
  it("matches Windows platform identifiers", () => {
    assert.isTrue(isWindowsPlatform("Win32"));
    assert.isTrue(isWindowsPlatform("Windows"));
    assert.isTrue(isWindowsPlatform("windows_nt"));
  });

  it("does not match darwin", () => {
    assert.isFalse(isWindowsPlatform("darwin"));
  });
});

describe("matchesModEnterShortcut", () => {
  it("matches Cmd+Enter on macOS", () => {
    assert.isTrue(
      matchesModEnterShortcut(
        {
          key: "Enter",
          altKey: false,
          shiftKey: false,
          metaKey: true,
          ctrlKey: false,
        },
        "MacIntel",
      ),
    );
  });

  it("matches Ctrl+Enter on non-mac platforms", () => {
    assert.isTrue(
      matchesModEnterShortcut(
        {
          key: "Enter",
          altKey: false,
          shiftKey: false,
          metaKey: false,
          ctrlKey: true,
        },
        "Linux x86_64",
      ),
    );
  });

  it("rejects plain Enter and composition events", () => {
    assert.isFalse(
      matchesModEnterShortcut(
        {
          key: "Enter",
          altKey: false,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        },
        "MacIntel",
      ),
    );
    assert.isFalse(
      matchesModEnterShortcut(
        {
          key: "Enter",
          altKey: false,
          shiftKey: false,
          metaKey: true,
          ctrlKey: false,
          nativeEvent: { isComposing: true },
        },
        "MacIntel",
      ),
    );
  });
});
