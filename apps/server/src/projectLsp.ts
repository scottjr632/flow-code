import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  ProjectDiagnostic,
  ProjectDiagnosticSeverity,
  ProjectGetDiagnosticsInput,
  ProjectGetDiagnosticsResult,
  ProjectGetLspStatusInput,
  ProjectGetLspStatusResult,
  ProjectLspServer,
  ProjectStartLspInput,
  ProjectStopLspInput,
  ProjectStopLspResult,
  ProjectSyncLspDocumentInput,
  ProjectSyncLspDocumentResult,
} from "@t3tools/contracts";

import {
  MAX_PROJECT_DIAGNOSTICS,
  normalizeRelativeFilter,
  sortProjectDiagnostics,
  toRelativeWorkspacePath,
} from "./projectDiagnosticUtils";

const require = createRequire(import.meta.url);

const TYPESCRIPT_LSP_SERVER_ID = "typescript-language-server";
const LSP_REQUEST_TIMEOUT_MS = 10_000;

interface JsonRpcRequestMessage {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcNotificationMessage {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponseMessage {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

type JsonRpcMessage = JsonRpcRequestMessage | JsonRpcNotificationMessage | JsonRpcResponseMessage;

interface LspResolvedServer {
  metadata: ProjectLspServer;
  cliPath: string;
  tsserverPath: string;
}

interface LspAvailability {
  servers: readonly LspResolvedServer[];
  detail?: string;
}

interface OpenLspDocument {
  version: number;
  contents: string;
}

let cachedAvailability: LspAvailability | null = null;

const workspaceSessions = new Map<string, WorkspaceLspSession>();

function normalizeWorkspaceRoot(cwd: string): string {
  return path.resolve(cwd);
}

function createStatus(input: {
  state: ProjectGetLspStatusResult["state"];
  availableServers: readonly ProjectLspServer[];
  server?: ProjectLspServer;
  detail?: string | null;
}): ProjectGetLspStatusResult {
  return {
    state: input.state,
    availableServers: [...input.availableServers],
    ...(input.server ? { server: input.server } : {}),
    ...(input.detail && input.detail.trim().length > 0 ? { detail: input.detail.trim() } : {}),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toFileUri(inputPath: string): string {
  return pathToFileURL(inputPath).toString();
}

function formatJsonRpcError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Language server request failed.";
  }
  const maybeError = error as { message?: unknown; code?: unknown };
  const maybeMessage = typeof maybeError.message === "string" ? maybeError.message.trim() : null;
  const maybeCode =
    typeof maybeError.code === "number" || typeof maybeError.code === "string"
      ? String(maybeError.code)
      : null;
  if (maybeMessage && maybeCode) {
    return `${maybeMessage} (${maybeCode})`;
  }
  if (maybeMessage) {
    return maybeMessage;
  }
  if (maybeCode) {
    return `Language server request failed (${maybeCode}).`;
  }
  return "Language server request failed.";
}

function resolveTypeScriptLspAvailability(): LspAvailability {
  if (cachedAvailability) {
    return cachedAvailability;
  }

  try {
    const cliPath = require.resolve("typescript-language-server/lib/cli.mjs");
    const tsserverPath = require.resolve("typescript/lib/tsserver.js");
    cachedAvailability = {
      servers: [
        {
          metadata: {
            id: TYPESCRIPT_LSP_SERVER_ID,
            label: "TypeScript / JavaScript",
            command: ["typescript-language-server", "--stdio"],
          },
          cliPath,
          tsserverPath,
        },
      ],
    };
    return cachedAvailability;
  } catch (error) {
    const detail =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "The TypeScript language server is not installed.";
    cachedAvailability = { servers: [], detail };
    return cachedAvailability;
  }
}

function resolveRequestedServer(serverId: string | undefined): LspResolvedServer | null {
  const availability = resolveTypeScriptLspAvailability();
  if (availability.servers.length === 0) {
    return null;
  }
  if (!serverId) {
    return availability.servers[0] ?? null;
  }
  return availability.servers.find((server) => server.metadata.id === serverId) ?? null;
}

function severityFromLsp(severity: number | undefined): ProjectDiagnosticSeverity {
  switch (severity) {
    case 2:
      return "warning";
    case 3:
    case 4:
      return "info";
    default:
      return "error";
  }
}

function codeFromLspDiagnostic(code: unknown): string | undefined {
  if (typeof code === "string" && code.trim().length > 0) {
    return code.trim();
  }
  if (typeof code === "number") {
    return String(code);
  }
  if (
    code &&
    typeof code === "object" &&
    "value" in code &&
    (typeof code.value === "string" || typeof code.value === "number")
  ) {
    return String(code.value);
  }
  return undefined;
}

function normalizeLspDiagnostic(params: {
  cwd: string;
  uri: string;
  diagnostic: {
    message?: string;
    severity?: number;
    source?: string;
    code?: unknown;
    range?: {
      start?: { line?: number; character?: number };
      end?: { line?: number; character?: number };
    };
  };
}): ProjectDiagnostic | null {
  let absolutePath: string;
  try {
    absolutePath = fileURLToPath(params.uri);
  } catch {
    return null;
  }

  const relativePath = toRelativeWorkspacePath(params.cwd, absolutePath);
  if (!relativePath || relativePath.endsWith(".d.ts")) {
    return null;
  }

  const message = params.diagnostic.message?.trim() ?? "";
  if (message.length === 0) {
    return null;
  }

  const startLine = Math.max(0, params.diagnostic.range?.start?.line ?? 0) + 1;
  const startColumn = Math.max(0, params.diagnostic.range?.start?.character ?? 0) + 1;
  const endLine = Math.max(params.diagnostic.range?.end?.line ?? 0, startLine - 1) + 1;
  const endColumn = Math.max(params.diagnostic.range?.end?.character ?? 0, startColumn - 1) + 1;
  const diagnosticCode = codeFromLspDiagnostic(params.diagnostic.code);

  return {
    relativePath,
    severity: severityFromLsp(params.diagnostic.severity),
    message,
    ...(params.diagnostic.source?.trim() ? { source: params.diagnostic.source.trim() } : {}),
    ...(diagnosticCode ? { code: diagnosticCode } : {}),
    startLine,
    startColumn,
    endLine: Math.max(startLine, endLine),
    endColumn: Math.max(startColumn, endColumn),
  };
}

function languageIdForRelativePath(relativePath: string): string {
  const normalized = relativePath.toLowerCase();
  if (normalized.endsWith(".tsx")) {
    return "typescriptreact";
  }
  if (normalized.endsWith(".ts") || normalized.endsWith(".mts") || normalized.endsWith(".cts")) {
    return "typescript";
  }
  if (normalized.endsWith(".jsx")) {
    return "javascriptreact";
  }
  if (normalized.endsWith(".js") || normalized.endsWith(".mjs") || normalized.endsWith(".cjs")) {
    return "javascript";
  }
  if (normalized.endsWith(".json")) {
    return "json";
  }
  if (normalized.endsWith(".md") || normalized.endsWith(".mdx")) {
    return "markdown";
  }
  if (normalized.endsWith(".css")) {
    return "css";
  }
  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) {
    return "html";
  }
  return "plaintext";
}

async function readWorkspaceFileContents(
  cwd: string,
  relativePath: string,
): Promise<string | null> {
  const absolutePath = path.resolve(cwd, relativePath);
  if (toRelativeWorkspacePath(cwd, absolutePath) !== relativePath) {
    return null;
  }
  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch {
    return null;
  }
}

class WorkspaceLspSession {
  readonly cwd: string;
  readonly server: LspResolvedServer;

