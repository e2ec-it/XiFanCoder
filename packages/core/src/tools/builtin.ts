import { ToolExecutionError } from '../errors/tool-errors.js';
import type { ToolPermissionLevel } from '../permissions/index.js';
import type { ToolDefinition, ToolDispatcher } from './dispatcher.js';
import {
  executeBashCommand,
  type BashExecuteRequest,
} from './bash-execute.js';
import {
  listDirectory,
  type ListDirRequest,
} from './list-dir.js';
import {
  readFileSegment,
  type ReadFileRequest,
} from './read-file.js';
import {
  fetchWebContent,
  type WebFetchRequest,
  type WebFetchSummarizer,
} from './web-fetch.js';
import {
  writeFileWithPolicy,
  type WriteFileRequest,
} from './write-file.js';

export interface BuiltinToolFactoryOptions {
  readonly readFileDefaultLimit?: number;
  readonly readFileMaxLimit?: number;
  readonly bashDefaultTimeoutMs?: number;
  readonly bashDefaultMaxOutputBytes?: number;
  readonly webFetchDefaultTimeoutMs?: number;
  readonly webFetchDefaultMaxBytes?: number;
  readonly webFetchSummarizer?: WebFetchSummarizer;
}

export const READ_FILE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', minLength: 1 },
    offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1 },
  },
} as const;

export const WRITE_FILE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', minLength: 1 },
    content: { type: 'string' },
    mode: { type: 'string', enum: ['create', 'overwrite', 'append'] },
    range: {
      type: 'object',
      additionalProperties: false,
      required: ['startLine', 'endLine'],
      properties: {
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 },
      },
    },
    expectedHash: { type: 'string', minLength: 1 },
    replacement: { type: 'string' },
  },
} as const;

export const LIST_DIR_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', minLength: 1 },
    recursive: { type: 'boolean' },
    filter: {
      oneOf: [
        { type: 'string' },
        {
          type: 'array',
          items: { type: 'string' },
        },
      ],
    },
    includeHidden: { type: 'boolean' },
    maxEntries: { type: 'integer', minimum: 1 },
  },
} as const;

export const BASH_EXECUTE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['command'],
  properties: {
    command: { type: 'string', minLength: 1 },
    timeoutMs: { type: 'integer', minimum: 1 },
    workingDir: { type: 'string', minLength: 1 },
    maxStdoutBytes: { type: 'integer', minimum: 1 },
    maxStderrBytes: { type: 'integer', minimum: 1 },
    actor: { type: 'string' },
    env: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
  },
} as const;

export const WEB_FETCH_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string', minLength: 1 },
    prompt: { type: 'string' },
    timeoutMs: { type: 'integer', minimum: 1 },
    maxBytes: { type: 'integer', minimum: 1 },
  },
} as const;

function asRecord(toolName: string, args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new ToolExecutionError(toolName, 'arguments must be an object');
  }
  return args as Record<string, unknown>;
}

function readRequiredString(
  toolName: string,
  payload: Record<string, unknown>,
  field: string,
): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ToolExecutionError(toolName, `invalid or missing field: ${field}`);
  }
  return value;
}

function readOptionalString(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : undefined;
}

function readOptionalBoolean(
  payload: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  return typeof value === 'boolean' ? value : undefined;
}

function readOptionalInteger(
  payload: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }
  return value;
}

function parseReadFileRequest(args: unknown): ReadFileRequest {
  const payload = asRecord('read_file', args);
  return {
    path: readRequiredString('read_file', payload, 'path'),
    offset: readOptionalInteger(payload, 'offset'),
    limit: readOptionalInteger(payload, 'limit'),
  };
}

function parseWriteFileRequest(args: unknown): WriteFileRequest {
  const payload = asRecord('write_file', args);
  const path = readRequiredString('write_file', payload, 'path');
  const hasHashFields =
    typeof payload.expectedHash === 'string' &&
    typeof payload.replacement === 'string' &&
    typeof payload.range === 'object' &&
    payload.range !== null;

  if (hasHashFields) {
    const range = payload.range as Record<string, unknown>;
    const startLine = range.startLine;
    const endLine = range.endLine;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
      throw new ToolExecutionError('write_file', 'invalid range.startLine or range.endLine');
    }
    const startLineNumber = startLine as number;
    const endLineNumber = endLine as number;

    return {
      path,
      expectedHash: payload.expectedHash as string,
      replacement: payload.replacement as string,
      range: {
        startLine: startLineNumber,
        endLine: endLineNumber,
      },
    };
  }

  const content = payload.content;
  if (typeof content !== 'string') {
    throw new ToolExecutionError('write_file', 'invalid or missing field: content');
  }

  const modeValue = payload.mode;
  const mode =
    modeValue === 'create' || modeValue === 'overwrite' || modeValue === 'append'
      ? modeValue
      : undefined;

  return {
    path,
    content,
    mode,
  };
}

