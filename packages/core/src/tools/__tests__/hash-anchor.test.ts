import { describe, expect, it } from 'vitest';

import { EditConflictError, ToolExecutionError } from '../../errors/tool-errors.js';
import {
  applyHashAnchoredEdit,
  computeRangeHash,
  getRangeText,
  normalizeForHash,
  sha256,
} from '../hash-anchor.js';

describe('hash anchored edit', () => {
  it('normalizes CRLF before hashing', () => {
    const input = 'a\r\nb\r\n';
    expect(normalizeForHash(input)).toBe('a\nb\n');
    expect(sha256('a\nb')).toBe(sha256(normalizeForHash('a\r\nb')));
  });

  it('applies edit when expected hash matches', () => {
    const original = ['one', 'two', 'three'].join('\n');
    const range = { startLine: 2, endLine: 2 } as const;
    const expectedHash = computeRangeHash(original, range);

    const result = applyHashAnchoredEdit(original, {
      path: 'demo.txt',
      range,
      expectedHash,
      replacement: 'two-updated',
    });

    expect(result.content).toBe(['one', 'two-updated', 'three'].join('\n'));
    expect(result.actualHash).toBe(expectedHash);
  });

  it('throws EditConflictError when hash mismatches', () => {
    const original = ['one', 'two', 'three'].join('\n');

    expect(() =>
      applyHashAnchoredEdit(original, {
        path: 'demo.txt',
        range: { startLine: 2, endLine: 2 },
        expectedHash: 'sha256:deadbeef',
        replacement: 'two-updated',
      }),
    ).toThrowError(EditConflictError);
  });

  it('throws on invalid line range (startLine < 1)', () => {
    expect(() => getRangeText('one\ntwo', { startLine: 0, endLine: 1 })).toThrowError(
      ToolExecutionError,
    );
  });

  it('throws on invalid line range (endLine < startLine)', () => {
    expect(() => getRangeText('one\ntwo', { startLine: 2, endLine: 1 })).toThrowError(
      ToolExecutionError,
    );
  });

  it('throws on invalid line range (endLine > lines.length)', () => {
    expect(() => getRangeText('one\ntwo', { startLine: 1, endLine: 5 })).toThrowError(
      ToolExecutionError,
    );
  });

  it('preserves CRLF style after edit', () => {
    const original = ['one', 'two', 'three'].join('\r\n');
    const range = { startLine: 2, endLine: 2 } as const;
    const expectedHash = computeRangeHash(original, range);

    const result = applyHashAnchoredEdit(original, {
      path: 'demo.txt',
      range,
      expectedHash,
      replacement: 'two-updated',
    });

    expect(result.content).toBe(['one', 'two-updated', 'three'].join('\r\n'));
  });
});
