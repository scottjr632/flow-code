export const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".convex",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
]);

export function isPathInIgnoredDirectory(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  const firstSegment = normalized.split("/")[0];
  if (!firstSegment) {
    return false;
  }
  return IGNORED_DIRECTORY_NAMES.has(firstSegment);
}
