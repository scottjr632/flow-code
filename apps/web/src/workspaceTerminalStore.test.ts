import { ProjectId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useWorkspaceTerminalStore } from "./workspaceTerminalStore";

const PROJECT_A = ProjectId.makeUnsafe("project-a");
const PROJECT_B = ProjectId.makeUnsafe("project-b");

describe("workspaceTerminalStore", () => {
  beforeEach(() => {
    useWorkspaceTerminalStore.setState({
      isOpen: false,
      projectId: null,
    });
  });

  it("opens directly for a selected project", () => {
    useWorkspaceTerminalStore.getState().openForProject(PROJECT_A);

    expect(useWorkspaceTerminalStore.getState()).toMatchObject({
      isOpen: true,
      projectId: PROJECT_A,
    });
  });

  it("toggles open state for the current project target", () => {
    useWorkspaceTerminalStore.setState({
      isOpen: true,
      projectId: PROJECT_A,
    });

    useWorkspaceTerminalStore.getState().toggle(PROJECT_A);

    expect(useWorkspaceTerminalStore.getState()).toMatchObject({
      isOpen: false,
      projectId: PROJECT_A,
    });
  });

  it("switches targets without closing the panel", () => {
    useWorkspaceTerminalStore.setState({
      isOpen: true,
      projectId: PROJECT_A,
    });

    useWorkspaceTerminalStore.getState().toggle(PROJECT_B);

    expect(useWorkspaceTerminalStore.getState()).toMatchObject({
      isOpen: true,
      projectId: PROJECT_B,
    });
  });

  it("updates the remembered target when setOpen receives a project id", () => {
    useWorkspaceTerminalStore.getState().setOpen(true, PROJECT_B);

    expect(useWorkspaceTerminalStore.getState()).toMatchObject({
      isOpen: true,
      projectId: PROJECT_B,
    });
  });
});
