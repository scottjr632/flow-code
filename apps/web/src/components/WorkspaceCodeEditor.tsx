import { basicSetup, EditorView } from "codemirror";
import { EditorState, type Extension } from "@codemirror/state";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import {
  forceLinting,
  lintGutter,
  linter,
  type Diagnostic as CodeMirrorDiagnostic,
} from "@codemirror/lint";
import { keymap } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import type { ProjectDiagnostic } from "@t3tools/contracts";
import { tags as t } from "@lezer/highlight";
import { useEffect, useMemo, useRef } from "react";

function extensionForPath(relativePath: string): Extension {
  const normalizedPath = relativePath.toLowerCase();
  if (normalizedPath.endsWith(".tsx")) {
    return javascript({ jsx: true, typescript: true });
  }
  if (
    normalizedPath.endsWith(".ts") ||
    normalizedPath.endsWith(".mts") ||
    normalizedPath.endsWith(".cts")
  ) {
    return javascript({ typescript: true });
  }
  if (normalizedPath.endsWith(".jsx")) {
    return javascript({ jsx: true });
  }
  if (
    normalizedPath.endsWith(".js") ||
    normalizedPath.endsWith(".mjs") ||
    normalizedPath.endsWith(".cjs")
  ) {
    return javascript();
  }
  if (normalizedPath.endsWith(".json")) {
    return json();
  }
  if (normalizedPath.endsWith(".md") || normalizedPath.endsWith(".mdx")) {
    return markdown();
  }
  if (normalizedPath.endsWith(".css")) {
    return css();
  }
  if (
    normalizedPath.endsWith(".html") ||
    normalizedPath.endsWith(".htm") ||
    normalizedPath.endsWith(".astro")
  ) {
    return html();
  }
  return [];
}

function offsetForDiagnostic(
  doc: EditorState["doc"],
  lineNumber: number,
  columnNumber: number,
): number {
  const line = Math.max(1, Math.min(lineNumber, doc.lines));
  const lineInfo = doc.line(line);
  const column = Math.max(1, columnNumber);
  return Math.min(lineInfo.from + column - 1, lineInfo.to);
}

function toCodeMirrorDiagnostics(
  doc: EditorState["doc"],
  diagnostics: readonly ProjectDiagnostic[],
): CodeMirrorDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    const from = offsetForDiagnostic(doc, diagnostic.startLine, diagnostic.startColumn);
    const to = Math.max(
      from + 1,
      offsetForDiagnostic(doc, diagnostic.endLine, diagnostic.endColumn),
    );
    return {
      from,
      to,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(diagnostic.source ? { source: diagnostic.source } : {}),
    };
  });
}

