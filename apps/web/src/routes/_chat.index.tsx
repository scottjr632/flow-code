import { createFileRoute } from "@tanstack/react-router";

import { NewThreadScreen } from "../components/NewThreadScreen";
import { type SidebarNewThreadEnvMode } from "../components/Sidebar.logic";

function ChatIndexRouteView() {
  const search = Route.useSearch();

  return (
    <NewThreadScreen
      key={`${search.projectId ?? "none"}:${search.envMode ?? "default"}`}
      {...(search.projectId ? { requestedProjectId: search.projectId } : {})}
      {...(search.envMode ? { requestedEnvMode: search.envMode } : {})}
    />
  );
}

export const Route = createFileRoute("/_chat/")({
  validateSearch: (search) => ({
    ...(typeof search.projectId === "string" && search.projectId.length > 0
      ? { projectId: search.projectId }
      : {}),
    ...(search.envMode === "local" || search.envMode === "worktree"
      ? { envMode: search.envMode as SidebarNewThreadEnvMode }
      : {}),
  }),
  component: ChatIndexRouteView,
});