  state: ProjectGetLspStatusResult["state"] = "stopped";
  detail: string | null = null;
  updatedAt = new Date().toISOString();

  private process: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = Buffer.alloc(0);
  private nextRequestId = 0;
  private startupPromise: Promise<ProjectGetLspStatusResult> | null = null;
  private stopRequested = false;
  private stderrLines: string[] = [];
  private readonly pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly diagnosticsByPath = new Map<string, ProjectDiagnostic[]>();
  private readonly openDocuments = new Map<string, OpenLspDocument>();

  constructor(cwd: string, server: LspResolvedServer) {
    this.cwd = cwd;
    this.server = server;
  }

  getStatus(): ProjectGetLspStatusResult {
    return createStatus({
      state: this.state,
      availableServers: [this.server.metadata],
      ...(this.state === "running" || this.state === "starting" || this.state === "error"
        ? { server: this.server.metadata }
        : {}),
      detail: this.detail,
    });
  }

  async start(): Promise<ProjectGetLspStatusResult> {
    if (this.state === "running") {
      return this.getStatus();
    }
    if (this.startupPromise) {
      return this.startupPromise;
    }
    this.startupPromise = this.startInternal().finally(() => {
      this.startupPromise = null;
    });
    return this.startupPromise;
  }

  async stop(): Promise<boolean> {
    const child = this.process;
    const hadProcess = child !== null;

    this.stopRequested = true;
    this.state = "stopped";
    this.detail = null;
    this.updatedAt = new Date().toISOString();
    this.diagnosticsByPath.clear();
    this.openDocuments.clear();
    this.rejectAllPending(new Error("Language server stopped."));

    if (!child) {
      return hadProcess;
    }

    const exitPromise = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });

