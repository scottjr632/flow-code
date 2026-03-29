import { ThreadId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, type ReactNode } from "react";

import ThreadSidebar from "./Sidebar";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import { getThreadIdsForKeyboardTraversal, resolveThreadKeyboardTraversal } from "./Sidebar.logic";
import { useStore } from "../store";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const threads = useStore((store) => store.threads);
  const threadMruIds = useStore((store) => store.threadMruIds ?? []);
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const threadTraversalIds = useMemo(
    () =>
      getThreadIdsForKeyboardTraversal(
        threads.filter((thread) => thread.archivedAt === null),
        threadMruIds,
      ),
    [threadMruIds, threads],
  );

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        void navigate({ to: "/settings" });
        return;
      }

      if (action !== "thread-next" && action !== "thread-previous") {
        return;
      }

      const targetThreadId = resolveThreadKeyboardTraversal({
        threadIds: threadTraversalIds,
        currentThreadId: routeThreadId,
        direction: action === "thread-next" ? "next" : "previous",
      });
      if (!targetThreadId) {
        return;
      }

      void navigate({
        to: "/$threadId",
        params: { threadId: targetThreadId },
      });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, routeThreadId, threadTraversalIds]);

  return (
    <SidebarProvider defaultOpen>
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="border-r border-border bg-card text-foreground"
        resizable={{
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ nextWidth, wrapper }) =>
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <ThreadSidebar />
        <SidebarRail />
      </Sidebar>
      {children}
    </SidebarProvider>
  );
}
