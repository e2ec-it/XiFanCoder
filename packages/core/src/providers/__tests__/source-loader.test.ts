import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigNotFoundError, ConfigValidationError } from '../../errors/config-errors.js';
import {
  loadProviderCatalogSource,
  updateCatalogFromSource,
} from '../source-loader.js';

const VALID_CATALOG = JSON.stringify({
  version: '2026.02.20',
  updatedAt: '2026-02-20T00:00:00.000Z',
  providers: [
    {
      id: 'openai-main',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [{ id: 'gpt-4o' }],
    },
  ],
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('provider source loader', () => {
  it('loads embedded source', async () => {
    const result = await loadProviderCatalogSource('embedded');
    expect(result.source).toBe('embedded');
    expect(result.rawJson).toContain('providers');
  });

  it('loads from local file path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-provider-file-'));
    const file = path.join(root, 'catalog.json');
    fs.writeFileSync(file, VALID_CATALOG, 'utf8');

    const result = await loadProviderCatalogSource(file);
    expect(result.source).toBe(file);
    expect(result.rawJson).toBe(VALID_CATALOG);
  });

  it('throws ConfigNotFoundError for missing file', async () => {
    await expect(loadProviderCatalogSource('/tmp/not-exist-catalog.json')).rejects.toThrowError(
      ConfigNotFoundError,
    );
  });

  it('loads from url via fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => VALID_CATALOG,
      })) as unknown as typeof fetch,
    );

    const result = await loadProviderCatalogSource('https://example.com/catalog.json');
    expect(result.source).toBe('https://example.com/catalog.json');
    expect(result.rawJson).toBe(VALID_CATALOG);
  });

  it('throws ConfigValidationError when global fetch is not available', async () => {
    const originalFetch = globalThis.fetch;
    // @ts-expect-error -- deliberately removing fetch to test fallback
    globalThis.fetch = undefined;

    try {
      await expect(
        loadProviderCatalogSource('https://example.com/catalog.json'),
      ).rejects.toThrowError('global fetch is not available');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws ConfigValidationError when url fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
      })) as unknown as typeof fetch,
    );

    await expect(
      loadProviderCatalogSource('https://example.com/catalog.json'),
    ).rejects.toThrowError(ConfigValidationError);
  });

  it('updates catalog directly from source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => VALID_CATALOG,
      })) as unknown as typeof fetch,
    );

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-provider-target-'));
    const targetPath = path.join(root, 'catalog.json');

    const meta = await updateCatalogFromSource({
      source: 'https://example.com/catalog.json',
      targetPath,
    });

    expect(meta.version).toBe('2026.02.20');
    expect(fs.existsSync(targetPath)).toBe(true);
    expect(fs.existsSync(`${targetPath}.meta.json`)).toBe(true);
  });
});
