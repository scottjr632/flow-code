import { describe, expect, it } from "vitest";

import { resolveDesktopMenuActionForInput } from "./menuActionShortcuts";

describe("resolveDesktopMenuActionForInput", () => {
  it("maps ctrl-tab to next session", () => {
    expect(
      resolveDesktopMenuActionForInput({
        type: "keyDown",
        key: "Tab",
        control: true,
        shift: false,
      }),
    ).toBe("thread-next");
  });

  it("maps ctrl-shift-tab to previous session", () => {
    expect(
      resolveDesktopMenuActionForInput({
        type: "keyDown",
        key: "Tab",
        control: true,
        shift: true,
      }),
    ).toBe("thread-previous");
  });

  it("ignores non-matching input", () => {
    expect(
      resolveDesktopMenuActionForInput({
        type: "keyDown",
        key: "Tab",
        control: false,
        shift: false,
      }),
    ).toBeNull();
    expect(
      resolveDesktopMenuActionForInput({
        type: "keyUp",
        key: "Tab",
        control: true,
        shift: false,
      }),
    ).toBeNull();
  });

  it("maps control release to traversal end", () => {
    expect(
      resolveDesktopMenuActionForInput({
        type: "keyUp",
        key: "Control",
        control: false,
        shift: false,
      }),
    ).toBe("thread-traversal-end");
    expect(
      resolveDesktopMenuActionForInput({
        type: "keyUp",
        key: "Tab",
        control: false,
        shift: false,
      }),
    ).toBe("thread-traversal-end");
  });
});
