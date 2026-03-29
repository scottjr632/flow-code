import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_READ_FILE_MAX_BYTES = 1024 * 1024;
const PROJECT_DIAGNOSTIC_MAX_MESSAGE_LENGTH = 4_096;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  mtimeMs: Schema.NullOr(Schema.Number),
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export const ProjectListDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: Schema.optional(
    TrimmedString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  ),
});
export type ProjectListDirectoryInput = typeof ProjectListDirectoryInput.Type;

export const ProjectListDirectoryResult = Schema.Struct({
  relativePath: Schema.String,
  entries: Schema.Array(ProjectEntry),
});
export type ProjectListDirectoryResult = typeof ProjectListDirectoryResult.Type;

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  contents: Schema.String,
  binary: Schema.Boolean,
  tooLarge: Schema.Boolean,
  byteLength: NonNegativeInt,
  maxBytes: PositiveInt,
  mtimeMs: Schema.NullOr(Schema.Number),
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export const ProjectDiagnosticSeverity = Schema.Literals(["error", "warning", "info"]);
export type ProjectDiagnosticSeverity = typeof ProjectDiagnosticSeverity.Type;

export const ProjectDiagnostic = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  severity: ProjectDiagnosticSeverity,
  message: Schema.String.check(Schema.isMinLength(1)).check(
    Schema.isMaxLength(PROJECT_DIAGNOSTIC_MAX_MESSAGE_LENGTH),
  ),
  source: Schema.optional(TrimmedNonEmptyString),
  code: Schema.optional(TrimmedNonEmptyString),
  startLine: PositiveInt,
  startColumn: PositiveInt,
  endLine: PositiveInt,
  endColumn: PositiveInt,
});
export type ProjectDiagnostic = typeof ProjectDiagnostic.Type;

export const ProjectGetDiagnosticsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: Schema.optional(
    TrimmedString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  ),
});
export type ProjectGetDiagnosticsInput = typeof ProjectGetDiagnosticsInput.Type;

export const ProjectGetDiagnosticsResult = Schema.Struct({
  diagnostics: Schema.Array(ProjectDiagnostic),
  truncated: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export type ProjectGetDiagnosticsResult = typeof ProjectGetDiagnosticsResult.Type;

export const ProjectLspState = Schema.Literals([
  "unavailable",
  "stopped",
  "starting",
  "running",
  "error",
]);
export type ProjectLspState = typeof ProjectLspState.Type;

export const ProjectLspServer = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  command: Schema.Array(TrimmedNonEmptyString),
});
export type ProjectLspServer = typeof ProjectLspServer.Type;

export const ProjectGetLspStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ProjectGetLspStatusInput = typeof ProjectGetLspStatusInput.Type;

export const ProjectGetLspStatusResult = Schema.Struct({
  state: ProjectLspState,
  availableServers: Schema.Array(ProjectLspServer),
  server: Schema.optional(ProjectLspServer),
  detail: Schema.optional(Schema.String),
});
export type ProjectGetLspStatusResult = typeof ProjectGetLspStatusResult.Type;

export const ProjectStartLspInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  serverId: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectStartLspInput = typeof ProjectStartLspInput.Type;

export const ProjectStopLspInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ProjectStopLspInput = typeof ProjectStopLspInput.Type;

export const ProjectStopLspResult = Schema.Struct({
  stopped: Schema.Boolean,
});
export type ProjectStopLspResult = typeof ProjectStopLspResult.Type;

export const ProjectSyncLspDocumentEvent = Schema.Literals(["open", "change", "save", "close"]);
export type ProjectSyncLspDocumentEvent = typeof ProjectSyncLspDocumentEvent.Type;

export const ProjectSyncLspDocumentInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  event: ProjectSyncLspDocumentEvent,
  contents: Schema.optional(Schema.String),
});
export type ProjectSyncLspDocumentInput = typeof ProjectSyncLspDocumentInput.Type;

export const ProjectSyncLspDocumentResult = Schema.Struct({
  accepted: Schema.Boolean,
});
export type ProjectSyncLspDocumentResult = typeof ProjectSyncLspDocumentResult.Type;

export const PROJECT_READ_FILE_DEFAULT_MAX_BYTES = PROJECT_READ_FILE_MAX_BYTES;
