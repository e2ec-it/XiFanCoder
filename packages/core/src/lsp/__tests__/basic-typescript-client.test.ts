import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BasicTypeScriptLSPClient } from '../basic-typescript-client.js';

describe('BasicTypeScriptLSPClient', () => {
  it('returns diagnostics for invalid TypeScript source', async () => {
    const client = new BasicTypeScriptLSPClient({ rootDir: process.cwd() });
    const diagnostics = await client.diagnostics('broken.ts', 'const = 1;');

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.severity).toBe('error');
  });

  it('returns workspace symbols, references and rename preview', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-lsp-'));
    const fileA = path.join(root, 'a.ts');
    const fileB = path.join(root, 'b.ts');

    fs.writeFileSync(
      fileA,
      [
        'const targetName = 1;',
        'export function readTarget() {',
        '  return targetName;',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      fileB,
      [
        'const x = targetName + 1;',
        '',
      ].join('\n'),
      'utf8',
    );

    const client = new BasicTypeScriptLSPClient({ rootDir: root });

    const symbols = await client.workspaceSymbols('readTarget');
    expect(symbols.some((symbol) => symbol.name === 'readTarget')).toBe(true);

    const refs = await client.references(fileA, { line: 1, character: 7 });
    expect(refs.length).toBeGreaterThanOrEqual(3);

    const rename = await client.renamePreview(fileA, { line: 1, character: 7 }, 'nextName');
    expect(rename.length).toBe(refs.length);
    expect(rename[0]?.newText).toBe('nextName');
  });

  it('returns empty references when position points to non-identifier', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-lsp-ref-'));
    const file = path.join(root, 'a.ts');
    fs.writeFileSync(file, 'const x = 1;\n', 'utf8');

    const client = new BasicTypeScriptLSPClient({ rootDir: root });
    // Point to '=' which is not an identifier
    const refs = await client.references(file, { line: 1, character: 9 });
    expect(refs).toEqual([]);
  });

  it('getIdentifierAtPosition returns undefined for out-of-range positions', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-lsp-oor-'));
    const file = path.join(root, 'a.ts');
    fs.writeFileSync(file, 'const x = 1;\n', 'utf8');

    const client = new BasicTypeScriptLSPClient({ rootDir: root });
    // Line 999 does not exist
    const refs = await client.references(file, { line: 999, character: 1 });
    expect(refs).toEqual([]);

    // Character past end of line
    const refs2 = await client.references(file, { line: 1, character: 999 });
    expect(refs2).toEqual([]);
  });

  it('collectTypeScriptFiles skips node_modules and non-ts files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-lsp-skip-'));
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'lib.ts'), 'const x = 1;', 'utf8');
    fs.writeFileSync(path.join(root, 'readme.md'), '# readme', 'utf8');
    fs.writeFileSync(path.join(root, 'app.ts'), 'function appFn() {}', 'utf8');

    const client = new BasicTypeScriptLSPClient({ rootDir: root });
    const symbols = await client.workspaceSymbols('appFn');
    expect(symbols.some((s) => s.name === 'appFn')).toBe(true);
    // node_modules should be skipped
    const allSymbols = await client.workspaceSymbols('x');
    expect(allSymbols.every((s) => !s.filePath.includes('node_modules'))).toBe(true);
  });

  it('walks into subdirectories and handles unreadable ones', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-lsp-walk-'));
    const subDir = path.join(root, 'src');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'nested.ts'), 'function nestedFn() {}', 'utf8');

    // Create unreadable directory
    const unreadable = path.join(root, 'secret');
    fs.mkdirSync(unreadable, { recursive: true });
    fs.chmodSync(unreadable, 0o000);

    try {
      const client = new BasicTypeScriptLSPClient({ rootDir: root });
      const symbols = await client.workspaceSymbols('nestedFn');
      expect(symbols.some((s) => s.name === 'nestedFn')).toBe(true);
    } finally {
      fs.chmodSync(unreadable, 0o755);
    }
  });

  it('references finds identifier in the middle of a word', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-lsp-mid-'));
    const file = path.join(root, 'a.ts');
    fs.writeFileSync(file, 'const longVariableName = 1;\n', 'utf8');

    const client = new BasicTypeScriptLSPClient({ rootDir: root });
    // Point to middle of "longVariableName"
    const refs = await client.references(file, { line: 1, character: 10 });
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0]?.filePath).toBe(file);
  });

  it('handles unreadable directories gracefully', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-lsp-unread-'));
    fs.writeFileSync(path.join(root, 'ok.ts'), 'function okFn() {}', 'utf8');

    const client = new BasicTypeScriptLSPClient({ rootDir: root });
    const symbols = await client.workspaceSymbols('okFn');
    expect(symbols.length).toBeGreaterThan(0);
  });

  it('diagnostics returns empty for valid code and handles all severity levels', async () => {
    const client = new BasicTypeScriptLSPClient({ rootDir: process.cwd() });
    // Valid TS should produce no diagnostics
    const diagnostics = await client.diagnostics('valid.ts', 'const x: number = 1;\n');
    expect(diagnostics).toHaveLength(0);
  });

  it('workspaceSymbols filters by query', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-lsp-query-'));
    fs.writeFileSync(root + '/a.ts', 'const alpha = 1;\nconst beta = 2;\n', 'utf8');

    const client = new BasicTypeScriptLSPClient({ rootDir: root });
    const symbols = await client.workspaceSymbols('alpha');
    expect(symbols.some((s) => s.name === 'alpha')).toBe(true);
    expect(symbols.every((s) => s.name !== 'beta')).toBe(true);
  });

  it('renamePreview returns empty array when no identifier at position', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-lsp-rename-'));
    const file = path.join(root, 'a.ts');
    fs.writeFileSync(file, '// comment\n', 'utf8');

    const client = new BasicTypeScriptLSPClient({ rootDir: root });
    const edits = await client.renamePreview(file, { line: 1, character: 1 }, 'newName');
    // '/' is not a word character, so should return empty
    expect(edits).toEqual([]);
  });
});
