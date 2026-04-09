import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ConfigNotFoundError, ConfigValidationError } from '../../errors/config-errors.js';
import {
  applyProviderCatalogUpdate,
  checksumOf,
  EMBEDDED_PROVIDER_CATALOG,
  parseProviderCatalog,
  readCatalogOrEmbedded,
  readProviderCatalog,
} from '../catalog.js';

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

describe('provider catalog', () => {
  it('parses valid catalog json', () => {
    const catalog = parseProviderCatalog(VALID_CATALOG);
    expect(catalog.version).toBe('2026.02.20');
    expect(catalog.providers[0]?.id).toBe('openai-main');
  });

  it('throws ConfigValidationError for invalid JSON', () => {
    expect(() => parseProviderCatalog('not-json{')).toThrowError(ConfigValidationError);
  });

  it('throws ConfigValidationError for invalid schema', () => {
    expect(() => parseProviderCatalog(JSON.stringify({ version: 'x' }))).toThrowError(
      ConfigValidationError,
    );
  });

  it('applies update atomically and writes meta', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-catalog-'));
    const target = path.join(root, 'catalog.json');

    const meta = applyProviderCatalogUpdate({
      targetPath: target,
      source: 'test',
      rawJson: VALID_CATALOG,
    });

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(`${target}.meta.json`)).toBe(true);
    expect(meta.checksum).toBe(checksumOf(VALID_CATALOG));

    const loaded = readProviderCatalog(target);
    expect(loaded.version).toBe('2026.02.20');
  });

  it('rejects checksum mismatch', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-catalog-'));
    const target = path.join(root, 'catalog.json');

    expect(() =>
      applyProviderCatalogUpdate({
        targetPath: target,
        source: 'test',
        rawJson: VALID_CATALOG,
        expectedChecksum: 'mismatch',
      }),
    ).toThrowError(ConfigValidationError);
  });

  it('throws ConfigNotFoundError when reading non-existent file directly', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-catalog-'));
    const target = path.join(root, 'not-exists.json');

    expect(() => readProviderCatalog(target)).toThrowError(ConfigNotFoundError);
  });

  it('falls back to embedded catalog when local file missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-catalog-'));
    const target = path.join(root, 'not-exists.json');

    const catalog = readCatalogOrEmbedded(target);
    expect(catalog).toEqual(EMBEDDED_PROVIDER_CATALOG);
  });

  it('reads existing catalog from disk via readCatalogOrEmbedded', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-catalog-'));
    const target = path.join(root, 'catalog.json');
    fs.writeFileSync(target, VALID_CATALOG, 'utf8');

    const catalog = readCatalogOrEmbedded(target);
    expect(catalog.version).toBe('2026.02.20');
  });
});
