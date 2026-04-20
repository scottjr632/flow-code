import { describe, expect, it } from "vitest";

import {
  isWorkspaceCommandPaletteShortcut,
  isWorkspaceFilePaletteShortcut,
} from "./workspaceCommandPaletteShortcuts";

function event(
  overrides: Partial<{
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }> = {},
) {
  return {
    key: "k",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("workspace palette shortcuts", () => {
  it("matches only mod+k for the command palette", () => {
    expect(isWorkspaceCommandPaletteShortcut(event({ metaKey: true, key: "k" }))).toBe(true);
    expect(isWorkspaceCommandPaletteShortcut(event({ ctrlKey: true, key: "k" }))).toBe(true);
    expect(isWorkspaceCommandPaletteShortcut(event({ metaKey: true, key: "p" }))).toBe(false);
    expect(
      isWorkspaceCommandPaletteShortcut(event({ metaKey: true, key: "k", shiftKey: true })),
    ).toBe(false);
  });

  it("matches only mod+p for the file palette", () => {
    expect(isWorkspaceFilePaletteShortcut(event({ metaKey: true, key: "p" }))).toBe(true);
    expect(isWorkspaceFilePaletteShortcut(event({ ctrlKey: true, key: "p" }))).toBe(true);
    expect(isWorkspaceFilePaletteShortcut(event({ metaKey: true, key: "k" }))).toBe(false);
    expect(isWorkspaceFilePaletteShortcut(event({ metaKey: true, key: "p", altKey: true }))).toBe(
      false,
    );
  });
});
