import { z } from 'zod';

export const AgentModeSchema = z.enum(['build', 'plan']);
export const PolicyModeSchema = z.enum(['compat', 'strict']);
export const LLMDriverModeSchema = z.enum(['auto', 'builtin', 'litellm']);
export const InjectionDetectionModeSchema = z.enum(['off', 'warn', 'block']);
export const McpTransportSchema = z.enum(['stdio']);

const CrushMcpServerSchema = z
  .object({
    enabled: z.boolean().default(true),
    transport: McpTransportSchema.default('stdio'),
    command: z.string().min(1).default('crush'),
    args: z.array(z.string().min(1)).default(['--mcp-server']),
  })
  .default({});

export const RuntimeConfigSchema = z.object({
  agent: z
    .object({
      mode: AgentModeSchema.default('build'),
      maxRounds: z.number().int().positive().default(50),
      continuation: z
        .object({
          enabled: z.boolean().default(true),
        })
        .default({}),
    })
    .default({}),
  permissions: z
    .object({
      headless: z.boolean().default(false),
      allowWrite: z.boolean().default(false),
      allowShell: z.boolean().default(false),
      allowDangerous: z.boolean().default(false),
      policyMode: PolicyModeSchema.default('compat'),
      allowedTools: z.array(z.string().min(1)).default([]),
      deniedTools: z.array(z.string().min(1)).default([]),
    })
    .default({}),
  providers: z
    .object({
      catalogSource: z.string().min(1).default('embedded'),
      catalogPath: z.string().min(1).default('~/.xifan/coder/providers/catalog.json'),
    })
    .default({}),
  skills: z
    .object({
      enabled: z.boolean().default(true),
      roots: z.array(z.string().min(1)).default(['~/.xifan/coder/skills', './.xifan/coder/skills']),
    })
    .default({}),
  lsp: z
    .object({
      enabled: z.boolean().default(true),
      languages: z.array(z.string().min(1)).default(['typescript', 'javascript']),
    })
    .default({}),
  security: z
    .object({
      promptInjection: z
        .object({
          mode: InjectionDetectionModeSchema.default('warn'),
        })
        .default({}),
    })
    .default({}),
  llm: z
    .object({
      driver: LLMDriverModeSchema.default('auto'),
      litellmBaseUrl: z.string().url().default('http://localhost:4000'),
    })
    .default({}),
  mcpServers: z
    .object({
      crush: CrushMcpServerSchema,
    })
    .default({}),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  return RuntimeConfigSchema.parse(normalizeRuntimeConfigInput(input));
}

function normalizeRuntimeConfigInput(input: unknown): unknown {
  if (!isPlainObject(input)) {
    return input ?? {};
  }

  const normalized: Record<string, unknown> = { ...input };
  if (normalized.mcpServers === undefined && normalized.mcp_servers !== undefined) {
    normalized.mcpServers = normalized.mcp_servers;
  }
  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
