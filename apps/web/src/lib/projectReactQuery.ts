import type {
  ProjectGetDiagnosticsResult,
  ProjectEntry,
  ProjectGetLspStatusResult,
  ProjectListDirectoryResult,
  ProjectReadFileResult,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  listDirectory: (cwd: string | null, relativePath: string) =>
    ["projects", "list-directory", cwd, relativePath] as const,
  workspaceFileTree: (cwd: string | null) => ["projects", "workspace-file-tree", cwd] as const,
  readFile: (cwd: string | null, relativePath: string) =>
    ["projects", "read-file", cwd, relativePath] as const,
  diagnostics: (cwd: string | null, relativePath: string | null) =>
    ["projects", "diagnostics", cwd, relativePath] as const,
  lspStatus: (cwd: string | null) => ["projects", "lsp-status", cwd] as const,
  searchEntries: (cwd: string | null, query: string, limit: number) =>
    ["projects", "search-entries", cwd, query, limit] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const DEFAULT_FILE_READ_STALE_TIME = 5_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
const EMPTY_DIRECTORY_RESULT: ProjectListDirectoryResult = {
  relativePath: "",
  entries: [],
};
const EMPTY_WORKSPACE_FILE_TREE_RESULT: { entries: ProjectEntry[] } = {
  entries: [],
};
const EMPTY_FILE_RESULT: ProjectReadFileResult = {
  relativePath: "",
  contents: "",
  binary: false,
  tooLarge: false,
  byteLength: 0,
  maxBytes: 0,
  mtimeMs: null,
};
const EMPTY_DIAGNOSTICS_RESULT: ProjectGetDiagnosticsResult = {
  diagnostics: [],
  truncated: false,
  updatedAt: "",
};
const EMPTY_LSP_STATUS_RESULT: ProjectGetLspStatusResult = {
  state: "unavailable",
  availableServers: [],
};

export function projectSearchEntriesQueryOptions(input: {
  cwd: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.cwd, input.query, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace entry search is unavailable.");
      }
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.query.length > 0,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}

export function projectListDirectoryQueryOptions(input: {
  cwd: string | null;
  relativePath?: string;
  enabled?: boolean;
}) {
  const relativePath = input.relativePath?.trim() ?? "";
  return queryOptions({
    queryKey: projectQueryKeys.listDirectory(input.cwd, relativePath),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace directory listing is unavailable.");
      }
      return api.projects.listDirectory({
        cwd: input.cwd,
        ...(relativePath.length > 0 ? { relativePath } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_DIRECTORY_RESULT,
  });
}

export function projectWorkspaceFileTreeQueryOptions(input: {
  cwd: string | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.workspaceFileTree(input.cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace file tree is unavailable.");
      }

      const pendingDirectories = [""];
      const visitedDirectories = new Set(pendingDirectories);
      const fileEntries: ProjectEntry[] = [];

      while (pendingDirectories.length > 0) {
        const relativePath = pendingDirectories.shift() ?? "";
        const result = await api.projects.listDirectory({
          cwd: input.cwd,
          ...(relativePath.length > 0 ? { relativePath } : {}),
        });

        for (const entry of result.entries) {
          if (entry.kind === "directory") {
            if (!visitedDirectories.has(entry.path)) {
              visitedDirectories.add(entry.path);
              pendingDirectories.push(entry.path);
            }
            continue;
          }
          fileEntries.push(entry);
        }
      }

      fileEntries.sort((left, right) =>
        left.path.localeCompare(right.path, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );

      return { entries: fileEntries };
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_WORKSPACE_FILE_TREE_RESULT,
  });
}

export function projectReadFileQueryOptions(input: {
  cwd: string | null;
  relativePath: string;
  enabled?: boolean;
}) {
  const relativePath = input.relativePath.trim();
  return queryOptions({
    queryKey: projectQueryKeys.readFile(input.cwd, relativePath),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace file reading is unavailable.");
      }
      return api.projects.readFile({
        cwd: input.cwd,
        relativePath,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && relativePath.length > 0,
    staleTime: DEFAULT_FILE_READ_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_FILE_RESULT,
  });
}

export function projectDiagnosticsQueryOptions(input: {
  cwd: string | null;
  relativePath?: string | null;
  enabled?: boolean;
}) {
  const relativePath = input.relativePath?.trim() ?? null;
  return queryOptions({
    queryKey: projectQueryKeys.diagnostics(input.cwd, relativePath),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace diagnostics are unavailable.");
      }
      return api.projects.getDiagnostics({
        cwd: input.cwd,
        ...(relativePath && relativePath.length > 0 ? { relativePath } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: DEFAULT_FILE_READ_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_DIAGNOSTICS_RESULT,
  });
}

export function projectLspStatusQueryOptions(input: {
  cwd: string | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.lspStatus(input.cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace language server status is unavailable.");
      }
      return api.projects.getLspStatus({
        cwd: input.cwd,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: input.staleTime ?? DEFAULT_FILE_READ_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_LSP_STATUS_RESULT,
  });
}
