import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import {
  PROJECT_READ_FILE_DEFAULT_MAX_BYTES,
  type ProjectListDirectoryInput,
  type ProjectListDirectoryResult,
  type ProjectReadFileInput,
  type ProjectReadFileResult,
} from "@t3tools/contracts";

import { isPathInIgnoredDirectory } from "./workspaceIgnore";

function toPosixRelativePath(input: string): string {
  return input.replaceAll("\\", "/");
}

function normalizeWorkspaceRelativePath(input: string | undefined): string {
  return (input ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
}

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const normalized = normalizeWorkspaceRelativePath(relativePath);
  const resolved = path.resolve(workspaceRoot, normalized);
  const relativeToRoot = toPosixRelativePath(path.relative(workspaceRoot, resolved));

  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith("../") ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error("Workspace file path must stay within the project root.");
  }

  return resolved;
}

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return undefined;
  }
  return input.slice(0, separatorIndex);
}

function compareDirectoryEntries(left: Dirent, right: Dirent): number {
  const leftKind = left.isDirectory() ? 0 : 1;
  const rightKind = right.isDirectory() ? 0 : 1;
  if (leftKind !== rightKind) {
    return leftKind - rightKind;
  }
  return left.name.localeCompare(right.name);
}

function isLikelyBinaryContent(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, 8_192);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }
  return false;
}

export async function listWorkspaceDirectory(
  input: ProjectListDirectoryInput,
): Promise<ProjectListDirectoryResult> {
  const relativePath = normalizeWorkspaceRelativePath(input.relativePath);
  const absolutePath = resolveWorkspacePath(input.cwd, relativePath);
  const stats = await fs.stat(absolutePath);
  if (!stats.isDirectory()) {
    throw new Error("Workspace path is not a directory.");
  }

  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  return {
    relativePath,
    entries: entries
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .filter((entry) => {
        const entryPath = relativePath.length > 0 ? `${relativePath}/${entry.name}` : entry.name;
        return !isPathInIgnoredDirectory(entryPath);
      })
      .toSorted(compareDirectoryEntries)
      .map((entry) => {
        const entryPath = relativePath.length > 0 ? `${relativePath}/${entry.name}` : entry.name;
        const nextEntry = {
          path: entryPath,
          kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
        };
        const parentPath = parentPathOf(entryPath);
        if (parentPath) {
          return Object.assign(nextEntry, { parentPath });
        }
        return nextEntry;
      }),
  };
}

export async function readWorkspaceFile(
  input: ProjectReadFileInput,
): Promise<ProjectReadFileResult> {
  const absolutePath = resolveWorkspacePath(input.cwd, input.relativePath);
  const stats = await fs.stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error("Workspace path is not a file.");
  }

  const buffer = await fs.readFile(absolutePath);
  const byteLength = buffer.byteLength;
  const tooLarge = byteLength > PROJECT_READ_FILE_DEFAULT_MAX_BYTES;
  const binary = isLikelyBinaryContent(buffer);

  return {
    relativePath: normalizeWorkspaceRelativePath(input.relativePath),
    contents: tooLarge || binary ? "" : buffer.toString("utf8"),
    binary,
    tooLarge,
    byteLength,
    maxBytes: PROJECT_READ_FILE_DEFAULT_MAX_BYTES,
    mtimeMs: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null,
  };
}