const editorTheme = (dark: boolean) =>
  EditorView.theme(
    {
      "&": {
        height: "100%",
        width: "100%",
        minHeight: "0",
        overflow: "hidden",
        backgroundColor: "color-mix(in srgb, var(--muted) 78%, var(--background))",
        color: "var(--foreground)",
        fontSize: "12px",
      },
      ".cm-scroller": {
        height: "100%",
        overflow: "auto",
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        lineHeight: "1.5",
      },
      ".cm-content": {
        padding: "4px 0",
        caretColor: "var(--foreground)",
      },
      ".cm-gutters": {
        backgroundColor: "color-mix(in srgb, var(--muted) 78%, var(--background))",
        color: "color-mix(in srgb, var(--muted-foreground) 80%, transparent)",
        borderRight: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
      },
      ".cm-activeLine, .cm-activeLineGutter": {
        backgroundColor: dark
          ? "color-mix(in srgb, var(--foreground) 4%, transparent)"
          : "color-mix(in srgb, var(--foreground) 3%, transparent)",
      },
      ".cm-selectionBackground, ::selection": {
        backgroundColor: dark
          ? "color-mix(in srgb, var(--primary) 34%, transparent)"
          : "color-mix(in srgb, var(--primary) 20%, transparent)",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--primary)",
      },
      ".cm-panels": {
        backgroundColor: "color-mix(in srgb, var(--muted) 50%, var(--background))",
        color: "var(--foreground)",
        borderBottom: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
        fontSize: "12px",
        padding: "4px 8px",
      },
      ".cm-panels input, .cm-panels button": {
        fontSize: "11px",
      },
      ".cm-panels input[type=text], .cm-panels input[type=search]": {
        backgroundColor: "var(--background)",
        border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
        borderRadius: "4px",
        color: "var(--foreground)",
        padding: "2px 6px",
        height: "22px",
        outline: "none",
      },
      ".cm-panels input[type=text]:focus, .cm-panels input[type=search]:focus": {
        borderColor: "var(--ring)",
        boxShadow: "0 0 0 1px color-mix(in srgb, var(--ring) 24%, transparent)",
      },
      ".cm-panels button": {
        backgroundColor: "transparent",
        border: "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
        borderRadius: "4px",
        color: "var(--muted-foreground)",
        cursor: "pointer",
        padding: "2px 8px",
        height: "22px",
        transition: "background-color 0.1s, color 0.1s",
      },
      ".cm-panels button:hover": {
        backgroundColor: "color-mix(in srgb, var(--accent) 60%, transparent)",
        color: "var(--foreground)",
      },
      ".cm-panels label": {
        fontSize: "11px",
        color: "var(--muted-foreground)",
      },
      ".cm-panels input[type=checkbox]": {
        accentColor: "var(--primary)",
      },
      ".cm-panel.cm-search": {
        padding: "4px 8px",
      },
      ".cm-panel.cm-search label": {
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
      },
      ".cm-searchMatch": {
        backgroundColor: dark
          ? "color-mix(in srgb, var(--primary) 18%, transparent)"
          : "color-mix(in srgb, var(--primary) 12%, transparent)",
        outline: "1px solid color-mix(in srgb, var(--primary) 45%, transparent)",
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: dark
          ? "color-mix(in srgb, var(--primary) 28%, transparent)"
          : "color-mix(in srgb, var(--primary) 18%, transparent)",
      },
      ".cm-tooltip, .cm-completionInfo, .cm-tooltip-autocomplete": {
        backgroundColor: "color-mix(in srgb, var(--card) 92%, var(--background))",
        color: "var(--foreground)",
        border: "1px solid var(--border)",
        boxShadow: dark ? "0 10px 30px rgba(0,0,0,0.22)" : "0 10px 30px rgba(15,23,42,0.08)",
      },
      ".cm-tooltip .cm-tooltip-arrow:before": {
        borderTopColor: "var(--border)",
        borderBottomColor: "var(--border)",
      },
      ".cm-tooltip .cm-tooltip-arrow:after": {
        borderTopColor: "color-mix(in srgb, var(--card) 92%, var(--background))",
        borderBottomColor: "color-mix(in srgb, var(--card) 92%, var(--background))",
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "color-mix(in srgb, var(--muted) 92%, var(--background))",
        border: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
        color: "var(--muted-foreground)",
      },
      ".cm-matchingBracket": {
        backgroundColor: dark
          ? "color-mix(in srgb, var(--primary) 14%, transparent)"
          : "color-mix(in srgb, var(--primary) 10%, transparent)",
        outline: "1px solid color-mix(in srgb, var(--primary) 36%, transparent)",
      },
    },
    { dark },
  );

