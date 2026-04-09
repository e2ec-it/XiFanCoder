import { z } from 'zod';

import type {
  DiscoveredPluginManifest,
  PluginManifest,
  PluginSource,
  ToolPermissionLevel,
} from './types.js';

export class PluginManifestError extends Error {
  constructor(message: string, readonly causeValue?: unknown) {
    super(message);
    this.name = 'PluginManifestError';
  }
}

const PluginTypeSchema = z.enum(['stdio', 'node', 'python']);
const ToolPermissionLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

const RawPluginManifestSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9-]+$/, 'plugin name must match ^[a-z0-9-]+$'),
    version: z.string().min(1).default('0.0.0'),
    description: z.string().default(''),
    type: PluginTypeSchema,
    command: z.string().min(1).optional(),
    args: z.array(z.string().min(1)).default([]),
    module: z.string().min(1).optional(),
    enabled: z.boolean().default(true),
    requireConfirmation: z.boolean().default(false),
    permissionLevel: ToolPermissionLevelSchema.default(1),
    env: z.record(z.string()).default({}),
    timeout: z.number().int().positive().default(30_000),
    cpuTimeLimitMs: z.number().int().positive().default(5_000),
    maxMemoryMb: z.number().int().positive().default(512),
    sanitizeEnv: z.boolean().default(true),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.type === 'stdio' && !value.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'stdio plugin requires command',
      });
    }
    if ((value.type === 'node' || value.type === 'python') && !value.module) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.type} plugin requires module`,
      });
    }
    if (value.permissionLevel === 3 && value.requireConfirmation !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'permissionLevel=3 requires requireConfirmation=true',
      });
    }
  });

export function parsePluginManifest(input: unknown): PluginManifest {
  const parsed = RawPluginManifestSchema.parse(input);
  const permissionLevel = parsed.permissionLevel as ToolPermissionLevel;

  return {
    name: parsed.name,
    version: parsed.version,
    description: parsed.description,
    type: parsed.type,
    command: parsed.command,
    args: parsed.args,
    module: parsed.module,
    enabled: parsed.enabled,
    requireConfirmation: parsed.requireConfirmation,
    permissionLevel,
    env: parsed.env,
    timeout: parsed.timeout,
    cpuTimeLimitMs: parsed.cpuTimeLimitMs,
    maxMemoryMb: parsed.maxMemoryMb,
    sanitizeEnv: parsed.sanitizeEnv,
  };
}

export function parseDiscoveredPluginManifest(
  source: PluginSource,
  input: unknown,
): DiscoveredPluginManifest {
  const manifest = parsePluginManifest(input);
  return {
    ...manifest,
    source,
  };
}

const ExplicitPluginConfigSchema = z
  .object({
    plugins: z.array(z.unknown()).default([]),
  })
  .passthrough();

export function parseExplicitPluginsConfig(input: unknown): readonly unknown[] {
  const parsed = ExplicitPluginConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new PluginManifestError('invalid plugins config format', parsed.error);
  }
  return parsed.data.plugins;
}
