import {
  HOME_PROJECT_ID,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type ProjectId,
} from "@t3tools/contracts";

export function isHomeProjectId(projectId: ProjectId): boolean {
  return projectId === HOME_PROJECT_ID;
}

export function isSystemProject(project: Pick<OrchestrationProject, "id" | "systemKey">): boolean {
  return project.systemKey === "home" || isHomeProjectId(project.id);
}

export function makeHomeProject(homeProjectDir: string, updatedAt: string): OrchestrationProject {
  return {
    id: HOME_PROJECT_ID,
    title: "Home",
    workspaceRoot: homeProjectDir,
    systemKey: "home",
    defaultModelSelection: {
      provider: "codex",
      model: "gpt-5.4",
    },
    scripts: [],
    createdAt: new Date(0).toISOString(),
    updatedAt,
    deletedAt: null,
  };
}

export function withSystemProjects(
  readModel: OrchestrationReadModel,
  input: {
    readonly homeProjectDir: string;
  },
): OrchestrationReadModel {
  const homeProject = makeHomeProject(
    input.homeProjectDir,
    readModel.updatedAt ?? new Date(0).toISOString(),
  );

  return {
    ...readModel,
    projects: [
      homeProject,
      ...readModel.projects.filter((project) => project.id !== HOME_PROJECT_ID),
    ],
  };
}
