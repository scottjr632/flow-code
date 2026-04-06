import { describe, expect, it } from "vitest";

import { buildWorkItemLaunchPrompt } from "./workItemPrompt";

describe("buildWorkItemLaunchPrompt", () => {
  it("returns the title when the work item has no notes", () => {
    expect(
      buildWorkItemLaunchPrompt({
        title: "Fix the flaky browser test",
        notes: null,
      }),
    ).toBe("Fix the flaky browser test");
  });

  it("includes trimmed notes as context when present", () => {
    expect(
      buildWorkItemLaunchPrompt({
        title: "Fix the flaky browser test",
        notes: "  Repro seems tied to WebSocket reconnects.\nCheck pending sends too.  ",
      }),
    ).toBe(
      [
        "Task: Fix the flaky browser test",
        "",
        "Context:",
        "Repro seems tied to WebSocket reconnects.\nCheck pending sends too.",
      ].join("\n"),
    );
  });
});