function editorHighlightStyle(dark: boolean): Extension {
  const palette = dark
    ? {
        keyword: "#d39dff",
        type: "#8ad8ff",
        function: "#7fb0ff",
        string: "#8fd9a8",
        number: "#f5bf75",
        property: "#b9c7ff",
        comment: "var(--muted-foreground)",
        punctuation: "color-mix(in srgb, var(--muted-foreground) 82%, transparent)",
      }
    : {
        keyword: "#7c3aed",
        type: "#0f6ad9",
        function: "#2563eb",
        string: "#1f8a5b",
        number: "#b45309",
        property: "#475569",
        comment: "var(--muted-foreground)",
        punctuation: "color-mix(in srgb, var(--muted-foreground) 88%, transparent)",
      };

  return syntaxHighlighting(
    HighlightStyle.define([
      { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.modifier], color: palette.keyword },
      { tag: [t.typeName, t.className, t.namespace, t.macroName], color: palette.type },
      {
        tag: [
          t.function(t.variableName),
          t.function(t.propertyName),
          t.labelName,
          t.definition(t.variableName),
        ],
        color: palette.function,
      },
      {
        tag: [t.propertyName, t.attributeName, t.special(t.variableName)],
        color: palette.property,
      },
      { tag: [t.string, t.special(t.string), t.regexp, t.escape], color: palette.string },
      { tag: [t.number, t.integer, t.float, t.bool, t.null], color: palette.number },
      {
        tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
        color: palette.comment,
        fontStyle: "italic",
      },
      {
        tag: [t.punctuation, t.separator, t.bracket, t.squareBracket, t.paren],
        color: palette.punctuation,
      },
      { tag: [t.operator, t.derefOperator], color: palette.punctuation },
      { tag: [t.variableName, t.name, t.content], color: "var(--foreground)" },
      {
        tag: [t.heading, t.heading1, t.heading2, t.heading3],
        color: palette.keyword,
        fontWeight: "600",
      },
      { tag: [t.emphasis], fontStyle: "italic" },
      { tag: [t.strong], fontWeight: "700" },
      { tag: [t.link, t.url], color: palette.function, textDecoration: "underline" },
      { tag: [t.inserted], color: "color-mix(in srgb, var(--success) 82%, var(--foreground))" },
      { tag: [t.deleted], color: "color-mix(in srgb, var(--destructive) 88%, var(--foreground))" },
      { tag: [t.invalid], color: "var(--destructive)" },
    ]),
  );
}

export function WorkspaceCodeEditor(props: {
  relativePath: string;
  value: string;
  diagnostics: readonly ProjectDiagnostic[];
  readOnly?: boolean;
  vimMode?: boolean;
  resolvedTheme: "light" | "dark";
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latestValueRef = useRef(props.value);
  const diagnosticsRef = useRef<readonly ProjectDiagnostic[]>(props.diagnostics);
  const onChangeRef = useRef(props.onChange);
  const onSaveRef = useRef(props.onSave);
  const languageExtension = useMemo(
    () => extensionForPath(props.relativePath),
    [props.relativePath],
  );

  latestValueRef.current = props.value;
  diagnosticsRef.current = props.diagnostics;
  onChangeRef.current = props.onChange;
  onSaveRef.current = props.onSave;

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) {
      return;
    }

    const lintExtension = linter((view) =>
      toCodeMirrorDiagnostics(view.state.doc, diagnosticsRef.current),
    );
    const extensions: Extension[] = [
      basicSetup,
      lintGutter(),
      lintExtension,
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            onSaveRef.current();
            return true;
          },
        },
      ]),
      editorTheme(props.resolvedTheme === "dark"),
      editorHighlightStyle(props.resolvedTheme === "dark"),
      EditorState.readOnly.of(Boolean(props.readOnly)),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) {
          return;
        }
        const nextValue = update.state.doc.toString();
        latestValueRef.current = nextValue;
        onChangeRef.current(nextValue);
      }),
      languageExtension,
    ];

    if (props.vimMode) {
      extensions.push(vim());
    }

    const view = new EditorView({
      state: EditorState.create({
        doc: latestValueRef.current,
        extensions,
      }),
      parent,
    });
    viewRef.current = view;
    if (props.autoFocus) {
      view.focus();
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [languageExtension, props.autoFocus, props.readOnly, props.resolvedTheme, props.vimMode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const currentValue = view.state.doc.toString();
    if (currentValue === props.value) {
      return;
    }
    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: props.value,
      },
    });
  }, [props.value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    forceLinting(view);
  }, [props.diagnostics]);

  return <div ref={containerRef} className="h-full min-h-0 min-w-0 overflow-hidden" />;
}
