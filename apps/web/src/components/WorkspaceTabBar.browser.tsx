import "../index.css";

import { MessageSquareTextIcon, FolderTreeIcon, DiffIcon } from "lucide-react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { WorkspaceTabBar } from "./WorkspaceTabBar";

async function mountTabBar() {
  const host = document.createElement("div");
  document.body.append(host);
  const onReorderTab = vi.fn();
  const screen = await render(
    <WorkspaceTabBar
      tabs={[
        {
          id: "chat",
          kind: "chat",
          title: "Chat",
          closeable: false,
          icon: MessageSquareTextIcon,
        },
        {
          id: "files",
          kind: "files",
          title: "Files",
          closeable: false,
          icon: FolderTreeIcon,
        },
        {
          id: "diff",
          kind: "diff",
          title: "Review",
          closeable: false,
          icon: DiffIcon,
        },
      ]}
      activeTabId="chat"
      onSelectTab={vi.fn()}
      onReorderTab={onReorderTab}
      onCloseTab={vi.fn()}
      canCreateSession={false}
      canCreateTerminal={false}
      canOpenFiles={false}
      canOpenReview={false}
      onCreateSession={vi.fn()}
      onCreateTerminal={vi.fn()}
      onOpenFiles={vi.fn()}
      onOpenReview={vi.fn()}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    cleanup,
    onReorderTab,
  };
}

describe("WorkspaceTabBar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reorders tabs by dragging one tab over another", async () => {
    const mounted = await mountTabBar();

    try {
      const chatButton = page.getByRole("button", { name: "Chat" });
      const reviewButton = page.getByRole("button", { name: "Review" });

      await expect.element(chatButton).toBeInTheDocument();
      await expect.element(reviewButton).toBeInTheDocument();

      await (
        chatButton as unknown as {
          dragTo: (target: typeof reviewButton) => Promise<void>;
        }
      ).dragTo(reviewButton);

      await vi.waitFor(() => {
        expect(mounted.onReorderTab).toHaveBeenCalledWith("chat", "diff");
      });
    } finally {
      await mounted.cleanup();
    }
  });
});
