/**
 * CheckpointStoreLive - Filesystem checkpoint store adapter layer.
 *
 * Uses the configured turn-review backend to capture workspace checkpoints for
 * turn diffs and checkpoint reverts. Git workspaces keep using hidden refs,
 * while Jujutsu workspaces persist lightweight metadata that points at
 * snapshotted working-copy commits.
 *
 * @module CheckpointStoreLive
 */
import { randomUUID } from "node:crypto";

import { Effect, FileSystem, Layer, Path } from "effect";

import { CheckpointInvariantError } from "../Errors.ts";
import { GitCommandError } from "../../git/Errors.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { runProcess } from "../../processRunner.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { CheckpointStore, type CheckpointStoreShape } from "../Services/CheckpointStore.ts";
import { CheckpointRef, type TurnReviewVcsPreference } from "@t3tools/contracts";

const JJ_COMMAND_TIMEOUT_MS = 30_000;
const JJ_METADATA_DIRNAME = "t3code-checkpoints";
// Turn-review diffs can legitimately be much larger than the generic GitCore
// output budget. Keep this scoped to checkpoint diffs so normal git commands
// still fail fast on runaway output.
const CHECKPOINT_DIFF_MAX_OUTPUT_BYTES = 100_000_000;
const GIT_DIFF_EXCLUDED_PATHS = [".", ":(glob,exclude)**/node_modules/**"] as const;
const JJ_DIFF_EXCLUDED_FILESET = 'all() ~ (root:"node_modules" | root-glob:"**/node_modules/**")';
const TURN_REVIEW_BACKEND_UNAVAILABLE_DETAIL =
  "The selected turn review backend is unavailable for this project.";

type CheckpointBackend =
  | { readonly kind: "git" }
  | {
      readonly kind: "jj";
      readonly workspaceRoot: string;
      readonly metadataDir: string;
    };

type JjCheckpointMetadata = {
  readonly backend: "jj";
  readonly opId: string;
  readonly commitId: string;
};

