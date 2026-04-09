import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EditConflictError } from '../../errors/tool-errors.js';
import { computeRangeHash } from '../hash-anchor.js';
import { previewWriteFileChange, writeFileWithPolicy } from '../write-file.js';

describe('writeFileWithPolicy', () => {
  it('supports legacy payload and creates parent directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-write-legacy-'));
    const filePath = path.join(root, 'nested', 'demo.txt');

    const result = writeFileWithPolicy({
      path: filePath,
      content: 'hello',
    });

    expect(result.mode).toBe('legacy');
    expect(result.writeMode).toBe('overwrite');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('hello');
  });

  it('supports create and append modes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-write-mode-'));
    const filePath = path.join(root, 'demo.txt');

    const created = writeFileWithPolicy({
      path: filePath,
      content: 'first line\n',
      mode: 'create',
    });
    expect(created.writeMode).toBe('create');

    const appended = writeFileWithPolicy({
      path: filePath,
      content: 'second line\n',
      mode: 'append',
    });

    expect(appended.writeMode).toBe('append');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('first line\nsecond line\n');
  });

  it('builds diff preview before writing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-write-preview-'));
    const filePath = path.join(root, 'demo.txt');
    fs.writeFileSync(filePath, 'before', 'utf8');

    const preview = previewWriteFileChange({
      path: filePath,
      content: 'after',
      mode: 'overwrite',
    });

    expect(preview.beforeExists).toBe(true);
    expect(preview.beforeContent).toBe('before');
    expect(preview.afterContent).toBe('after');
    expect(preview.diff).toContain('--- a/');
    expect(preview.diff).toContain('+++ b/');
  });

  it('throws when create mode targets existing file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-write-create-exist-'));
    const filePath = path.join(root, 'existing.txt');
    fs.writeFileSync(filePath, 'already here', 'utf8');

    expect(() =>
      previewWriteFileChange({
        path: filePath,
        content: 'new content',
        mode: 'create',
      }),
    ).toThrowError('file already exists');
  });

  it('throws when hash anchored write targets non-existent file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-write-nofile-'));
    const filePath = path.join(root, 'missing.txt');

    expect(() =>
      writeFileWithPolicy({
        path: filePath,
        range: { startLine: 1, endLine: 1 },
        expectedHash: 'sha256:abc',
        replacement: 'new',
      }),
    ).toThrowError('file not found');
  });

  it('handles diff for empty before content', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-write-empty-'));
    const filePath = path.join(root, 'new-file.txt');

    const preview = previewWriteFileChange({
      path: filePath,
      content: 'hello',
      mode: 'overwrite',
    });

    expect(preview.beforeExists).toBe(false);
    expect(preview.beforeContent).toBe('');
    expect(preview.diff).toContain('+hello');
  });

  it('applies hash anchored edit payload', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-write-anchored-'));
    const filePath = path.join(root, 'demo.txt');
    fs.writeFileSync(filePath, ['one', 'two', 'three'].join('\n'), 'utf8');

    const expectedHash = computeRangeHash(fs.readFileSync(filePath, 'utf8'), {
      startLine: 2,
      endLine: 2,
    });

    const result = writeFileWithPolicy({
      path: filePath,
      range: { startLine: 2, endLine: 2 },
      expectedHash,
      replacement: 'two-updated',
    });

    expect(result.mode).toBe('hash_anchored');
    expect(result.actualHash).toBe(expectedHash);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(['one', 'two-updated', 'three'].join('\n'));
  });

  it('returns edit conflict with expected/actual hash', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-write-conflict-'));
    const filePath = path.join(root, 'demo.txt');
    fs.writeFileSync(filePath, ['one', 'two', 'three'].join('\n'), 'utf8');

    let err: unknown;
    try {
      writeFileWithPolicy({
        path: filePath,
        range: { startLine: 2, endLine: 2 },
        expectedHash: 'sha256:deadbeef',
        replacement: 'two-updated',
      });
    } catch (error) {
      err = error;
    }

    expect(err).toBeInstanceOf(EditConflictError);
    if (err instanceof EditConflictError) {
      expect(err.expectedHash).toBe('sha256:deadbeef');
      expect(err.actualHash.startsWith('sha256:')).toBe(true);
    }
  });
});
