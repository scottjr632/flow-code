export function buildInlineDiffCommentText(
  comments: ReadonlyArray<{
    header: string;
  }>,
): string {
  return comments
    .map((comment) => comment.header.trim())
    .filter((header) => header.length > 0)
    .join(" ");
}