    try {
      await this.sendRequest("shutdown", undefined, 3_000);
    } catch {
      // Ignore shutdown failures and force the process down.
    }

    try {
      this.sendNotification("exit");
    } catch {
      // Ignore exit notification failures.
    }

    const exitedGracefully = await Promise.race([
      exitPromise.then(() => true),
      delay(1_000).then(() => false),
    ]);
    if (!exitedGracefully) {
      child.kill("SIGTERM");
    }

    const exitedAfterTerm = await Promise.race([
      exitPromise.then(() => true),
      delay(1_500).then(() => false),
    ]);
    if (!exitedAfterTerm) {
      child.kill("SIGKILL");
    }

    await exitPromise;
    return hadProcess;
  }

  getDiagnostics(relativePath: string | null): ProjectGetDiagnosticsResult | null {
    if (this.state !== "running") {
      return null;
    }

    if (relativePath) {
      if (!this.openDocuments.has(relativePath) && !this.diagnosticsByPath.has(relativePath)) {
        return null;
      }
      const diagnostics = sortProjectDiagnostics(this.diagnosticsByPath.get(relativePath) ?? []);
      return {
        diagnostics: diagnostics.slice(0, MAX_PROJECT_DIAGNOSTICS),
        truncated: diagnostics.length > MAX_PROJECT_DIAGNOSTICS,
        updatedAt: this.updatedAt,
      };
    }

    return null;
  }

