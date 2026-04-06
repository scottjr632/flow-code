import type { WorkItem } from "./types";

export function buildWorkItemLaunchPrompt(item: Pick<WorkItem, "title" | "notes">): string {
  const title = item.title.trim();
  const notes = item.notes?.trim() ?? "";

  if (notes.length === 0) {
    return title;
  }

  return [`Task: ${title}`, "", "Context:", notes].join("\n");
}
