import type { GitBranch } from "@t3tools/contracts";

export function resolveNewWorkspaceBaseBranch(
  branches: ReadonlyArray<Pick<GitBranch, "name" | "current" | "isDefault" | "isRemote">>,
): string | null {
  const localBranches = branches.filter((branch) => !branch.isRemote);
  return (
    localBranches.find((branch) => branch.current)?.name ??
    localBranches.find((branch) => branch.isDefault)?.name ??
    localBranches[0]?.name ??
    null
  );
}