  async syncDocument(input: ProjectSyncLspDocumentInput): Promise<ProjectSyncLspDocumentResult> {
    if (this.state !== "running" || !this.process) {
      return { accepted: false };
    }

    const absolutePath = path.resolve(this.cwd, input.relativePath);
    const relativePath = toRelativeWorkspacePath(this.cwd, absolutePath);
    if (!relativePath) {
      return { accepted: false };
    }

    const uri = toFileUri(absolutePath);
    const existingDocument = this.openDocuments.get(relativePath) ?? null;

    const resolveContents = async (): Promise<string | null> => {
      if (typeof input.contents === "string") {
        return input.contents;
      }
      if (existingDocument) {
        return existingDocument.contents;
      }
      return readWorkspaceFileContents(this.cwd, relativePath);
    };

    if (input.event === "close") {
      if (!existingDocument) {
        return { accepted: false };
      }
      this.sendNotification("textDocument/didClose", {
        textDocument: { uri },
      });
      this.openDocuments.delete(relativePath);
      this.diagnosticsByPath.delete(relativePath);
      this.updatedAt = new Date().toISOString();
      return { accepted: true };
    }

    const contents = await resolveContents();
    if (contents === null) {
      return { accepted: false };
    }

    const didOpenDocument = (nextContents: string) => {
      this.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: languageIdForRelativePath(relativePath),
          version: 1,
          text: nextContents,
        },
      });
      this.openDocuments.set(relativePath, {
        version: 1,
        contents: nextContents,
      });
    };

    const didChangeDocument = (document: OpenLspDocument, nextContents: string) => {
      if (document.contents === nextContents) {
        return document;
      }
      const nextDocument = {
        version: document.version + 1,
        contents: nextContents,
      };
      this.sendNotification("textDocument/didChange", {
        textDocument: {
          uri,
          version: nextDocument.version,
        },
        contentChanges: [{ text: nextContents }],
      });
      this.openDocuments.set(relativePath, nextDocument);
      return nextDocument;
    };

    if (!existingDocument) {
      didOpenDocument(contents);
    } else if (input.event === "open" || input.event === "change" || input.event === "save") {
      didChangeDocument(existingDocument, contents);
    }

    if (input.event === "save") {
      this.sendNotification("textDocument/didSave", {
        textDocument: { uri },
        text: contents,
      });
    }

    return { accepted: true };
  }

  private async startInternal(): Promise<ProjectGetLspStatusResult> {
    if (this.process) {
      await this.stop();
    }

    this.stopRequested = false;
    this.state = "starting";
    this.detail = `Starting ${this.server.metadata.label}`;
    this.updatedAt = new Date().toISOString();
    this.diagnosticsByPath.clear();
    this.openDocuments.clear();
    this.stderrLines = [];
    this.stdoutBuffer = Buffer.alloc(0);
    this.nextRequestId = 0;

    const child = spawn(process.execPath, [this.server.cliPath, "--stdio"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;

    child.stdout.on("data", this.handleStdoutData);
    child.stderr.on("data", this.handleStderrData);
    child.on("error", this.handleProcessError);
    child.on("exit", this.handleProcessExit);

    try {
      await this.sendRequest("initialize", {
        processId: process.pid,
        rootUri: toFileUri(this.cwd),
        initializationOptions: {
          tsserver: {
            path: this.server.tsserverPath,
          },
        },
        capabilities: {
          workspace: {
            configuration: true,
            workspaceFolders: true,
          },
          textDocument: {
            publishDiagnostics: {
              relatedInformation: true,
            },
          },
        },
        workspaceFolders: [
          {
            uri: toFileUri(this.cwd),
            name: path.basename(this.cwd) || this.cwd,
          },
        ],
      });
      this.sendNotification("initialized", {});
      this.state = "running";
      this.detail = `${this.server.metadata.label} ready`;
      this.updatedAt = new Date().toISOString();
      return this.getStatus();
    } catch (error) {
      const startErrorDetail =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : `Failed to start ${this.server.metadata.label}`;
      this.state = "error";
      this.detail = startErrorDetail;
      this.updatedAt = new Date().toISOString();
      try {
        await this.stop();
      } catch {
        // Ignore cleanup failures after startup failure.
      }
      this.state = "error";
      this.detail = startErrorDetail;
      this.updatedAt = new Date().toISOString();
      return this.getStatus();
    }
  }

  private readonly handleStdoutData = (chunk: Buffer | string) => {
    const chunkBuffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunkBuffer]);

    while (true) {
      const headerBoundary = this.stdoutBuffer.indexOf("\r\n\r\n");
      if (headerBoundary === -1) {
        return;
      }

      const headerText = this.stdoutBuffer.subarray(0, headerBoundary).toString("utf8");
      const contentLengthMatch = headerText.match(/content-length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        this.stdoutBuffer = Buffer.alloc(0);
        this.setError("Language server sent an invalid response header.");
        return;
      }

      const contentLength = Number(contentLengthMatch[1]);
      const messageStart = headerBoundary + 4;
      const messageEnd = messageStart + contentLength;
      if (this.stdoutBuffer.byteLength < messageEnd) {
        return;
      }

      const messageText = this.stdoutBuffer.subarray(messageStart, messageEnd).toString("utf8");
      this.stdoutBuffer = this.stdoutBuffer.subarray(messageEnd);

      try {
        const message = JSON.parse(messageText) as JsonRpcMessage;
        this.handleMessage(message);
      } catch {
        this.setError("Language server sent malformed JSON.");
        return;
      }
    }
  };

  private readonly handleStderrData = (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      return;
    }
    this.stderrLines.push(...lines);
    this.stderrLines.splice(0, Math.max(0, this.stderrLines.length - 12));

    if (this.state !== "running" && this.state !== "stopped") {
      this.detail = lines[lines.length - 1] ?? this.detail;
      this.updatedAt = new Date().toISOString();
    }
  };

  private readonly handleProcessError = (error: Error) => {
    this.setError(error.message);
  };

  private readonly handleProcessExit = (code: number | null, signal: NodeJS.Signals | null) => {
    this.process = null;
    this.stdoutBuffer = Buffer.alloc(0);
    this.rejectAllPending(
      new Error(
        this.stopRequested
          ? "Language server stopped."
          : `Language server exited${code !== null ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}.`,
      ),
    );

    if (this.stopRequested) {
      this.stopRequested = false;
      this.state = "stopped";
      this.detail = null;
    } else if (this.state !== "error") {
      const lastStderrLine = this.stderrLines[this.stderrLines.length - 1] ?? null;
      this.state = "error";
      this.detail =
        lastStderrLine ??
        `Language server exited${code !== null ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}.`;
    }
    this.updatedAt = new Date().toISOString();
  };

  private handleMessage(message: JsonRpcMessage): void {
    if ("id" in message && ("result" in message || "error" in message)) {
      this.handleResponse(message);
      return;
    }

    if (!("method" in message)) {
      return;
    }

    if ("id" in message) {
      void this.respondToServerRequest(message);
      return;
    }

    this.handleNotification(message.method, message.params);
  }

  private handleResponse(message: JsonRpcResponseMessage): void {
    if (typeof message.id !== "number") {
      return;
    }

    const pendingRequest = this.pendingRequests.get(message.id);
    if (!pendingRequest) {
      return;
    }

    clearTimeout(pendingRequest.timer);
    this.pendingRequests.delete(message.id);

    if (message.error) {
      pendingRequest.reject(new Error(formatJsonRpcError(message.error)));
      return;
    }

    pendingRequest.resolve(message.result);
  }

  private async respondToServerRequest(message: JsonRpcRequestMessage): Promise<void> {
    let result: unknown = null;
    switch (message.method) {
      case "workspace/configuration": {
        const items =
          message.params &&
          typeof message.params === "object" &&
          "items" in message.params &&
          Array.isArray(message.params.items)
            ? message.params.items
            : [];
        result = items.map(() => null);
        break;
      }

      case "workspace/workspaceFolders":
        result = [
          {
            uri: toFileUri(this.cwd),
            name: path.basename(this.cwd) || this.cwd,
          },
        ];
        break;

      case "window/workDoneProgress/create":
      case "client/registerCapability":
      case "client/unregisterCapability":
        result = null;
        break;

      default:
        result = null;
        break;
    }

    this.writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result,
    });
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === "textDocument/publishDiagnostics") {
      this.handlePublishDiagnostics(params);
      return;
    }

    if (method === "window/showMessage" || method === "window/logMessage") {
      if (
        params &&
        typeof params === "object" &&
        "message" in params &&
        typeof params.message === "string" &&
        params.message.trim().length > 0 &&
        this.state !== "running"
      ) {
        this.detail = params.message.trim();
        this.updatedAt = new Date().toISOString();
      }
    }
  }

  private handlePublishDiagnostics(params: unknown): void {
    if (!params || typeof params !== "object") {
      return;
    }

    const uri = "uri" in params && typeof params.uri === "string" ? params.uri : null;
    const diagnostics =
      "diagnostics" in params && Array.isArray(params.diagnostics) ? params.diagnostics : null;
    if (!uri || !diagnostics) {
      return;
    }

    const normalizedDiagnostics = diagnostics
      .map((diagnostic) =>
        normalizeLspDiagnostic({
          cwd: this.cwd,
          uri,
          diagnostic:
            diagnostic && typeof diagnostic === "object"
              ? (diagnostic as Parameters<typeof normalizeLspDiagnostic>[0]["diagnostic"])
              : {},
        }),
      )
      .flatMap((diagnostic) => (diagnostic ? [diagnostic] : []));

    const relativePath =
      normalizedDiagnostics[0]?.relativePath ??
      (() => {
        try {
          const absolutePath = fileURLToPath(uri);
          return toRelativeWorkspacePath(this.cwd, absolutePath);
        } catch {
          return null;
        }
      })();

    if (!relativePath) {
      return;
    }

    if (normalizedDiagnostics.length === 0) {
      this.diagnosticsByPath.delete(relativePath);
    } else {
      this.diagnosticsByPath.set(relativePath, normalizedDiagnostics);
    }
    this.updatedAt = new Date().toISOString();
  }

  private async sendRequest(
    method: string,
    params: unknown,
    timeoutMs = LSP_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const requestId = this.nextRequestId + 1;
    this.nextRequestId = requestId;

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      try {
        this.writeMessage({
          jsonrpc: "2.0",
          id: requestId,
          method,
          ...(params === undefined ? {} : { params }),
        });
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(
          error instanceof Error ? error : new Error("Unable to send language server request."),
        );
      }
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    this.writeMessage({
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  private writeMessage(
    message: JsonRpcRequestMessage | JsonRpcNotificationMessage | JsonRpcResponseMessage,
  ): void {
    const child = this.process;
    if (!child || !child.stdin.writable) {
      throw new Error("Language server is not running.");
    }
    const payload = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
  }

  private rejectAllPending(error: Error): void {
    for (const [requestId, pendingRequest] of this.pendingRequests) {
      clearTimeout(pendingRequest.timer);
      pendingRequest.reject(error);
      this.pendingRequests.delete(requestId);
    }
  }

  private setError(detail: string): void {
    this.state = "error";
    this.detail = detail.trim().length > 0 ? detail.trim() : "Language server failed.";
    this.updatedAt = new Date().toISOString();
  }
}

function getOrCreateWorkspaceSession(cwd: string, server: LspResolvedServer): WorkspaceLspSession {
  const normalizedRoot = normalizeWorkspaceRoot(cwd);
  const existing = workspaceSessions.get(normalizedRoot);
  if (existing) {
    return existing;
  }
  const session = new WorkspaceLspSession(normalizedRoot, server);
  workspaceSessions.set(normalizedRoot, session);
  return session;
}

export async function getWorkspaceLspStatus(
  input: ProjectGetLspStatusInput,
): Promise<ProjectGetLspStatusResult> {
  const availability = resolveTypeScriptLspAvailability();
  const normalizedRoot = normalizeWorkspaceRoot(input.cwd);
  const existingSession = workspaceSessions.get(normalizedRoot);
  if (existingSession) {
    return existingSession.getStatus();
  }
  if (availability.servers.length === 0) {
    return createStatus({
      state: "unavailable",
      availableServers: [],
      detail: availability.detail ?? "No supported language servers are installed.",
    });
  }
  return createStatus({
    state: "stopped",
    availableServers: availability.servers.map((server) => server.metadata),
  });
}

export async function startWorkspaceLsp(
  input: ProjectStartLspInput,
): Promise<ProjectGetLspStatusResult> {
  const requestedServer = resolveRequestedServer(input.serverId);
  if (!requestedServer) {
    const availability = resolveTypeScriptLspAvailability();
    if (availability.servers.length === 0) {
      return createStatus({
        state: "unavailable",
        availableServers: [],
        detail: availability.detail ?? "No supported language servers are installed.",
      });
    }
    throw new Error(`Unknown language server: ${input.serverId ?? "unknown"}`);
  }

  const session = getOrCreateWorkspaceSession(input.cwd, requestedServer);
  return session.start();
}

export async function stopWorkspaceLsp(input: ProjectStopLspInput): Promise<ProjectStopLspResult> {
  const normalizedRoot = normalizeWorkspaceRoot(input.cwd);
  const session = workspaceSessions.get(normalizedRoot);
  if (!session) {
    return { stopped: false };
  }
  const stopped = await session.stop();
  return { stopped };
}

export async function syncWorkspaceLspDocument(
  input: ProjectSyncLspDocumentInput,
): Promise<ProjectSyncLspDocumentResult> {
  const normalizedRoot = normalizeWorkspaceRoot(input.cwd);
  const session = workspaceSessions.get(normalizedRoot);
  if (!session) {
    return { accepted: false };
  }
  return session.syncDocument(input);
}

export async function getWorkspaceLspDiagnostics(
  input: ProjectGetDiagnosticsInput,
): Promise<ProjectGetDiagnosticsResult | null> {
  const normalizedRoot = normalizeWorkspaceRoot(input.cwd);
  const session = workspaceSessions.get(normalizedRoot);
  if (!session) {
    return null;
  }
  return session.getDiagnostics(normalizeRelativeFilter(input.relativePath));
}

export async function stopAllWorkspaceLsps(): Promise<void> {
  const sessions = [...workspaceSessions.values()];
  await Promise.allSettled(sessions.map((session) => session.stop()));
  workspaceSessions.clear();
}
