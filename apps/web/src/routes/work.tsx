import { type ProjectId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { WorkSurface } from "~/components/WorkSurface";

function WorkRouteView() {
  const navigate = useNavigate();
  const search = Route.useSearch() as {
    view?: "board" | "list";
    projectId?: string;
  };
  const view = search.view ?? "board";
  const selectedProjectId = (search.projectId ?? null) as ProjectId | null;

  return (
    <WorkSurface
      view={view}
      selectedProjectId={selectedProjectId}
      onViewChange={(nextView) => {
        void navigate({
          to: "/work",
          replace: true,
          search: {
            view: nextView,
            ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
          },
        });
      }}
      onProjectFilterChange={(projectId) => {
        void navigate({
          to: "/work",
          replace: true,
          search: {
            view,
            ...(projectId ? { projectId } : {}),
          },
        });
      }}
    />
  );
}

export const Route = createFileRoute("/work")({
  validateSearch: (search) => ({
    ...(search.view === "board" || search.view === "list" ? { view: search.view } : {}),
    ...(typeof search.projectId === "string" && search.projectId.length > 0
      ? { projectId: search.projectId }
      : {}),
  }),
  component: WorkRouteView,
});
