import { ThreadId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useMemo, useRef, type ReactNode } from "react";

import ThreadSidebar, {
  type ThreadTraversalController,
  type ActiveThreadTraversalSession,
} from "./Sidebar";
import WorkspaceTerminalPanel from "./WorkspaceTerminalPanel";
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
  const recordThreadTraversal = useStore((store) => store.recordThreadTraversal);
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const activeThreadTraversalRef = useRef<ActiveThreadTraversalSession | null>(null);
  const previousRouteThreadIdRef = useRef(routeThreadId);
  const threadTraversalIds = useMemo(
    () =>
      getThreadIdsForKeyboardTraversal(
        threads.filter((thread) => thread.archivedAt === null),
        threadMruIds,
        routeThreadId,
      ),
    [routeThreadId, threadMruIds, threads],
  );
  const finishThreadTraversal = useEffectEvent(() => {
    const activeTraversal = activeThreadTraversalRef.current;
    activeThreadTraversalRef.current = null;
    if (!activeTraversal || !routeThreadId || activeTraversal.originThreadId === routeThreadId) {
      return;
    }

    recordThreadTraversal(activeTraversal.originThreadId, routeThreadId);
  });
  const beginThreadTraversal = useEffectEvent((session: ActiveThreadTraversalSession) => {
    if (activeThreadTraversalRef.current) {
      return;
    }
    activeThreadTraversalRef.current = session;
  });
  const threadTraversalController = useMemo<ThreadTraversalController>(
    () => ({
      activeSessionRef: activeThreadTraversalRef,
      beginSession: beginThreadTraversal,
      finishSession: finishThreadTraversal,
    }),
    [],
  );

  useEffect(() => {
    const previousThreadId = previousRouteThreadIdRef.current;
    previousRouteThreadIdRef.current = routeThreadId;
    if (
      !previousThreadId ||
      !routeThreadId ||
      previousThreadId === routeThreadId ||
      activeThreadTraversalRef.current
    ) {
      return;
    }

    recordThreadTraversal(previousThreadId, routeThreadId);
  }, [recordThreadTraversal, routeThreadId]);

  useEffect(() => {
    const onWindowKeyUp = (event: KeyboardEvent) => {
      const activeTraversal = activeThreadTraversalRef.current;
      if (!activeTraversal || event[activeTraversal.modifierKey]) {
        return;
      }

      finishThreadTraversal();
    };

    const onWindowBlur = () => {
      finishThreadTraversal();
    };

    window.addEventListener("keyup", onWindowKeyUp);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keyup", onWindowKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

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

      if (action === "thread-traversal-end") {
        finishThreadTraversal();
        return;
      }

      if (action !== "thread-next" && action !== "thread-previous") {
        return;
      }

      const activeTraversal = activeThreadTraversalRef.current;
      const traversalThreadIds = activeTraversal?.threadIds ?? threadTraversalIds;
      if (!activeTraversal && routeThreadId) {
        beginThreadTraversal({
          originThreadId: routeThreadId,
          modifierKey: "ctrlKey",
          threadIds: traversalThreadIds,
        });
      }

      const targetThreadId = resolveThreadKeyboardTraversal({
        threadIds: traversalThreadIds,
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
        <ThreadSidebar threadTraversalController={threadTraversalController} />
        <SidebarRail />
      </Sidebar>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 overflow-hidden">{children}</div>
        <WorkspaceTerminalPanel />
      </div>
    </SidebarProvider>
  );
}
