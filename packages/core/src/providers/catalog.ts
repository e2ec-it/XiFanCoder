import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { ConfigNotFoundError, ConfigValidationError } from '../errors/config-errors.js';

const ModelSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
});

const ProviderSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['openai', 'anthropic', 'ollama', 'openai_compat']),
  baseUrl: z.string().url().optional(),
  models: z.array(ModelSchema).min(1),
});

const CatalogSchema = z.object({
  version: z.string().min(1),
  updatedAt: z.string().min(1),
  providers: z.array(ProviderSchema).min(1),
});

export type ProviderCatalog = z.infer<typeof CatalogSchema>;

export interface CatalogMeta {
  readonly version: string;
  readonly source: string;
  readonly checksum: string;
  readonly updatedAt: string;
  readonly appliedAt: string;
}

export const EMBEDDED_PROVIDER_CATALOG: ProviderCatalog = {
  version: 'embedded-0',
  updatedAt: '1970-01-01T00:00:00.000Z',
  providers: [
    {
      id: 'openai-default',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [
        { id: 'gpt-4o', displayName: 'GPT-4o' },
      ],
    },
  ],
};

export function parseProviderCatalog(rawJson: string): ProviderCatalog {
  let input: unknown;
  try {
    input = JSON.parse(rawJson);
  } catch (error) {
    throw new ConfigValidationError('provider catalog is not valid JSON', error);
  }

  const result = CatalogSchema.safeParse(input);
  if (!result.success) {
    const validationErrors = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    throw new ConfigValidationError(validationErrors);
  }

  return result.data;
}

export function checksumOf(rawJson: string): string {
  return createHash('sha256').update(rawJson).digest('hex');
}

export function readProviderCatalog(catalogPath: string): ProviderCatalog {
  if (!fs.existsSync(catalogPath)) {
    throw new ConfigNotFoundError(catalogPath);
  }

  const raw = fs.readFileSync(catalogPath, 'utf8');
  return parseProviderCatalog(raw);
}

export function readCatalogOrEmbedded(catalogPath: string): ProviderCatalog {
  if (!fs.existsSync(catalogPath)) {
    return EMBEDDED_PROVIDER_CATALOG;
  }
  return readProviderCatalog(catalogPath);
}

export function applyProviderCatalogUpdate(options: {
  readonly targetPath: string;
  readonly source: string;
  readonly rawJson: string;
  readonly expectedChecksum?: string;
}): CatalogMeta {
  const catalog = parseProviderCatalog(options.rawJson);
  const checksum = checksumOf(options.rawJson);

  if (options.expectedChecksum && options.expectedChecksum !== checksum) {
    throw new ConfigValidationError(
      `provider catalog checksum mismatch: expected=${options.expectedChecksum} actual=${checksum}`,
    );
  }

  const dir = path.dirname(options.targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const tempPath = `${options.targetPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, options.targetPath);

  const meta: CatalogMeta = {
    version: catalog.version,
    source: options.source,
    checksum,
    updatedAt: catalog.updatedAt,
    appliedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    `${options.targetPath}.meta.json`,
    JSON.stringify(meta, null, 2) + '\n',
    'utf8',
  );

  return meta;
}
