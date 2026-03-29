import path from "node:path";

import type { ProjectDiagnostic } from "@t3tools/contracts";

import { isPathInIgnoredDirectory } from "./workspaceIgnore";

export const MAX_PROJECT_DIAGNOSTICS = 500;

export function toPosixRelativePath(input: string): string {
  return input.replaceAll("\\", "/");
}

export function normalizeRelativeFilter(relativePath: string | undefined): string | null {
  const normalized = (relativePath ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : null;
}

export function toRelativeWorkspacePath(cwd: string, absolutePath: string): string | null {
  const relativePath = toPosixRelativePath(path.relative(cwd, absolutePath));
  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    path.isAbsolute(relativePath) ||
    isPathInIgnoredDirectory(relativePath)
  ) {
    return null;
  }
  return relativePath;
}

export function sortProjectDiagnostics(
  diagnostics: readonly ProjectDiagnostic[],
): ProjectDiagnostic[] {
  return [...diagnostics].toSorted((left, right) => {
    const pathOrder = left.relativePath.localeCompare(right.relativePath);
    if (pathOrder !== 0) {
      return pathOrder;
    }
    if (left.startLine !== right.startLine) {
      return left.startLine - right.startLine;
    }
    if (left.startColumn !== right.startColumn) {
      return left.startColumn - right.startColumn;
    }
    return left.message.localeCompare(right.message);
  });
}
