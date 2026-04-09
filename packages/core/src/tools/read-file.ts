import fs from 'node:fs';

import { ToolExecutionError } from '../errors/tool-errors.js';

export interface ReadFileRequest {
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface ReadFileOptions {
  readonly defaultLimit?: number;
  readonly maxLimit?: number;
}

export interface ReadFileResult {
  readonly path: string;
  readonly offset: number;
  readonly limit: number;
  readonly totalBytes: number;
  readonly readBytes: number;
  readonly truncated: boolean;
  readonly content: string;
}

const DEFAULT_LIMIT = 64 * 1024;
const MAX_LIMIT = 2 * 1024 * 1024;

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ToolExecutionError('read_file', `invalid offset: ${offset}`);
  }
  return offset;
}

function normalizeLimit(
  limit: number | undefined,
  options: ReadFileOptions,
): number {
  const defaultLimit = options.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = options.maxLimit ?? MAX_LIMIT;
  const normalized = limit ?? defaultLimit;

  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new ToolExecutionError('read_file', `invalid limit: ${normalized}`);
  }

  if (normalized > maxLimit) {
    throw new ToolExecutionError(
      'read_file',
      `limit exceeds max limit: ${normalized} > ${maxLimit}`,
    );
  }

  return normalized;
}

export function readFileSegment(
  request: ReadFileRequest,
  options: ReadFileOptions = {},
): ReadFileResult {
  const offset = normalizeOffset(request.offset);
  const limit = normalizeLimit(request.limit, options);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(request.path);
  } catch (error) {
    throw new ToolExecutionError('read_file', `stat failed: ${request.path}`, error);
  }

  if (!stat.isFile()) {
    throw new ToolExecutionError('read_file', `path is not a file: ${request.path}`);
  }

  const totalBytes = stat.size;
  const start = Math.min(offset, totalBytes);
  const bytesToRead = Math.max(0, Math.min(limit, totalBytes - start));

  const buffer = Buffer.alloc(bytesToRead);
  const fd = fs.openSync(request.path, 'r');
  try {
    if (bytesToRead > 0) {
      fs.readSync(fd, buffer, 0, bytesToRead, start);
    }
  } finally {
    fs.closeSync(fd);
  }

  return {
    path: request.path,
    offset: start,
    limit,
    totalBytes,
    readBytes: bytesToRead,
    truncated: start + bytesToRead < totalBytes,
    content: buffer.toString('utf8'),
  };
}
