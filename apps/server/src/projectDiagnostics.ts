import path from "node:path";

import type {
  ProjectDiagnostic,
  ProjectGetDiagnosticsInput,
  ProjectGetDiagnosticsResult,
} from "@t3tools/contracts";
import ts from "typescript";

import {
  MAX_PROJECT_DIAGNOSTICS,
  normalizeRelativeFilter,
  sortProjectDiagnostics,
  toRelativeWorkspacePath,
} from "./projectDiagnosticUtils";
import { getWorkspaceLspDiagnostics } from "./projectLsp";

const SUPPORTED_TYPESCRIPT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

function resolveDiagnosticSeverity(category: ts.DiagnosticCategory): ProjectDiagnostic["severity"] {
  switch (category) {
    case ts.DiagnosticCategory.Warning:
      return "warning";
    case ts.DiagnosticCategory.Suggestion:
    case ts.DiagnosticCategory.Message:
      return "info";
    default:
      return "error";
  }
}

function normalizeTypeScriptDiagnostic(params: {
  cwd: string;
  diagnostic: ts.Diagnostic;
  fallbackAbsolutePath?: string | null;
}): ProjectDiagnostic | null {
  const sourcePath =
    params.diagnostic.file?.fileName ??
    (params.fallbackAbsolutePath ? path.resolve(params.fallbackAbsolutePath) : null);
  if (!sourcePath) {
    return null;
  }

  const relativePath = toRelativeWorkspacePath(params.cwd, sourcePath);
  if (!relativePath || path.extname(relativePath) === ".d.ts") {
    return null;
  }

  const diagnosticText = ts
    .flattenDiagnosticMessageText(params.diagnostic.messageText, "\n")
    .trim();
  if (diagnosticText.length === 0) {
    return null;
  }

  const start = params.diagnostic.start ?? 0;
  const length = Math.max(params.diagnostic.length ?? 0, 1);
  const file = params.diagnostic.file;
  const startPosition = file ? ts.getLineAndCharacterOfPosition(file, start) : null;
  const endPosition = file
    ? ts.getLineAndCharacterOfPosition(file, Math.max(start, start + length - 1))
    : null;

  return {
    relativePath,
    severity: resolveDiagnosticSeverity(params.diagnostic.category),
    message: diagnosticText,
    ...(typeof params.diagnostic.source === "string" && params.diagnostic.source.trim().length > 0
      ? { source: params.diagnostic.source.trim() }
      : {}),
    ...(params.diagnostic.code ? { code: String(params.diagnostic.code) } : {}),
    startLine: (startPosition?.line ?? 0) + 1,
    startColumn: (startPosition?.character ?? 0) + 1,
    endLine: (endPosition?.line ?? startPosition?.line ?? 0) + 1,
    endColumn: (endPosition?.character ?? startPosition?.character ?? 0) + 1,
  };
}

export async function getTypeScriptWorkspaceDiagnostics(
  input: ProjectGetDiagnosticsInput,
): Promise<ProjectGetDiagnosticsResult> {
  const updatedAt = new Date().toISOString();
  const relativeFilter = normalizeRelativeFilter(input.relativePath);
  const configPath = ts.findConfigFile(input.cwd, ts.sys.fileExists, "tsconfig.json");

  if (!configPath) {
    return {
      diagnostics: [],
      truncated: false,
      updatedAt,
    };
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    const configDiagnostic = normalizeTypeScriptDiagnostic({
      cwd: input.cwd,
      diagnostic: configFile.error,
      fallbackAbsolutePath: configPath,
    });
    const diagnostics =
      configDiagnostic && (!relativeFilter || configDiagnostic.relativePath === relativeFilter)
        ? [configDiagnostic]
        : [];
    return {
      diagnostics,
      truncated: false,
      updatedAt,
    };
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    input.cwd,
    undefined,
    configPath,
  );
  const parseDiagnostics = parsedConfig.errors
    .map((diagnostic) =>
      normalizeTypeScriptDiagnostic({
        cwd: input.cwd,
        diagnostic,
        fallbackAbsolutePath: configPath,
      }),
    )
    .flatMap((diagnostic) => (diagnostic ? [diagnostic] : []));

  const candidateFiles =
    relativeFilter && SUPPORTED_TYPESCRIPT_EXTENSIONS.has(path.extname(relativeFilter))
      ? parsedConfig.fileNames.filter(
          (fileName) => toRelativeWorkspacePath(input.cwd, fileName) === relativeFilter,
        )
      : parsedConfig.fileNames;

  if (candidateFiles.length === 0) {
    return {
      diagnostics: parseDiagnostics,
      truncated: false,
      updatedAt,
    };
  }

  const program = ts.createProgram({
    rootNames: candidateFiles,
    options: parsedConfig.options,
    ...(parsedConfig.projectReferences
      ? { projectReferences: parsedConfig.projectReferences }
      : {}),
  });
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) =>
      normalizeTypeScriptDiagnostic({
        cwd: input.cwd,
        diagnostic,
      }),
    )
    .flatMap((diagnostic) => (diagnostic ? [diagnostic] : []));

  const combinedDiagnostics = sortProjectDiagnostics(
    [...parseDiagnostics, ...diagnostics].filter(
      (diagnostic) => !relativeFilter || diagnostic.relativePath === relativeFilter,
    ),
  );

  return {
    diagnostics: combinedDiagnostics.slice(0, MAX_PROJECT_DIAGNOSTICS),
    truncated: combinedDiagnostics.length > MAX_PROJECT_DIAGNOSTICS,
    updatedAt,
  };
}

export async function getWorkspaceDiagnostics(
  input: ProjectGetDiagnosticsInput,
): Promise<ProjectGetDiagnosticsResult> {
  const lspDiagnostics = await getWorkspaceLspDiagnostics(input);
  if (lspDiagnostics) {
    return lspDiagnostics;
  }
  return getTypeScriptWorkspaceDiagnostics(input);
}
