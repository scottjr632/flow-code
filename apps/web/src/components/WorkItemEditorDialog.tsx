import { type ProjectId, type WorkItemStatus } from "@t3tools/contracts";
import { CommandIcon } from "lucide-react";

import { isMacPlatform, matchesModEnterShortcut } from "~/lib/utils";
import type { WorkItem } from "~/types";
import { WORK_ITEM_STATUS_ORDER } from "~/workItems.logic";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Kbd } from "./ui/kbd";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "./ui/select";
import { Textarea } from "./ui/textarea";

export interface WorkItemEditorValues {
  projectId: ProjectId | null;
  title: string;
  notes: string;
  status: WorkItemStatus;
  workspaceId: WorkItem["workspaceId"];
}

export interface WorkItemDialogState {
  mode: "create" | "edit";
  item: WorkItem | null;
}

const STATUS_LABELS: Record<WorkItemStatus, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  done: "Done",
};

export function deriveWorkItemEditorValues(
  dialogState: WorkItemDialogState | null,
  preferredProjectId: ProjectId | null,
): WorkItemEditorValues {
  if (dialogState?.mode === "edit" && dialogState.item) {
    return {
      projectId: dialogState.item.projectId,
      title: dialogState.item.title,
      notes: dialogState.item.notes ?? "",
      status: dialogState.item.status,
      workspaceId: dialogState.item.workspaceId,
    };
  }

  return {
    projectId: preferredProjectId,
    title: "",
    notes: "",
    status: "todo",
    workspaceId: null,
  };
}

export function WorkItemEditorDialog({
  open,
  mode,
  values,
  projects,
  workspaces,
  onOpenChange,
  onValuesChange,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  values: WorkItemEditorValues;
  projects: ReadonlyArray<{ id: ProjectId; name: string }>;
  workspaces: ReadonlyArray<{ id: WorkItem["workspaceId"]; name: string }>;
  onOpenChange: (open: boolean) => void;
  onValuesChange: (updater: (current: WorkItemEditorValues) => WorkItemEditorValues) => void;
  onSubmit: () => void;
}) {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const shortcutModifierLabel = isMacPlatform(platform) ? "Cmd" : "Ctrl";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="max-w-md"
        onKeyDown={(event) => {
          if (!matchesModEnterShortcut(event, platform)) {
            return;
          }
          event.preventDefault();
          onSubmit();
        }}
      >
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New work item" : "Edit work item"}</DialogTitle>
          <DialogDescription className="text-xs">
            Title, optional notes, status, and workspace.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Project</label>
              <Select
                value={values.projectId ?? ""}
                onValueChange={(value) => {
                  onValuesChange((current) => ({
                    ...current,
                    projectId:
                      typeof value === "string" && value.length > 0 ? (value as ProjectId) : null,
                    workspaceId: null,
                  }));
                }}
                items={projects.map((project) => ({ value: project.id, label: project.name }))}
                disabled={mode === "edit"}
              >
                <SelectTrigger>
                  <span className={values.projectId ? "text-foreground" : "text-muted-foreground"}>
                    {projects.find((project) => project.id === values.projectId)?.name ??
                      "Choose project"}
                  </span>
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select
                value={values.status}
                onValueChange={(value) => {
                  if (value === "todo" || value === "in_progress" || value === "done") {
                    onValuesChange((current) => ({ ...current, status: value }));
                  }
                }}
                items={WORK_ITEM_STATUS_ORDER.map((status) => ({
                  value: status,
                  label: STATUS_LABELS[status],
                }))}
              >
                <SelectTrigger>{STATUS_LABELS[values.status]}</SelectTrigger>
                <SelectPopup>
                  {WORK_ITEM_STATUS_ORDER.map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <Input
              value={values.title}
              onChange={(event) => {
                const nextTitle = event.target.value;
                onValuesChange((current) => ({ ...current, title: nextTitle }));
              }}
              placeholder="Investigate flaky browser diff test"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <Textarea
              value={values.notes}
              onChange={(event) => {
                const nextNotes = event.target.value;
                onValuesChange((current) => ({ ...current, notes: nextNotes }));
              }}
              placeholder="Optional context, constraints, or follow-ups"
              rows={3}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Workspace</label>
            <Select
              value={values.workspaceId ?? "__none__"}
              onValueChange={(value) => {
                onValuesChange((current) => ({
                  ...current,
                  workspaceId:
                    value === "__none__" ? null : (value as NonNullable<WorkItem["workspaceId"]>),
                }));
              }}
              items={[
                { value: "__none__", label: "No workspace" },
                ...workspaces.flatMap((workspace) =>
                  workspace.id ? [{ value: workspace.id, label: workspace.name }] : [],
                ),
              ]}
            >
              <SelectTrigger>
                {workspaces.find((workspace) => workspace.id === values.workspaceId)?.name ??
                  "No workspace"}
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="__none__">No workspace</SelectItem>
                {workspaces
                  .filter(
                    (
                      workspace,
                    ): workspace is { id: NonNullable<WorkItem["workspaceId"]>; name: string } =>
                      workspace.id !== null,
                  )
                  .map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
              </SelectPopup>
            </Select>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!values.projectId || values.title.trim().length === 0}
          >
            {mode === "create" ? (
              <>
                <span>Create</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-foreground/12 px-1.5 py-0.75 text-[9px] text-primary-foreground/80">
                  <Kbd className="h-3.5 min-w-3.5 rounded-md bg-primary-foreground/10 px-0.75 text-[9px] text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)]">
                    {isMacPlatform(platform) ? (
                      <>
                        <CommandIcon aria-hidden="true" className="size-2.5" />
                        <span className="sr-only">{shortcutModifierLabel}</span>
                      </>
                    ) : (
                      shortcutModifierLabel
                    )}
                  </Kbd>
                  <Kbd className="h-3.5 min-w-3.5 rounded-md bg-primary-foreground/10 px-0.75 text-[9px] text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)]">
                    Enter
                  </Kbd>
                </span>
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
