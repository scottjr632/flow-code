import { type ProjectId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { WorkSurface } from "~/components/WorkSurface";
import {
  getPreferredWorkSurfaceView,
  setPreferredWorkSurfaceView,
} from "~/workSurfaceViewPreference";

function WorkRouteView() {
  const navigate = useNavigate();
  const search = Route.useSearch() as {
    view?: "board" | "list";
    projectId?: string;
  };
  const view = search.view ?? getPreferredWorkSurfaceView() ?? "board";
  const selectedProjectId = (search.projectId ?? null) as ProjectId | null;

  useEffect(() => {
    if (search.view === "board" || search.view === "list") {
      setPreferredWorkSurfaceView(search.view);
    }
  }, [search.view]);

  return (
    <WorkSurface
      view={view}
      selectedProjectId={selectedProjectId}
      onViewChange={(nextView) => {
        setPreferredWorkSurfaceView(nextView);
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
