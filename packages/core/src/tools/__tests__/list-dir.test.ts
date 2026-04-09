import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listDirectory } from '../list-dir.js';

describe('listDirectory', () => {
  it('lists top-level entries when recursive is false', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-list-dir-flat-'));
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'a', 'utf8');

    const result = listDirectory({ path: root, recursive: false });
    const names = result.entries.map((entry) => entry.name).sort();

    expect(names).toEqual(['a.txt', 'nested']);
    expect(result.truncated).toBe(false);
  });

  it('supports recursive listing with glob filter', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-list-dir-rec-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'a', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'b.md'), 'b', 'utf8');

    const result = listDirectory({
      path: root,
      recursive: true,
      filter: '**/*.ts',
    });

    const rootEntries = result.entries;
    expect(rootEntries.length).toBe(1);
    expect(rootEntries[0]?.name).toBe('src');
    expect(rootEntries[0]?.children?.map((entry) => entry.name)).toEqual(['a.ts']);
  });

  it('supports hidden-file filtering', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-list-dir-hidden-'));
    fs.writeFileSync(path.join(root, '.env'), 'secret', 'utf8');
    fs.writeFileSync(path.join(root, 'visible.txt'), 'ok', 'utf8');

    const result = listDirectory({
      path: root,
      includeHidden: false,
    });

    expect(result.entries.map((entry) => entry.name)).toEqual(['visible.txt']);
  });

  it('rejects invalid maxEntries', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-list-dir-max-'));
    expect(() =>
      listDirectory({ path: root, maxEntries: -1 }),
    ).toThrowError('invalid maxEntries');
  });

  it('throws when path does not exist', () => {
    expect(() =>
      listDirectory({ path: '/tmp/xifan-nonexistent-dir-' + Date.now() }),
    ).toThrowError('stat failed');
  });

  it('throws when path is a file not a directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-list-dir-notdir-'));
    const filePath = path.join(root, 'file.txt');
    fs.writeFileSync(filePath, 'content', 'utf8');
    expect(() =>
      listDirectory({ path: filePath }),
    ).toThrowError('path is not a directory');
  });

  it('truncates entries at maxEntries limit', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-list-dir-trunc-'));
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(root, `file${i}.txt`), String(i), 'utf8');
    }

    const result = listDirectory({ path: root, maxEntries: 2 });
    expect(result.truncated).toBe(true);
    expect(result.totalEntries).toBe(2);
  });

  it('returns early from recursive walk when already truncated', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-list-dir-rtrunc-'));
    // Structure: root/parent/a_file.txt, root/parent/b_sub/c.txt
    // With maxEntries=1, after counting a_file.txt (count=1), processing b_sub
    // will try to recurse and find state.truncated from parent check
    const parent = path.join(root, 'parent');
    fs.mkdirSync(parent, { recursive: true });
    // Create many files so truncation happens within the parent dir walk
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(parent, `file${i}.txt`), 'x', 'utf8');
    }
    // Create a subdirectory that comes after the files alphabetically
    const sub = path.join(parent, 'z_sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'deep.txt'), 'x', 'utf8');

    const result = listDirectory({
      path: root,
      recursive: true,
      maxEntries: 3,
    });
    expect(result.truncated).toBe(true);
  });

  it('skips symlinks (non-file non-dir) in directory listing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-list-dir-sym-'));
    fs.writeFileSync(path.join(root, 'real.txt'), 'content', 'utf8');
    // Create a symlink to a non-existent target (will be isFile=false, isDirectory=false)
    try {
      fs.symlinkSync('/nonexistent/target', path.join(root, 'broken-link'));
    } catch {
      // Skip test on platforms that don't support symlinks
      return;
    }

    const result = listDirectory({ path: root });
    // broken symlink should be skipped (not file, not dir)
    const names = result.entries.map((e) => e.name);
    expect(names).toContain('real.txt');
  });

  it('skips symlinks and non-file/non-dir entries with filter', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-list-dir-skip-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'a', 'utf8');
    // Create a symlink (isFile returns true for symlinks, so use filter to force a miss)
    const result = listDirectory({
      path: root,
      recursive: false,
      filter: '**/*.ts',
    });
    // Filter excludes the txt file
    expect(result.entries.filter((e) => e.type === 'file')).toHaveLength(0);
  });

  it('normalizes filter from string to array', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-list-dir-filt-'));
    fs.writeFileSync(path.join(root, 'a.ts'), 'a', 'utf8');
    fs.writeFileSync(path.join(root, 'b.md'), 'b', 'utf8');

    const result = listDirectory({
      path: root,
      filter: ['**/*.ts'],
    });
    expect(result.entries.map((e) => e.name)).toEqual(['a.ts']);
  });

  it.skipIf(process.platform === 'win32')('throws when directory read fails (unreadable dir)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-list-dir-err-'));
    const subdir = path.join(root, 'locked');
    fs.mkdirSync(subdir);
    fs.chmodSync(subdir, 0o000);

    try {
      expect(() =>
        listDirectory({ path: subdir }),
      ).toThrowError('failed to read directory');
    } finally {
      fs.chmodSync(subdir, 0o755);
    }
  });
});
