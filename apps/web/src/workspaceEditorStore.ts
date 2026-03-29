import { type ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

type WorkspaceEditorBufferStatus = "idle" | "loading" | "ready" | "saving" | "error";

interface WorkspaceEditorBuffer {
  relativePath: string;
  contents: string;
  savedContents: string;
  status: WorkspaceEditorBufferStatus;
  error: string | null;
  binary: boolean;
  tooLarge: boolean;
  byteLength: number;
  maxBytes: number;
  mtimeMs: number | null;
}

interface ThreadWorkspaceEditorState {
  openFilePaths: string[];
  buffersByPath: Record<string, WorkspaceEditorBuffer>;
  expandedDirectoryPaths: string[];
  explorerOpen: boolean;
  problemsOpen: boolean;
  vimMode: boolean;
}

interface WorkspaceEditorStoreState {
  editorsByThreadId: Record<string, ThreadWorkspaceEditorState>;
  openFile: (threadId: ThreadId, relativePath: string) => void;
  closeFile: (threadId: ThreadId, relativePath: string) => void;
  setBufferState: (
    threadId: ThreadId,
    relativePath: string,
    updater: (existing: WorkspaceEditorBuffer | null) => WorkspaceEditorBuffer,
  ) => void;
  setBufferContents: (threadId: ThreadId, relativePath: string, contents: string) => void;
  markBufferSaved: (
    threadId: ThreadId,
    relativePath: string,
    input: { contents: string; mtimeMs: number | null },
  ) => void;
  toggleDirectoryExpanded: (threadId: ThreadId, relativePath: string) => void;
  ensureDirectoriesExpanded: (threadId: ThreadId, relativePaths: readonly string[]) => void;
  setExplorerOpen: (threadId: ThreadId, open: boolean) => void;
  setProblemsOpen: (threadId: ThreadId, open: boolean) => void;
  setVimMode: (threadId: ThreadId, enabled: boolean) => void;
}

export const WORKSPACE_EDITOR_VIM_MODE_KEY = "t3code:workspace-editor-vim-mode";

export function readPersistedWorkspaceEditorVimMode(): boolean {
  return getLocalStorageItem(WORKSPACE_EDITOR_VIM_MODE_KEY, Schema.Boolean) ?? false;
}

function createInitialThreadWorkspaceEditorState(): ThreadWorkspaceEditorState {
  return {
    openFilePaths: [],
    buffersByPath: {},
    expandedDirectoryPaths: [],
    explorerOpen: true,
    problemsOpen: true,
    vimMode: readPersistedWorkspaceEditorVimMode(),
  };
}

const INITIAL_THREAD_WORKSPACE_EDITOR_STATE: ThreadWorkspaceEditorState = {
  openFilePaths: [],
  buffersByPath: {},
  expandedDirectoryPaths: [],
  explorerOpen: true,
  problemsOpen: true,
  vimMode: false,
};

function normalizeRelativePath(input: string): string {
  return input
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
}

function ensureThreadState(
  editorsByThreadId: Record<string, ThreadWorkspaceEditorState>,
  threadId: ThreadId,
): ThreadWorkspaceEditorState {
  return editorsByThreadId[threadId] ?? createInitialThreadWorkspaceEditorState();
}

export const useWorkspaceEditorStore = create<WorkspaceEditorStoreState>()((set) => ({
  editorsByThreadId: {},
  openFile: (threadId, relativePath) =>
    set((state) => {
      const normalizedPath = normalizeRelativePath(relativePath);
      if (normalizedPath.length === 0) {
        return state;
      }
      const threadState = ensureThreadState(state.editorsByThreadId, threadId);
      if (threadState.openFilePaths.includes(normalizedPath)) {
        return state;
      }
      return {
        editorsByThreadId: {
          ...state.editorsByThreadId,
          [threadId]: {
            ...threadState,
            openFilePaths: [...threadState.openFilePaths, normalizedPath],
          },
        },
      };
    }),
  closeFile: (threadId, relativePath) =>
    set((state) => {
      const normalizedPath = normalizeRelativePath(relativePath);
      const threadState = ensureThreadState(state.editorsByThreadId, threadId);
      if (!threadState.openFilePaths.includes(normalizedPath)) {
        return state;
      }

      const nextBuffersByPath = { ...threadState.buffersByPath };
      delete nextBuffersByPath[normalizedPath];

      return {
        editorsByThreadId: {
          ...state.editorsByThreadId,
          [threadId]: {
            ...threadState,
            openFilePaths: threadState.openFilePaths.filter((entry) => entry !== normalizedPath),
            buffersByPath: nextBuffersByPath,
          },
        },
      };
    }),
  setBufferState: (threadId, relativePath, updater) =>
    set((state) => {
      const normalizedPath = normalizeRelativePath(relativePath);
      if (normalizedPath.length === 0) {
        return state;
      }
      const threadState = ensureThreadState(state.editorsByThreadId, threadId);
      return {
        editorsByThreadId: {
          ...state.editorsByThreadId,
          [threadId]: {
            ...threadState,
            openFilePaths: threadState.openFilePaths.includes(normalizedPath)
              ? threadState.openFilePaths
              : [...threadState.openFilePaths, normalizedPath],
            buffersByPath: {
              ...threadState.buffersByPath,
              [normalizedPath]: updater(threadState.buffersByPath[normalizedPath] ?? null),
            },
          },
        },
      };
    }),
  setBufferContents: (threadId, relativePath, contents) =>
    set((state) => {
      const normalizedPath = normalizeRelativePath(relativePath);
      const threadState = ensureThreadState(state.editorsByThreadId, threadId);
      const existingBuffer = threadState.buffersByPath[normalizedPath];
      if (!existingBuffer || existingBuffer.contents === contents) {
        return state;
      }
      return {
        editorsByThreadId: {
          ...state.editorsByThreadId,
          [threadId]: {
            ...threadState,
            buffersByPath: {
              ...threadState.buffersByPath,
              [normalizedPath]: {
                ...existingBuffer,
                contents,
              },
            },
          },
        },
      };
    }),
  markBufferSaved: (threadId, relativePath, input) =>
    set((state) => {
      const normalizedPath = normalizeRelativePath(relativePath);
      const threadState = ensureThreadState(state.editorsByThreadId, threadId);
      const existingBuffer = threadState.buffersByPath[normalizedPath];
      if (!existingBuffer) {
        return state;
      }
      return {
        editorsByThreadId: {
          ...state.editorsByThreadId,
          [threadId]: {
            ...threadState,
            buffersByPath: {
              ...threadState.buffersByPath,
              [normalizedPath]: {
                ...existingBuffer,
                contents: input.contents,
                savedContents: input.contents,
                status: "ready",
                error: null,
                mtimeMs: input.mtimeMs,
              },
            },
          },
        },
      };
    }),
  toggleDirectoryExpanded: (threadId, relativePath) =>
    set((state) => {
      const normalizedPath = normalizeRelativePath(relativePath);
      const threadState = ensureThreadState(state.editorsByThreadId, threadId);
      const expanded = threadState.expandedDirectoryPaths.includes(normalizedPath);
      return {
        editorsByThreadId: {
          ...state.editorsByThreadId,
          [threadId]: {
            ...threadState,
            expandedDirectoryPaths: expanded
              ? threadState.expandedDirectoryPaths.filter((entry) => entry !== normalizedPath)
              : [...threadState.expandedDirectoryPaths, normalizedPath],
          },
        },
      };
    }),
  ensureDirectoriesExpanded: (threadId, relativePaths) =>
    set((state) => {
      const threadState = ensureThreadState(state.editorsByThreadId, threadId);
      const nextExpandedDirectoryPaths = new Set(threadState.expandedDirectoryPaths);
      for (const relativePath of relativePaths) {
        const normalizedPath = normalizeRelativePath(relativePath);
        if (normalizedPath.length > 0) {
          nextExpandedDirectoryPaths.add(normalizedPath);
        }
      }
      return {
        editorsByThreadId: {
          ...state.editorsByThreadId,
          [threadId]: {
            ...threadState,
            expandedDirectoryPaths: [...nextExpandedDirectoryPaths],
          },
        },
      };
    }),
  setExplorerOpen: (threadId, open) =>
    set((state) => {
      const threadState = ensureThreadState(state.editorsByThreadId, threadId);
      if (threadState.explorerOpen === open) {
        return state;
      }
      return {
        editorsByThreadId: {
          ...state.editorsByThreadId,
          [threadId]: {
            ...threadState,
            explorerOpen: open,
          },
        },
      };
    }),
  setProblemsOpen: (threadId, open) =>
    set((state) => {
      const threadState = ensureThreadState(state.editorsByThreadId, threadId);
      if (threadState.problemsOpen === open) {
        return state;
      }
      return {
        editorsByThreadId: {
          ...state.editorsByThreadId,
          [threadId]: {
            ...threadState,
            problemsOpen: open,
          },
        },
      };
    }),
  setVimMode: (threadId, enabled) =>
    set((state) => {
      const threadState = ensureThreadState(state.editorsByThreadId, threadId);
      if (threadState.vimMode === enabled) {
        return state;
      }
      setLocalStorageItem(WORKSPACE_EDITOR_VIM_MODE_KEY, enabled, Schema.Boolean);
      return {
        editorsByThreadId: {
          ...state.editorsByThreadId,
          [threadId]: {
            ...threadState,
            vimMode: enabled,
          },
        },
      };
    }),
}));

export function useThreadWorkspaceEditorState(
  threadId: ThreadId | null,
): ThreadWorkspaceEditorState {
  return useWorkspaceEditorStore((state) =>
    threadId
      ? (state.editorsByThreadId[threadId] ?? INITIAL_THREAD_WORKSPACE_EDITOR_STATE)
      : INITIAL_THREAD_WORKSPACE_EDITOR_STATE,
  );
}

export function isBufferDirty(buffer: WorkspaceEditorBuffer | null | undefined): boolean {
  if (!buffer) {
    return false;
  }
  return buffer.contents !== buffer.savedContents;
}

export function directoryAncestorsOf(relativePath: string): string[] {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (normalizedPath.length === 0) {
    return [];
  }
  const segments = normalizedPath.split("/").filter((segment) => segment.length > 0);
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}
