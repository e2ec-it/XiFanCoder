import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ToolExecutionError } from '../../errors/tool-errors.js';
import { readFileSegment } from '../read-file.js';

describe('readFileSegment', () => {
  it('reads file segment with offset and limit', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-read-file-'));
    const filePath = path.join(root, 'demo.txt');
    fs.writeFileSync(filePath, '0123456789', 'utf8');

    const result = readFileSegment({
      path: filePath,
      offset: 2,
      limit: 4,
    });

    expect(result.content).toBe('2345');
    expect(result.readBytes).toBe(4);
    expect(result.truncated).toBe(true);
  });

  it('returns empty content when offset is beyond file size', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-read-file-empty-'));
    const filePath = path.join(root, 'demo.txt');
    fs.writeFileSync(filePath, 'abc', 'utf8');

    const result = readFileSegment({
      path: filePath,
      offset: 100,
      limit: 20,
    });

    expect(result.content).toBe('');
    expect(result.readBytes).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('rejects limit larger than maxLimit', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-read-file-limit-'));
    const filePath = path.join(root, 'demo.txt');
    fs.writeFileSync(filePath, 'abc', 'utf8');

    expect(() =>
      readFileSegment(
        {
          path: filePath,
          limit: 10,
        },
        { maxLimit: 8 },
      ),
    ).toThrowError(ToolExecutionError);
  });

  it('rejects invalid (negative) offset', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-read-file-neg-'));
    const filePath = path.join(root, 'demo.txt');
    fs.writeFileSync(filePath, 'abc', 'utf8');

    expect(() =>
      readFileSegment({ path: filePath, offset: -1 }),
    ).toThrowError('invalid offset');
  });

  it('rejects invalid (zero) limit', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-read-file-zero-'));
    const filePath = path.join(root, 'demo.txt');
    fs.writeFileSync(filePath, 'abc', 'utf8');

    expect(() =>
      readFileSegment({ path: filePath, limit: 0 }),
    ).toThrowError('invalid limit');
  });

  it('throws when path does not exist', () => {
    expect(() =>
      readFileSegment({ path: '/tmp/xifan-nonexistent-file-' + Date.now() }),
    ).toThrowError('stat failed');
  });

  it('throws when path is a directory not a file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-read-file-dir-'));
    expect(() =>
      readFileSegment({ path: root }),
    ).toThrowError('path is not a file');
  });
});
