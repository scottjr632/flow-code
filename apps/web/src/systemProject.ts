import { HOME_PROJECT_ID, type ProjectId } from "@t3tools/contracts";
import type { Project } from "./types";

export function isHomeProject(
  project: Pick<Project, "id" | "systemKey"> | null | undefined,
): boolean {
  return project?.systemKey === "home" || project?.id === HOME_PROJECT_ID;
}

export function isHomeProjectId(projectId: ProjectId | null | undefined): boolean {
  return projectId === HOME_PROJECT_ID;
}

export function isUserProject(
  project: Pick<Project, "id" | "systemKey"> | null | undefined,
): boolean {
  return !isHomeProject(project);
}
