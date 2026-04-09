import fs from 'node:fs';
import path from 'node:path';

import { ToolExecutionError } from '../errors/tool-errors.js';
import {
  applyHashAnchoredEdit,
  type HashAnchoredEditRequest,
  type LineRange,
} from './hash-anchor.js';

export interface LegacyWriteFileRequest {
  readonly path: string;
  readonly content: string;
  readonly mode?: WriteFileMode;
}

export interface HashAnchoredWriteFileRequest {
  readonly path: string;
  readonly range: LineRange;
  readonly expectedHash: string;
  readonly replacement: string;
}

export type WriteFileRequest = LegacyWriteFileRequest | HashAnchoredWriteFileRequest;
export type WriteFileMode = 'create' | 'overwrite' | 'append';

export interface WriteFileResult {
  readonly path: string;
  readonly mode: 'legacy' | 'hash_anchored';
  readonly writeMode?: WriteFileMode;
  readonly bytesWritten: number;
  readonly actualHash?: string;
}

export interface WriteFilePreview {
  readonly path: string;
  readonly mode: WriteFileMode;
  readonly beforeExists: boolean;
  readonly beforeContent: string;
  readonly afterContent: string;
  readonly diff: string;
}

function isHashAnchoredWriteFileRequest(
  request: WriteFileRequest,
): request is HashAnchoredWriteFileRequest {
  return (
    'expectedHash' in request &&
    'range' in request &&
    'replacement' in request
  );
}

function ensureParentDir(filePath: string): void {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
}

function toWriteMode(mode: WriteFileMode | undefined): WriteFileMode {
  return mode ?? 'overwrite';
}

function renderUnifiedDiff(filePath: string, beforeContent: string, afterContent: string): string {
  const beforeLines = beforeContent === '' ? [] : beforeContent.split('\n');
  const afterLines = afterContent === '' ? [] : afterContent.split('\n');

  const removed = beforeLines.map((line) => `-${line}`).join('\n');
  const added = afterLines.map((line) => `+${line}`).join('\n');
  const body = [removed, added].filter((chunk) => chunk.length > 0).join('\n');

  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    body,
  ].join('\n');
}

export function previewWriteFileChange(request: LegacyWriteFileRequest): WriteFilePreview {
  const mode = toWriteMode(request.mode);
  const beforeExists = fs.existsSync(request.path);
  const beforeContent = beforeExists ? fs.readFileSync(request.path, 'utf8') : '';

  if (mode === 'create' && beforeExists) {
    throw new ToolExecutionError('write_file', `file already exists: ${request.path}`);
  }

  const afterContent = mode === 'append'
    ? `${beforeContent}${request.content}`
    : request.content;

  return {
    path: request.path,
    mode,
    beforeExists,
    beforeContent,
    afterContent,
    diff: renderUnifiedDiff(request.path, beforeContent, afterContent),
  };
}

export function writeFileWithPolicy(request: WriteFileRequest): WriteFileResult {
  if (isHashAnchoredWriteFileRequest(request)) {
    if (!fs.existsSync(request.path)) {
      throw new ToolExecutionError('write_file', `file not found: ${request.path}`);
    }

    const existing = fs.readFileSync(request.path, 'utf8');
    const editRequest: HashAnchoredEditRequest = {
      path: request.path,
      range: request.range,
      expectedHash: request.expectedHash,
      replacement: request.replacement,
    };
    const result = applyHashAnchoredEdit(existing, editRequest);
    fs.writeFileSync(request.path, result.content, 'utf8');
    return {
      path: request.path,
      mode: 'hash_anchored',
      bytesWritten: Buffer.byteLength(result.content, 'utf8'),
      actualHash: result.actualHash,
    };
  }

  const preview = previewWriteFileChange(request);
  ensureParentDir(request.path);
  fs.writeFileSync(request.path, preview.afterContent, 'utf8');
  return {
    path: request.path,
    mode: 'legacy',
    writeMode: preview.mode,
    bytesWritten: Buffer.byteLength(preview.afterContent, 'utf8'),
  };
}
