import fs from 'node:fs';

import { ConfigNotFoundError, ConfigValidationError } from '../errors/config-errors.js';
import {
  EMBEDDED_PROVIDER_CATALOG,
  applyProviderCatalogUpdate,
  type CatalogMeta,
} from './catalog.js';

export interface LoadSourceResult {
  readonly source: string;
  readonly rawJson: string;
}

export async function loadProviderCatalogSource(source: string): Promise<LoadSourceResult> {
  if (source === 'embedded') {
    return {
      source,
      rawJson: JSON.stringify(EMBEDDED_PROVIDER_CATALOG),
    };
  }

  if (source.startsWith('http://') || source.startsWith('https://')) {
    if (typeof fetch !== 'function') {
      throw new ConfigValidationError('global fetch is not available in current runtime');
    }

    const response = await fetch(source);
    if (!response.ok) {
      throw new ConfigValidationError(`failed to download provider catalog: ${response.status}`);
    }

    const rawJson = await response.text();
    return { source, rawJson };
  }

  if (!fs.existsSync(source)) {
    throw new ConfigNotFoundError(source);
  }

  return {
    source,
    rawJson: fs.readFileSync(source, 'utf8'),
  };
}

export async function updateCatalogFromSource(options: {
  readonly source: string;
  readonly targetPath: string;
  readonly expectedChecksum?: string;
}): Promise<CatalogMeta> {
  const loaded = await loadProviderCatalogSource(options.source);
  return applyProviderCatalogUpdate({
    targetPath: options.targetPath,
    source: loaded.source,
    rawJson: loaded.rawJson,
    expectedChecksum: options.expectedChecksum,
  });
}
