/**
 * Sanitize an arbitrary string into a valid, lowercase git branch fragment.
 * Strips quotes, collapses separators, limits to 64 chars.
 */
export function sanitizeBranchFragment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/^[./\s_-]+|[./\s_-]+$/g, "");

  const branchFragment = normalized
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  return branchFragment.length > 0 ? branchFragment : "update";
}

const DEFAULT_BRANCH_NAME_PREFIX = "feature";

/**
 * Sanitize a user-provided branch prefix or namespace.
 * Falls back to `feature` when the value is blank or collapses away.
 */
export function sanitizeBranchNamePrefix(raw: string | null | undefined): string {
  const normalized = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/^[./\s_-]+|[./\s_-]+$/g, "");

  const sanitized = normalized
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");
  return sanitized.length > 0 ? sanitized : DEFAULT_BRANCH_NAME_PREFIX;
}

/**
 * Sanitize a string into a `${prefix}/…` branch name.
 * Replaces the default `feature/` prefix when a custom namespace is configured.
 */
export function sanitizeFeatureBranchName(
  raw: string,
  prefix: string = DEFAULT_BRANCH_NAME_PREFIX,
): string {
  const branchPrefix = sanitizeBranchNamePrefix(prefix);
  const sanitized = sanitizeBranchFragment(raw);
  if (sanitized.startsWith(`${branchPrefix}/`)) {
    return sanitized;
  }
  const withoutDefaultPrefix =
    branchPrefix !== DEFAULT_BRANCH_NAME_PREFIX &&
    sanitized.startsWith(`${DEFAULT_BRANCH_NAME_PREFIX}/`)
      ? sanitized.slice(`${DEFAULT_BRANCH_NAME_PREFIX}/`.length)
      : sanitized;
  return `${branchPrefix}/${withoutDefaultPrefix}`;
}

/**
 * Resolve a unique `${prefix}/…` branch name that doesn't collide with
 * any existing branch. Appends a numeric suffix when needed.
 */
export function resolveAutoFeatureBranchName(
  existingBranchNames: readonly string[],
  preferredBranch?: string,
  prefix: string = DEFAULT_BRANCH_NAME_PREFIX,
): string {
  const branchPrefix = sanitizeBranchNamePrefix(prefix);
  const preferred = preferredBranch?.trim();
  const resolvedBase = sanitizeFeatureBranchName(
    preferred && preferred.length > 0 ? preferred : `${branchPrefix}/update`,
    branchPrefix,
  );
  const existingNames = new Set(existingBranchNames.map((branch) => branch.toLowerCase()));

  if (!existingNames.has(resolvedBase)) {
    return resolvedBase;
  }

  let suffix = 2;
  while (existingNames.has(`${resolvedBase}-${suffix}`)) {
    suffix += 1;
  }

  return `${resolvedBase}-${suffix}`;
}
