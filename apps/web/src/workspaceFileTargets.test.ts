import { describe, expect, it } from "vitest";

import { resolveWorkspaceRelativeFileTarget } from "./workspaceFileTargets";

describe("resolveWorkspaceRelativeFileTarget", () => {
  it("maps workspace file targets to relative paths", () => {
    expect(
      resolveWorkspaceRelativeFileTarget(
        "/Users/julius/project/src/components/ChatView.tsx:42:7",
        "/Users/julius/project",
      ),
    ).toBe("src/components/ChatView.tsx");
  });

  it("returns null for files outside the workspace root", () => {
    expect(
      resolveWorkspaceRelativeFileTarget(
        "/Users/julius/other-project/src/components/ChatView.tsx:42:7",
        "/Users/julius/project",
      ),
    ).toBeNull();
  });

  it("matches Windows paths case-insensitively", () => {
    expect(
      resolveWorkspaceRelativeFileTarget(
        "C:/Users/Julius/Project/src/components/ChatView.tsx:42",
        "c:\\users\\julius\\project",
      ),
    ).toBe("src/components/ChatView.tsx");
  });

  it("does not match sibling paths with a shared prefix", () => {
    expect(
      resolveWorkspaceRelativeFileTarget(
        "/Users/julius/project-two/src/components/ChatView.tsx",
        "/Users/julius/project",
      ),
    ).toBeNull();
  });
});
