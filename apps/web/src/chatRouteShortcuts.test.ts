import { describe, expect, it } from "vitest";

import { shouldBypassChatRouteShortcut } from "./chatRouteShortcuts";

describe("shouldBypassChatRouteShortcut", () => {
  it("lets the create-thread screen own new-thread shortcuts", () => {
    expect(shouldBypassChatRouteShortcut("/", "chat.new")).toBe(true);
    expect(shouldBypassChatRouteShortcut("/", "chat.newLocal")).toBe(true);
  });

  it("keeps other shortcuts active on the create-thread screen", () => {
    expect(shouldBypassChatRouteShortcut("/", "thread.next")).toBe(false);
  });

  it("keeps new-thread shortcuts active away from the create-thread screen", () => {
    expect(shouldBypassChatRouteShortcut("/thread-1", "chat.new")).toBe(false);
    expect(shouldBypassChatRouteShortcut("/thread-1", "chat.newLocal")).toBe(false);
  });
});
