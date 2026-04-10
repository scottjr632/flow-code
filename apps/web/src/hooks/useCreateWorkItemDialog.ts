import { type ProjectId } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";

import {
  deriveWorkItemEditorValues,
  type WorkItemDialogState,
  type WorkItemEditorValues,
} from "~/components/WorkItemEditorDialog";
import { toastManager } from "~/components/ui/toast";
import type { WorkItem } from "~/types";
import { useWorkItemActions } from "./useWorkItemActions";

interface UseCreateWorkItemDialogProject {
  readonly id: ProjectId;
  readonly name: string;
}

interface UseCreateWorkItemDialogWorkspace {
  readonly id: WorkItem["workspaceId"];
  readonly name: string;
  readonly projectId: ProjectId;
}

export function useCreateWorkItemDialog(input: {
  readonly projects: ReadonlyArray<UseCreateWorkItemDialogProject>;
  readonly workspaces: ReadonlyArray<UseCreateWorkItemDialogWorkspace>;
}) {
  const { createWorkItem } = useWorkItemActions();
  const [dialogState, setDialogState] = useState<WorkItemDialogState | null>(null);
  const [editorValues, setEditorValues] = useState<WorkItemEditorValues>(() =>
    deriveWorkItemEditorValues(null, null),
  );

  const resolvePreferredProjectId = useCallback(
    (preferredProjectId: ProjectId | null) => {
      if (
        preferredProjectId &&
        input.projects.some((project) => project.id === preferredProjectId)
      ) {
        return preferredProjectId;
      }

      return input.projects[0]?.id ?? null;
    },
    [input.projects],
  );

  const openCreateDialog = useCallback(
    (preferredProjectId: ProjectId | null) => {
      const resolvedProjectId = resolvePreferredProjectId(preferredProjectId);
      setDialogState({ mode: "create", item: null });
      setEditorValues(deriveWorkItemEditorValues(null, resolvedProjectId));
    },
    [resolvePreferredProjectId],
  );

  const closeDialog = useCallback((open: boolean) => {
    if (open) {
      return;
    }
    setDialogState(null);
  }, []);

  const workspaceOptions = useMemo(
    () =>
      input.workspaces
        .filter((workspace) => workspace.projectId === editorValues.projectId)
        .toSorted((left, right) => left.name.localeCompare(right.name))
        .map((workspace) => ({ id: workspace.id, name: workspace.name })),
    [editorValues.projectId, input.workspaces],
  );

  const handleSubmit = useCallback(() => {
    if (!dialogState || !editorValues.projectId) {
      return;
    }

    const title = editorValues.title.trim();
    if (title.length === 0) {
      return;
    }

    const notes = editorValues.notes.trim();
    void createWorkItem({
      projectId: editorValues.projectId,
      title,
      notes: notes.length > 0 ? notes : null,
      workspaceId: editorValues.workspaceId,
      status: editorValues.status,
      source: "manual",
    })
      .then(() => {
        setDialogState(null);
      })
      .catch((error) => {
        toastManager.add({
          type: "error",
          title: "Failed to create work item",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      });
  }, [createWorkItem, dialogState, editorValues]);

  return {
    closeDialog,
    dialogState,
    editorValues,
    handleSubmit,
    openCreateDialog,
    setEditorValues,
    workspaceOptions,
  };
}
