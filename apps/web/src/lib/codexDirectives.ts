export interface CodeCommentDirective {
  title: string;
  body: string;
  file: string;
  start?: number;
  end?: number;
  priority?: number;
  confidence?: number;
}

export interface ParsedAssistantDirectives {
  displayText: string;
  codeComments: CodeCommentDirective[];
}

const CODE_COMMENT_DIRECTIVE_PREFIX = "::code-comment{";
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const UNC_PATH_PATTERN = /^\\\\/;

function findDirectiveEnd(text: string, startIndex: number): number | null {
  let inQuotes = false;

  for (
    let index = startIndex + CODE_COMMENT_DIRECTIVE_PREFIX.length;
    index < text.length;
    index += 1
  ) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (character === "}" && !inQuotes) {
      return index + 1;
    }
  }

  return null;
}

function decodeQuotedValue(raw: string): string {
  let result = "";

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character !== "\\") {
      result += character;
      continue;
    }

    const escaped = raw[index + 1];
    if (escaped === undefined) {
      result += "\\";
      continue;
    }

    switch (escaped) {
      case "n":
        result += "\n";
        break;
      case "r":
        result += "\r";
        break;
      case "t":
        result += "\t";
        break;
      case '"':
      case "\\":
        result += escaped;
        break;
      default:
        result += escaped;
        break;
    }

    index += 1;
  }

  return result;
}

function parseDirectiveAttributes(input: string): Record<string, string> | null {
  const attributes: Record<string, string> = {};
  let index = 0;

  while (index < input.length) {
    while (index < input.length && /\s/.test(input[index] ?? "")) {
      index += 1;
    }
    if (index >= input.length) {
      return attributes;
    }

    const keyStart = index;
    while (index < input.length && /[A-Za-z0-9_-]/.test(input[index] ?? "")) {
      index += 1;
    }
    if (keyStart === index) {
      return null;
    }
    const key = input.slice(keyStart, index);

    while (index < input.length && /\s/.test(input[index] ?? "")) {
      index += 1;
    }
    if (input[index] !== "=") {
      return null;
    }
    index += 1;

    while (index < input.length && /\s/.test(input[index] ?? "")) {
      index += 1;
    }
    if (index >= input.length) {
      return null;
    }

    if (input[index] === '"') {
      index += 1;
      let value = "";
      let closed = false;

      while (index < input.length) {
        const character = input[index];
        if (character === "\\") {
          const nextCharacter = input[index + 1];
          if (nextCharacter === undefined) {
            value += "\\";
            index += 1;
            continue;
          }
          value += `\\${nextCharacter}`;
          index += 2;
          continue;
        }
        if (character === '"') {
          closed = true;
          index += 1;
          break;
        }
        value += character;
        index += 1;
      }

      if (!closed) {
        return null;
      }

      attributes[key] = decodeQuotedValue(value);
      continue;
    }

    const valueStart = index;
    while (index < input.length && !/\s/.test(input[index] ?? "")) {
      index += 1;
    }
    const value = input.slice(valueStart, index);
    if (value.length === 0) {
      return null;
    }
    attributes[key] = value;
  }

  return attributes;
}

function toPositiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : undefined;
}

function toPriority(value: string | undefined): number | undefined {
  const parsed = toPositiveInteger(value);
  if (parsed === undefined && value === "0") {
    return 0;
  }
  return parsed !== undefined && parsed <= 3 ? parsed : undefined;
}

function toConfidence(value: string | undefined): number | undefined {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return parsed >= 0 && parsed <= 1 ? parsed : undefined;
}