function parseListDirRequest(args: unknown): ListDirRequest {
  const payload = asRecord('list_dir', args);
  const filterValue = payload.filter;
  const filter =
    typeof filterValue === 'string'
      ? filterValue
      : Array.isArray(filterValue) && filterValue.every((item) => typeof item === 'string')
        ? filterValue
        : undefined;

  return {
    path: readRequiredString('list_dir', payload, 'path'),
    recursive: readOptionalBoolean(payload, 'recursive'),
    filter,
    includeHidden: readOptionalBoolean(payload, 'includeHidden'),
    maxEntries: readOptionalInteger(payload, 'maxEntries'),
  };
}

function parseBashExecuteRequest(args: unknown): BashExecuteRequest {
  const payload = asRecord('bash_execute', args);
  const envValue = payload.env;
  let env: Record<string, string> | undefined;
  if (typeof envValue === 'object' && envValue !== null && !Array.isArray(envValue)) {
    env = {};
    for (const [key, value] of Object.entries(envValue)) {
      if (typeof value === 'string') {
        env[key] = value;
      }
    }
  }

  return {
    command: readRequiredString('bash_execute', payload, 'command'),
    timeoutMs: readOptionalInteger(payload, 'timeoutMs'),
    workingDir: readOptionalString(payload, 'workingDir'),
    maxStdoutBytes: readOptionalInteger(payload, 'maxStdoutBytes'),
    maxStderrBytes: readOptionalInteger(payload, 'maxStderrBytes'),
    actor: readOptionalString(payload, 'actor'),
    env,
  };
}

function parseWebFetchRequest(args: unknown): WebFetchRequest {
  const payload = asRecord('web_fetch', args);
  return {
    url: readRequiredString('web_fetch', payload, 'url'),
    prompt: readOptionalString(payload, 'prompt'),
    timeoutMs: readOptionalInteger(payload, 'timeoutMs'),
    maxBytes: readOptionalInteger(payload, 'maxBytes'),
  };
}

function createDefinition(
  name: string,
  permissionLevel: ToolPermissionLevel,
  inputSchema: Record<string, unknown>,
  execute: (args: unknown) => Promise<unknown> | unknown,
): ToolDefinition {
  return {
    name,
    source: 'builtin',
    permissionLevel,
    inputSchema,
    execute: async (args) => await execute(args),
  };
}

export function createBuiltinToolDefinitions(
  options: BuiltinToolFactoryOptions = {},
): readonly ToolDefinition[] {
  return [
    createDefinition('read_file', 'L0', READ_FILE_INPUT_SCHEMA, async (args) => {
      return readFileSegment(parseReadFileRequest(args), {
        defaultLimit: options.readFileDefaultLimit,
        maxLimit: options.readFileMaxLimit,
      });
    }),
    createDefinition('write_file', 'L1', WRITE_FILE_INPUT_SCHEMA, async (args) => {
      return writeFileWithPolicy(parseWriteFileRequest(args));
    }),
    createDefinition('list_dir', 'L0', LIST_DIR_INPUT_SCHEMA, async (args) => {
      return listDirectory(parseListDirRequest(args));
    }),
    createDefinition('bash_execute', 'L2', BASH_EXECUTE_INPUT_SCHEMA, async (args) => {
      return await executeBashCommand(parseBashExecuteRequest(args), {
        defaultTimeoutMs: options.bashDefaultTimeoutMs,
        defaultMaxOutputBytes: options.bashDefaultMaxOutputBytes,
      });
    }),
    createDefinition('web_fetch', 'L3', WEB_FETCH_INPUT_SCHEMA, async (args) => {
      return await fetchWebContent(parseWebFetchRequest(args), {
        defaultTimeoutMs: options.webFetchDefaultTimeoutMs,
        defaultMaxBytes: options.webFetchDefaultMaxBytes,
        summarizer: options.webFetchSummarizer,
      });
    }),
  ];
}

export function registerBuiltinTools(
  dispatcher: ToolDispatcher,
  options: BuiltinToolFactoryOptions = {},
): readonly ToolDefinition[] {
  const tools = createBuiltinToolDefinitions(options);
  for (const tool of tools) {
    dispatcher.registerTool(tool);
  }
  return tools;
}
