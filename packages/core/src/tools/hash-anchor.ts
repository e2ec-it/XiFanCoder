import { createHash } from 'node:crypto';

import { EditConflictError, ToolExecutionError } from '../errors/tool-errors.js';

export interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

export interface HashAnchoredEditRequest {
  readonly path: string;
  readonly range: LineRange;
  readonly expectedHash: string;
  readonly replacement: string;
}

export interface HashAnchoredEditResult {
  readonly content: string;
  readonly actualHash: string;
}

export function normalizeForHash(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export function sha256(content: string): string {
  const hash = createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

export function getRangeText(content: string, range: LineRange): string {
  const normalized = normalizeForHash(content);
  const lines = normalized.split('\n');

  if (range.startLine < 1 || range.endLine < range.startLine || range.endLine > lines.length) {
    throw new ToolExecutionError(
      'write_file',
      `invalid line range: ${range.startLine}-${range.endLine}`,
    );
  }

  return lines.slice(range.startLine - 1, range.endLine).join('\n');
}

export function computeRangeHash(content: string, range: LineRange): string {
  return sha256(getRangeText(content, range));
}

export function applyHashAnchoredEdit(
  content: string,
  request: HashAnchoredEditRequest,
): HashAnchoredEditResult {
  const normalized = normalizeForHash(content);
  const actualHash = computeRangeHash(normalized, request.range);

  if (actualHash !== request.expectedHash) {
    throw new EditConflictError(request.path, request.expectedHash, actualHash);
  }

  const lines = normalized.split('\n');
  const replacementNormalized = normalizeForHash(request.replacement);
  const replacementLines = replacementNormalized.length > 0 ? replacementNormalized.split('\n') : [];

  lines.splice(
    request.range.startLine - 1,
    request.range.endLine - request.range.startLine + 1,
    ...replacementLines,
  );

  const outputEol = content.includes('\r\n') ? '\r\n' : '\n';
  const nextContent = lines.join('\n');
  const resultContent = outputEol === '\n' ? nextContent : nextContent.replace(/\n/g, '\r\n');

  return {
    content: resultContent,
    actualHash,
  };
}
