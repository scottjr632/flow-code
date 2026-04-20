import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useMemo, useRef } from "react";

import {
  WORKSPACE_CODE_FONT_SIZE_PX,
  WORKSPACE_CODE_LINE_HEIGHT_PX,
} from "../lib/workspaceCodeTypography";

function languageForPath(relativePath: string): string {
  const normalizedPath = relativePath.toLowerCase();
  if (normalizedPath.endsWith(".tsx")) return "typescript";
  if (
    normalizedPath.endsWith(".ts") ||
    normalizedPath.endsWith(".mts") ||
    normalizedPath.endsWith(".cts")
  ) {
    return "typescript";
  }
  if (normalizedPath.endsWith(".jsx")) return "javascript";
  if (
    normalizedPath.endsWith(".js") ||
    normalizedPath.endsWith(".mjs") ||
    normalizedPath.endsWith(".cjs")
  ) {
    return "javascript";
  }
  if (normalizedPath.endsWith(".json")) return "json";
  if (normalizedPath.endsWith(".md") || normalizedPath.endsWith(".mdx")) return "markdown";
  if (normalizedPath.endsWith(".css")) return "css";
  if (
    normalizedPath.endsWith(".html") ||
    normalizedPath.endsWith(".htm") ||
    normalizedPath.endsWith(".astro")
  ) {
    return "html";
  }
  if (normalizedPath.endsWith(".yml") || normalizedPath.endsWith(".yaml")) return "yaml";
  return "plaintext";
}

function monacoPath(relativePath: string): string {
  return `inmemory://workspace/${relativePath.replace(/^\/+/, "")}`;
}

export function WorkspaceMonacoEditor(props: {
  relativePath: string;
  value: string;
  readOnly?: boolean;
  resolvedTheme: "light" | "dark";
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const {
    autoFocus = false,
    onChange,
    onSave,
    readOnly = false,
    relativePath,
    resolvedTheme,
    value,
  } = props;
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const latestOnSaveRef = useRef(onSave);
  const latestOnChangeRef = useRef(onChange);

  latestOnSaveRef.current = onSave;
  latestOnChangeRef.current = onChange;

  const language = useMemo(() => languageForPath(relativePath), [relativePath]);
  const path = useMemo(() => monacoPath(relativePath), [relativePath]);

  const handleMount = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor, monaco: typeof import("monaco-editor")) => {
      editorRef.current = editorInstance;
      editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        latestOnSaveRef.current();
      });
      if (autoFocus) {
        editorInstance.focus();
      }
    },
    [autoFocus],
  );

  return (
    <Editor
      height="100%"
      width="100%"
      path={path}
      language={language}
      value={value}
      theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
      loading={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground/60">
          Loading editor…
        </div>
      }
      options={{
        automaticLayout: true,
        fontSize: WORKSPACE_CODE_FONT_SIZE_PX,
        lineHeight: WORKSPACE_CODE_LINE_HEIGHT_PX,
        minimap: { enabled: false },
        padding: { top: 8, bottom: 8 },
        readOnly,
        renderLineHighlight: "all",
        roundedSelection: false,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 2,
      }}
      onMount={handleMount}
      onChange={(nextValue) => {
        latestOnChangeRef.current(nextValue ?? "");
      }}
    />
  );
}