function parseCodeCommentDirective(
  text: string,
  startIndex: number,
): {
  directive: CodeCommentDirective;
  endIndex: number;
} | null {
  const endIndex = findDirectiveEnd(text, startIndex);
  if (endIndex === null) {
    return null;
  }

  const rawAttributes = text.slice(startIndex + CODE_COMMENT_DIRECTIVE_PREFIX.length, endIndex - 1);
  const attributes = parseDirectiveAttributes(rawAttributes);
  if (!attributes) {
    return null;
  }

  const title = attributes.title?.trim();
  const body = attributes.body?.trim();
  const file = attributes.file?.trim();
  if (!title || !body || !file) {
    return null;
  }

  const start = toPositiveInteger(attributes.start);
  const end = toPositiveInteger(attributes.end);
  const normalizedEnd = start !== undefined && end !== undefined && end < start ? start : end;
  const priority = toPriority(attributes.priority);
  const confidence = toConfidence(attributes.confidence);

  return {
    directive: {
      title,
      body,
      file,
      ...(start !== undefined ? { start } : {}),
      ...(normalizedEnd !== undefined ? { end: normalizedEnd } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    },
    endIndex,
  };
}

function cleanDirectiveStrippedText(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function parseAssistantDirectives(text: string): ParsedAssistantDirectives {
  const codeComments: CodeCommentDirective[] = [];
  const displayParts: string[] = [];
  let cursor = 0;
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const directiveIndex = text.indexOf(CODE_COMMENT_DIRECTIVE_PREFIX, searchIndex);
    if (directiveIndex === -1) {
      break;
    }

    const parsedDirective = parseCodeCommentDirective(text, directiveIndex);
    if (!parsedDirective) {
      searchIndex = directiveIndex + CODE_COMMENT_DIRECTIVE_PREFIX.length;
      continue;
    }

    displayParts.push(text.slice(cursor, directiveIndex));
    codeComments.push(parsedDirective.directive);
    cursor = parsedDirective.endIndex;
    searchIndex = parsedDirective.endIndex;
  }

  if (codeComments.length === 0) {
    return {
      displayText: text,
      codeComments: [],
    };
  }

  displayParts.push(text.slice(cursor));
  return {
    displayText: cleanDirectiveStrippedText(displayParts.join("")),
    codeComments,
  };
}

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, "/");
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(path) || UNC_PATH_PATTERN.test(path)
  );
}

function joinPath(basePath: string, relativePath: string): string {
  const normalizedBasePath = trimTrailingSlash(normalizePathSeparators(basePath));
  const normalizedRelativePath = normalizePathSeparators(relativePath).replace(/^\.?\//, "");
  return `${normalizedBasePath}/${normalizedRelativePath}`;
}

function parentPath(path: string): string {
  const normalizedPath = trimTrailingSlash(normalizePathSeparators(path));
  const separatorIndex = normalizedPath.lastIndexOf("/");
  if (separatorIndex <= 0) {
    return normalizedPath.startsWith("/") ? "/" : ".";
  }
  return normalizedPath.slice(0, separatorIndex);
}

function baseName(path: string): string {
  const normalizedPath = trimTrailingSlash(normalizePathSeparators(path));
  const separatorIndex = normalizedPath.lastIndexOf("/");
  return separatorIndex === -1 ? normalizedPath : normalizedPath.slice(separatorIndex + 1);
}

export function resolveCodeCommentFileTarget(file: string, workspaceRoot?: string): string {
  if (isAbsolutePath(file) || !workspaceRoot) {
    return file;
  }

  const normalizedWorkspaceRoot = trimTrailingSlash(normalizePathSeparators(workspaceRoot));
  const normalizedFile = normalizePathSeparators(file).replace(/^\.?\//, "");
  const workspaceBaseName = baseName(normalizedWorkspaceRoot);

  if (workspaceBaseName.length > 0 && normalizedFile.startsWith(`${workspaceBaseName}/`)) {
    return joinPath(parentPath(normalizedWorkspaceRoot), normalizedFile);
  }

  return joinPath(normalizedWorkspaceRoot, normalizedFile);
}

export function buildCodeCommentOpenTarget(
  comment: Pick<CodeCommentDirective, "file" | "start">,
  workspaceRoot?: string,
): string {
  const resolvedFileTarget = resolveCodeCommentFileTarget(comment.file, workspaceRoot);
  return comment.start !== undefined
    ? `${resolvedFileTarget}:${comment.start}`
    : resolvedFileTarget;
}
