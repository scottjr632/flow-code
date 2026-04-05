const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\/;

function normalizePathSeparators(value: string): string {
  return value.replaceAll("\\", "/");
}

function trimTrailingSlashes(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

function isWindowsPath(value: string): boolean {
  return WINDOWS_DRIVE_PATH_PATTERN.test(value) || WINDOWS_UNC_PATH_PATTERN.test(value);
}

function splitPathAndPosition(value: string): {
  path: string;
  line: string | undefined;
  column: string | undefined;
} {
  let path = value.trim();
  let column: string | undefined;
  let line: string | undefined;

  const columnMatch = path.match(/:(\d+)$/);
  if (!columnMatch?.[1]) {
    return { path, line: undefined, column: undefined };
  }

  column = columnMatch[1];
  path = path.slice(0, -columnMatch[0].length);

  const lineMatch = path.match(/:(\d+)$/);
  if (lineMatch?.[1]) {
    line = lineMatch[1];
    path = path.slice(0, -lineMatch[0].length);
  } else {
    line = column;
    column = undefined;
  }

  return { path, line, column };
}

export function resolveWorkspaceRelativeFileTarget(
  targetPath: string,
  workspaceRoot: string,
): string | null {
  const { path } = splitPathAndPosition(targetPath);
  const normalizedPath = trimTrailingSlashes(normalizePathSeparators(path));
  const normalizedRoot = trimTrailingSlashes(normalizePathSeparators(workspaceRoot.trim()));
  if (normalizedPath.length === 0 || normalizedRoot.length === 0) {
    return null;
  }

  const shouldFoldCase = isWindowsPath(normalizedPath) || isWindowsPath(normalizedRoot);
  const comparablePath = shouldFoldCase ? normalizedPath.toLowerCase() : normalizedPath;
  const comparableRoot = shouldFoldCase ? normalizedRoot.toLowerCase() : normalizedRoot;
  const comparablePrefix = comparableRoot.endsWith("/") ? comparableRoot : `${comparableRoot}/`;
  if (!comparablePath.startsWith(comparablePrefix)) {
    return null;
  }

  const relativePath = normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, "");
  return relativePath.length > 0 ? relativePath : null;
}
