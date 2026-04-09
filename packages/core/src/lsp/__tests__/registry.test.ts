import { describe, expect, it } from 'vitest';

import { LSPRegistry } from '../registry.js';
import type { LSPClient } from '../types.js';

const mockClient: LSPClient = {
  language: 'typescript',
  diagnostics: async () => [
    {
      message: 'unused variable',
      severity: 'warning',
      range: {
        startLine: 1,
        startCharacter: 1,
        endLine: 1,
        endCharacter: 5,
      },
    },
  ],
  workspaceSymbols: async () => [
    {
      name: 'myFunction',
      kind: 'Function',
      filePath: 'src/index.ts',
      range: {
        startLine: 1,
        startCharacter: 1,
        endLine: 1,
        endCharacter: 10,
      },
    },
  ],
  references: async () => [
    {
      filePath: 'src/index.ts',
      range: {
        startLine: 2,
        startCharacter: 1,
        endLine: 2,
        endCharacter: 10,
      },
    },
  ],
  renamePreview: async () => [
    {
      filePath: 'src/index.ts',
      range: {
        startLine: 1,
        startCharacter: 1,
        endLine: 1,
        endCharacter: 10,
      },
      newText: 'renamed',
    },
  ],
};

describe('LSPRegistry', () => {
  it('returns unavailable when language is not registered', async () => {
    const registry = new LSPRegistry();

    const result = await registry.diagnostics('typescript', 'src/a.ts', 'const a = 1;');
    expect(result.available).toBe(false);
  });

  it('returns diagnostics from registered client', async () => {
    const registry = new LSPRegistry();
    registry.register(mockClient);

    const result = await registry.diagnostics('typescript', 'src/a.ts', 'const a = 1;');
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.data[0]?.message).toBe('unused variable');
    }
  });

  it('supports unregister and has', () => {
    const registry = new LSPRegistry();
    registry.register(mockClient);
    expect(registry.has('typescript')).toBe(true);

    registry.unregister('typescript');
    expect(registry.has('typescript')).toBe(false);
  });

  it('returns unavailable for workspaceSymbols when not registered', async () => {
    const registry = new LSPRegistry();
    const result = await registry.workspaceSymbols('python', 'test');
    expect(result.available).toBe(false);
  });

  it('returns unavailable for references when not registered', async () => {
    const registry = new LSPRegistry();
    const result = await registry.references('python', 'a.py', { line: 1, character: 1 });
    expect(result.available).toBe(false);
  });

  it('returns unavailable for renamePreview when not registered', async () => {
    const registry = new LSPRegistry();
    const result = await registry.renamePreview('python', 'a.py', { line: 1, character: 1 }, 'new');
    expect(result.available).toBe(false);
  });

  it('returns symbols/references/rename preview', async () => {
    const registry = new LSPRegistry();
    registry.register(mockClient);

    const symbols = await registry.workspaceSymbols('typescript', 'my');
    expect(symbols.available).toBe(true);
    if (symbols.available) {
      expect(symbols.data[0]?.name).toBe('myFunction');
    }

    const refs = await registry.references('typescript', 'src/a.ts', { line: 1, character: 1 });
    expect(refs.available).toBe(true);
    if (refs.available) {
      expect(refs.data[0]?.filePath).toBe('src/index.ts');
    }

    const rename = await registry.renamePreview(
      'typescript',
      'src/a.ts',
      { line: 1, character: 1 },
      'renamed',
    );
    expect(rename.available).toBe(true);
    if (rename.available) {
      expect(rename.data[0]?.newText).toBe('renamed');
    }
  });
});