function toCheckpointInvariantError(
  operation: string,
  detail: string,
  cause?: unknown,
): CheckpointInvariantError {
  return new CheckpointInvariantError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

const makeCheckpointStore = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitCore;
  const serverSettingsService = yield* ServerSettingsService;

  const resolveConfiguredTurnReviewPreference = Effect.gen(function* () {
    const settings = yield* serverSettingsService.getSettings.pipe(
      Effect.mapError((error) =>
        toCheckpointInvariantError(
          "CheckpointStore.resolveConfiguredTurnReviewPreference",
          `Failed to read server settings: ${error.message}`,
          error,
        ),
      ),
    );
    return settings.turnReviewVcs;
  });

  const resolveHeadCommit = (cwd: string): Effect.Effect<string | null, GitCommandError> =>
    git
      .execute({
        operation: "CheckpointStore.resolveHeadCommit",
        cwd,
        args: ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => {
          if (result.code !== 0) {
            return null;
          }
          const commit = result.stdout.trim();
          return commit.length > 0 ? commit : null;
        }),
      );

  const hasHeadCommit = (cwd: string): Effect.Effect<boolean, GitCommandError> =>
    git
      .execute({
        operation: "CheckpointStore.hasHeadCommit",
        cwd,
        args: ["rev-parse", "--verify", "HEAD"],
        allowNonZeroExit: true,
      })
      .pipe(Effect.map((result) => result.code === 0));

  const resolveGitCheckpointCommit = (
    cwd: string,
    checkpointRef: CheckpointRef,
  ): Effect.Effect<string | null, GitCommandError> =>
    git
      .execute({
        operation: "CheckpointStore.resolveGitCheckpointCommit",
        cwd,
        args: ["rev-parse", "--verify", "--quiet", `${checkpointRef}^{commit}`],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => {
          if (result.code !== 0) {
            return null;
          }
          const commit = result.stdout.trim();
          return commit.length > 0 ? commit : null;
        }),
      );

  const isGitWorkspace = (cwd: string): Effect.Effect<boolean, never> =>
    git
      .execute({
        operation: "CheckpointStore.isGitWorkspace",
        cwd,
        args: ["rev-parse", "--is-inside-work-tree"],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => result.code === 0 && result.stdout.trim() === "true"),
        Effect.catch(() => Effect.succeed(false)),
      );

  const runJj = (input: {
    readonly operation: string;
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly allowNonZeroExit?: boolean;
  }) =>
    Effect.tryPromise({
      try: () =>
        runProcess("jj", input.args, {
          cwd: input.cwd,
          timeoutMs: JJ_COMMAND_TIMEOUT_MS,
          allowNonZeroExit: input.allowNonZeroExit ?? false,
        }),
      catch: (cause) =>
        toCheckpointInvariantError(
          input.operation,
          `Failed to run jj ${input.args.join(" ")}.`,
          cause,
        ),
    });

  const resolveJjWorkspaceRoot = (cwd: string): Effect.Effect<string | null, never> =>
    runJj({
      operation: "CheckpointStore.resolveJjWorkspaceRoot",
      cwd,
      args: ["--ignore-working-copy", "workspace", "root"],
      allowNonZeroExit: true,
    }).pipe(
      Effect.map((result) => {
        if (result.code !== 0) {
          return null;
        }
        const workspaceRoot = result.stdout.trim();
        return workspaceRoot.length > 0 ? workspaceRoot : null;
      }),
      Effect.catch(() => Effect.succeed(null)),
    );

  const resolveJjBackend = (cwd: string): Effect.Effect<CheckpointBackend | null, never> =>
    resolveJjWorkspaceRoot(cwd).pipe(
      Effect.map((workspaceRoot) =>
        workspaceRoot
          ? {
              kind: "jj" as const,
              workspaceRoot,
              metadataDir: path.join(workspaceRoot, ".jj", "repo", JJ_METADATA_DIRNAME),
            }
          : null,
      ),
    );

  const resolveBackend = (
    cwd: string,
  ): Effect.Effect<CheckpointBackend | null, CheckpointInvariantError> =>
    Effect.gen(function* () {
      const preference = yield* resolveConfiguredTurnReviewPreference;
      return yield* resolveBackendForPreference(cwd, preference);
    });

  const resolveBackendForPreference = (
    cwd: string,
    preference: TurnReviewVcsPreference,
  ): Effect.Effect<CheckpointBackend | null, never> =>
    Effect.gen(function* () {
      if (preference === "git") {
        return (yield* isGitWorkspace(cwd)) ? ({ kind: "git" } as const) : null;
      }

      if (preference === "jj") {
        return yield* resolveJjBackend(cwd);
      }

      if (yield* isGitWorkspace(cwd)) {
        return { kind: "git" } as const;
      }

      return yield* resolveJjBackend(cwd);
    });

  const resolveBackendOrFail = (
    cwd: string,
    operation: string,
  ): Effect.Effect<CheckpointBackend, CheckpointInvariantError> =>
    resolveBackend(cwd).pipe(
      Effect.flatMap((backend) =>
        backend
          ? Effect.succeed(backend)
          : Effect.fail(
              toCheckpointInvariantError(operation, TURN_REVIEW_BACKEND_UNAVAILABLE_DETAIL),
            ),
      ),
    );

  const checkpointMetadataFilePath = (metadataDir: string, checkpointRef: CheckpointRef) =>
    path.join(metadataDir, `${Buffer.from(checkpointRef, "utf8").toString("base64url")}.json`);

  const parseJjCheckpointMetadata = (
    raw: string,
    checkpointRef: CheckpointRef,
  ): Effect.Effect<JjCheckpointMetadata, CheckpointInvariantError> =>
    Effect.try({
      try: () => JSON.parse(raw) as Record<string, unknown>,
      catch: (cause) =>
        toCheckpointInvariantError(
          "CheckpointStore.parseJjCheckpointMetadata",
          `Checkpoint metadata for '${checkpointRef}' is invalid JSON.`,
          cause,
        ),
    }).pipe(
      Effect.flatMap((decoded) => {
        if (
          decoded.backend === "jj" &&
          typeof decoded.opId === "string" &&
          decoded.opId.length > 0 &&
          typeof decoded.commitId === "string" &&
          decoded.commitId.length > 0
        ) {
          return Effect.succeed({
            backend: "jj",
            opId: decoded.opId,
            commitId: decoded.commitId,
          } satisfies JjCheckpointMetadata);
        }
        return Effect.fail(
          toCheckpointInvariantError(
            "CheckpointStore.parseJjCheckpointMetadata",
            `Checkpoint metadata for '${checkpointRef}' is missing required fields.`,
          ),
        );
      }),
    );

  const readJjCheckpointMetadata = (
    backend: Extract<CheckpointBackend, { kind: "jj" }>,
    checkpointRef: CheckpointRef,
  ): Effect.Effect<JjCheckpointMetadata | null, CheckpointInvariantError> =>
    Effect.gen(function* () {
      const metadataPath = checkpointMetadataFilePath(backend.metadataDir, checkpointRef);
      const exists = yield* fs
        .exists(metadataPath)
        .pipe(
          Effect.mapError((error) =>
            toCheckpointInvariantError(
              "CheckpointStore.readJjCheckpointMetadata",
              `Failed to check checkpoint metadata for '${checkpointRef}'.`,
              error,
            ),
          ),
        );
      if (!exists) {
        return null;
      }
      const raw = yield* fs
        .readFileString(metadataPath)
        .pipe(
          Effect.mapError((error) =>
            toCheckpointInvariantError(
              "CheckpointStore.readJjCheckpointMetadata",
              `Failed to read checkpoint metadata for '${checkpointRef}'.`,
              error,
            ),
          ),
        );
      return yield* parseJjCheckpointMetadata(raw, checkpointRef);
    });

  const resolveCurrentJjOperationId = (
    cwd: string,
  ): Effect.Effect<string, CheckpointInvariantError> =>
    runJj({
      operation: "CheckpointStore.resolveCurrentJjOperationId",
      cwd,
      args: ["op", "log", "-n", "1", "--no-graph", "-T", 'id ++ "\\n"'],
    }).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((opId) =>
        opId.length > 0
          ? Effect.succeed(opId)
          : Effect.fail(
              toCheckpointInvariantError(
                "CheckpointStore.resolveCurrentJjOperationId",
                "jj op log returned an empty operation id.",
              ),
            ),
      ),
    );

  const resolveJjCommitId = (input: {
    readonly cwd: string;
    readonly opId?: string;
  }): Effect.Effect<string | null, CheckpointInvariantError> => {
    const args = input.opId
      ? [
          "--ignore-working-copy",
          "--at-op",
          input.opId,
          "log",
          "-r",
          "@",
          "--no-graph",
          "-T",
          'commit_id ++ "\\n"',
        ]
      : ["--ignore-working-copy", "log", "-r", "@", "--no-graph", "-T", 'commit_id ++ "\\n"'];

    return runJj({
      operation: "CheckpointStore.resolveJjCommitId",
      cwd: input.cwd,
      args,
      allowNonZeroExit: true,
    }).pipe(
      Effect.map((result) => {
        if (result.code !== 0) {
          return null;
        }
        const commitId = result.stdout.trim();
        return commitId.length > 0 ? commitId : null;
      }),
    );
  };

  const supportsCheckpoints: CheckpointStoreShape["supportsCheckpoints"] = (cwd) =>
    resolveBackend(cwd).pipe(
      Effect.map((backend) => backend !== null),
      Effect.catch(() => Effect.succeed(false)),
    );

  const captureCheckpoint: CheckpointStoreShape["captureCheckpoint"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.captureCheckpoint";
      const backend = yield* resolveBackendOrFail(input.cwd, operation);

      if (backend.kind === "git") {
        yield* Effect.acquireUseRelease(
          fs.makeTempDirectory({ prefix: "t3-fs-checkpoint-" }),
          (tempDir) =>
            Effect.gen(function* () {
              const tempIndexPath = path.join(tempDir, `index-${randomUUID()}`);
              const commitEnv: NodeJS.ProcessEnv = {
                ...process.env,
                GIT_INDEX_FILE: tempIndexPath,
                GIT_AUTHOR_NAME: "T3 Code",
                GIT_AUTHOR_EMAIL: "t3code@users.noreply.github.com",
                GIT_COMMITTER_NAME: "T3 Code",
                GIT_COMMITTER_EMAIL: "t3code@users.noreply.github.com",
              };

              const headExists = yield* hasHeadCommit(input.cwd);
              if (headExists) {
                yield* git.execute({
                  operation,
                  cwd: input.cwd,
                  args: ["read-tree", "HEAD"],
                  env: commitEnv,
                });
              }

              yield* git.execute({
                operation,
                cwd: input.cwd,
                args: ["add", "-A", "--", "."],
                env: commitEnv,
              });

              const writeTreeResult = yield* git.execute({
                operation,
                cwd: input.cwd,
                args: ["write-tree"],
                env: commitEnv,
              });
              const treeOid = writeTreeResult.stdout.trim();
              if (treeOid.length === 0) {
                return yield* new GitCommandError({
                  operation,
                  command: "git write-tree",
                  cwd: input.cwd,
                  detail: "git write-tree returned an empty tree oid.",
                });
              }

              const message = `t3 checkpoint ref=${input.checkpointRef}`;
              const commitTreeResult = yield* git.execute({
                operation,
                cwd: input.cwd,
                args: ["commit-tree", treeOid, "-m", message],
                env: commitEnv,
              });
              const commitOid = commitTreeResult.stdout.trim();
              if (commitOid.length === 0) {
                return yield* new GitCommandError({
                  operation,
                  command: "git commit-tree",
                  cwd: input.cwd,
                  detail: "git commit-tree returned an empty commit oid.",
                });
              }

              yield* git.execute({
                operation,
                cwd: input.cwd,
                args: ["update-ref", input.checkpointRef, commitOid],
              });
            }),
          (tempDir) => fs.remove(tempDir, { recursive: true }),
        ).pipe(
          Effect.catchTags({
            PlatformError: (error) =>
              Effect.fail(
                toCheckpointInvariantError(operation, "Failed to capture checkpoint.", error),
              ),
          }),
        );
        return;
      }

      const opId = yield* resolveCurrentJjOperationId(input.cwd);
      const commitId = yield* resolveJjCommitId({ cwd: input.cwd, opId }).pipe(
        Effect.flatMap((resolvedCommitId) =>
          resolvedCommitId
            ? Effect.succeed(resolvedCommitId)
            : Effect.fail(
                toCheckpointInvariantError(
                  operation,
                  "Failed to resolve the current Jujutsu working-copy commit.",
                ),
              ),
        ),
      );
      const metadataPath = checkpointMetadataFilePath(backend.metadataDir, input.checkpointRef);

      yield* fs
        .makeDirectory(backend.metadataDir, { recursive: true })
        .pipe(
          Effect.mapError((error) =>
            toCheckpointInvariantError(
              operation,
              "Failed to create checkpoint metadata directory.",
              error,
            ),
          ),
        );
      yield* fs
        .writeFileString(
          metadataPath,
          `${JSON.stringify({ backend: "jj", opId, commitId } satisfies JjCheckpointMetadata)}\n`,
        )
        .pipe(
          Effect.mapError((error) =>
            toCheckpointInvariantError(operation, "Failed to persist checkpoint metadata.", error),
          ),
        );
    });

  const hasCheckpointRef: CheckpointStoreShape["hasCheckpointRef"] = (input) =>
    Effect.gen(function* () {
      const backend = yield* resolveBackendOrFail(input.cwd, "CheckpointStore.hasCheckpointRef");
      if (backend.kind === "git") {
        return yield* resolveGitCheckpointCommit(input.cwd, input.checkpointRef).pipe(
          Effect.map((commit) => commit !== null),
        );
      }

      const metadata = yield* readJjCheckpointMetadata(backend, input.checkpointRef);
      if (!metadata) {
        return false;
      }

      const commitId = yield* runJj({
        operation: "CheckpointStore.hasCheckpointRef",
        cwd: input.cwd,
        args: [
          "--ignore-working-copy",
          "log",
          "-r",
          metadata.commitId,
          "--no-graph",
          "-T",
          'commit_id ++ "\\n"',
        ],
        allowNonZeroExit: true,
      }).pipe(Effect.map((result) => (result.code === 0 ? result.stdout.trim() : "")));
      return commitId.length > 0;
    });

  const restoreCheckpoint: CheckpointStoreShape["restoreCheckpoint"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.restoreCheckpoint";
      const backend = yield* resolveBackendOrFail(input.cwd, operation);

      if (backend.kind === "git") {
        let commitOid = yield* resolveGitCheckpointCommit(input.cwd, input.checkpointRef);

        if (!commitOid && input.fallbackToHead === true) {
          commitOid = yield* resolveHeadCommit(input.cwd);
        }

        if (!commitOid) {
          return false;
        }

        yield* git.execute({
          operation,
          cwd: input.cwd,
          args: ["restore", "--source", commitOid, "--worktree", "--staged", "--", "."],
        });
        yield* git.execute({
          operation,
          cwd: input.cwd,
          args: ["clean", "-fd", "--", "."],
        });

        const headExists = yield* hasHeadCommit(input.cwd);
        if (headExists) {
          yield* git.execute({
            operation,
            cwd: input.cwd,
            args: ["reset", "--quiet", "--", "."],
          });
        }

        return true;
      }

      const metadata = yield* readJjCheckpointMetadata(backend, input.checkpointRef);
      let commitId = metadata?.commitId ?? null;

      if (!commitId && input.fallbackToHead === true) {
        commitId = yield* resolveJjCommitId({ cwd: input.cwd });
      }

      if (!commitId) {
        return false;
      }

      yield* runJj({
        operation,
        cwd: input.cwd,
        args: ["restore", "--from", commitId],
      });

      return true;
    });

  const diffCheckpoints: CheckpointStoreShape["diffCheckpoints"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.diffCheckpoints";
      const backend = yield* resolveBackendOrFail(input.cwd, operation);

      if (backend.kind === "git") {
        let fromCommitOid = yield* resolveGitCheckpointCommit(input.cwd, input.fromCheckpointRef);
        const toCommitOid = yield* resolveGitCheckpointCommit(input.cwd, input.toCheckpointRef);

        if (!fromCommitOid && input.fallbackFromToHead === true) {
          const headCommit = yield* resolveHeadCommit(input.cwd);
          if (headCommit) {
            fromCommitOid = headCommit;
          }
        }

        if (!fromCommitOid || !toCommitOid) {
          return yield* new GitCommandError({
            operation,
            command: "git diff",
            cwd: input.cwd,
            detail: "Checkpoint ref is unavailable for diff operation.",
          });
        }

        const result = yield* git.execute({
          operation,
          cwd: input.cwd,
          args: [
            "diff",
            "--patch",
            "--minimal",
            "--no-color",
            fromCommitOid,
            toCommitOid,
            "--",
            ...GIT_DIFF_EXCLUDED_PATHS,
          ],
          maxOutputBytes: CHECKPOINT_DIFF_MAX_OUTPUT_BYTES,
        });

        return result.stdout;
      }

      let fromCommitId =
        (yield* readJjCheckpointMetadata(backend, input.fromCheckpointRef))?.commitId ?? null;
      const toCommitId =
        (yield* readJjCheckpointMetadata(backend, input.toCheckpointRef))?.commitId ?? null;

      if (!fromCommitId && input.fallbackFromToHead === true) {
        fromCommitId = yield* resolveJjCommitId({ cwd: input.cwd });
      }

      if (!fromCommitId || !toCommitId) {
        return yield* toCheckpointInvariantError(
          operation,
          "Checkpoint ref is unavailable for diff operation.",
        );
      }

      const result = yield* runJj({
        operation,
        cwd: input.cwd,
        args: [
          "--ignore-working-copy",
          "diff",
          "--git",
          "--from",
          fromCommitId,
          "--to",
          toCommitId,
          JJ_DIFF_EXCLUDED_FILESET,
        ],
      });

      return result.stdout;
    });

  const deleteCheckpointRefs: CheckpointStoreShape["deleteCheckpointRefs"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointStore.deleteCheckpointRefs";
      const backend = yield* resolveBackendOrFail(input.cwd, operation);

      if (backend.kind === "git") {
        yield* Effect.forEach(
          input.checkpointRefs,
          (checkpointRef) =>
            git.execute({
              operation,
              cwd: input.cwd,
              args: ["update-ref", "-d", checkpointRef],
              allowNonZeroExit: true,
            }),
          { discard: true },
        );
        return;
      }

      yield* Effect.forEach(
        input.checkpointRefs,
        (checkpointRef) =>
          fs
            .remove(checkpointMetadataFilePath(backend.metadataDir, checkpointRef), { force: true })
            .pipe(
              Effect.mapError((error) =>
                toCheckpointInvariantError(
                  operation,
                  `Failed to delete checkpoint metadata for '${checkpointRef}'.`,
                  error,
                ),
              ),
            ),
        { discard: true },
      );
    });

  return {
    supportsCheckpoints,
    captureCheckpoint,
    hasCheckpointRef,
    restoreCheckpoint,
    diffCheckpoints,
    deleteCheckpointRefs,
  } satisfies CheckpointStoreShape;
});

export const CheckpointStoreLive = Layer.effect(CheckpointStore, makeCheckpointStore);
