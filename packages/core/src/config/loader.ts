import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cosmiconfigSync } from 'cosmiconfig';

import { ConfigNotFoundError, ConfigValidationError } from '../errors/config-errors.js';
import { parseRuntimeConfig, type RuntimeConfig } from './runtime-config.js';
import {
  assertNoPlaintextSecrets,
  resolveAPISecrets,
  sanitizeConfigForSerialization,
  type KeychainAdapter,
  type ResolvedAPISecrets,
} from './secrets.js';

export interface RuntimeConfigLoadOptions {
  readonly configPath?: string;
  readonly cwd?: string;
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly keychain?: KeychainAdapter;
  readonly cliOverrides?: RuntimeConfigOverride;
}

export interface LoadedRuntimeConfig {
  readonly config: RuntimeConfig;
  readonly sanitizedConfig: RuntimeConfig;
  readonly secrets: ResolvedAPISecrets;
  readonly configPath?: string;
  readonly sourcePaths: readonly string[];
}

export interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
}

export interface InitRuntimeConfigOptions {
  readonly targetPath: string;
  readonly force?: boolean;
}

export interface InitRuntimeConfigResult {
  readonly targetPath: string;
  readonly created: boolean;
  readonly overwritten: boolean;
}

export type RuntimeConfigOverride = DeepPartial<RuntimeConfig>;

const CONFIG_CANDIDATE_NAMES = ['config.yaml', 'config.yml', 'config.json'] as const;
const CONFIG_SEARCH_PLACES = CONFIG_CANDIDATE_NAMES.map((name) => path.join('.xifan', 'coder', name));

export function createKeytarAdapter(keytar: KeytarLike): KeychainAdapter {
  return {
    getPassword: (service: string, account: string): Promise<string | null> =>
      keytar.getPassword(service, account),
  };
}

export async function loadRuntimeConfig(options: RuntimeConfigLoadOptions): Promise<LoadedRuntimeConfig> {
  const env = options.env ?? process.env;
  const sourcePaths: string[] = [];
  const layers: unknown[] = [];

  if (options.configPath) {
    if (!fs.existsSync(options.configPath)) {
      throw new ConfigNotFoundError(options.configPath);
    }
    layers.push(loadConfigFile(options.configPath));
    sourcePaths.push(options.configPath);
  } else {
    const discovered = discoverRuntimeConfigPaths({
      cwd: options.cwd,
      homeDir: options.homeDir,
    });
    for (const configPath of discovered) {
      layers.push(loadConfigFile(configPath));
      sourcePaths.push(configPath);
    }
  }

  layers.push(envToConfigOverride(env));
  if (options.cliOverrides) {
    layers.push(options.cliOverrides);
  }

  let config: RuntimeConfig;
  try {
    config = parseRuntimeConfig(mergeConfigLayers(layers));
  } catch (error) {
    throw new ConfigValidationError('runtime config validation failed', error);
  }

  const secrets = await resolveAPISecrets({
    env,
    keychain: options.keychain,
  });

  return {
    config,
    sanitizedConfig: sanitizeConfigForSerialization(config),
    secrets,
    configPath: options.configPath,
    sourcePaths,
  };
}

export function discoverRuntimeConfigPaths(options: {
  cwd?: string;
  homeDir?: string;
} = {}): readonly string[] {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const sourcePaths: string[] = [];
  const globalPath = discoverConfigPathAtRoot(homeDir);
  if (globalPath) {
    sourcePaths.push(globalPath);
  }

  const projectPath = discoverConfigPathAtRoot(cwd);
  if (projectPath) {
    sourcePaths.push(projectPath);
  }

  return sourcePaths;
}

export function initRuntimeConfigFile(options: InitRuntimeConfigOptions): InitRuntimeConfigResult {
  const existed = fs.existsSync(options.targetPath);
  if (existed && !options.force) {
    return {
      targetPath: options.targetPath,
      created: false,
      overwritten: false,
    };
  }

  const defaults = parseRuntimeConfig({});
  fs.mkdirSync(path.dirname(options.targetPath), { recursive: true });
  fs.writeFileSync(options.targetPath, `${JSON.stringify(defaults, null, 2)}\n`, 'utf8');
  return {
    targetPath: options.targetPath,
    created: !existed,
    overwritten: existed,
  };
}

function loadConfigFile(configPath: string): unknown {
  const rawText = fs.readFileSync(configPath, 'utf8');
  assertNoPlaintextSecrets(rawText);
  const explorer = cosmiconfigSync('xifan', {
    searchPlaces: [path.basename(configPath)],
    stopDir: path.dirname(configPath),
    cache: false,
  });

  try {
    const loaded = explorer.load(configPath);
    if (!loaded || loaded.isEmpty) {
      return {};
    }
    return loaded.config;
  } catch (error) {
    throw new ConfigValidationError(`runtime config is not valid in ${configPath}`, error);
  }
}

function discoverConfigPathAtRoot(rootDir: string): string | undefined {
  const explorer = cosmiconfigSync('xifan', {
    searchPlaces: CONFIG_SEARCH_PLACES,
    stopDir: rootDir,
    cache: false,
  });

  try {
    const result = explorer.search(rootDir);
    if (!result || result.isEmpty) {
      return undefined;
    }
    return result.filepath;
  /* v8 ignore next 3 -- cosmiconfig search catch: requires filesystem failure */
  } catch {
    return undefined;
  }
}

function envToConfigOverride(env: NodeJS.ProcessEnv): RuntimeConfigOverride {
  const override: RuntimeConfigOverride = {};

  if (env.XIFAN_AGENT_MODE === 'build' || env.XIFAN_AGENT_MODE === 'plan') {
    override.agent = {
      ...(override.agent ?? {}),
      mode: env.XIFAN_AGENT_MODE,
    };
  }

  if (env.XIFAN_POLICY_MODE === 'compat' || env.XIFAN_POLICY_MODE === 'strict') {
    override.permissions = {
      ...(override.permissions ?? {}),
      policyMode: env.XIFAN_POLICY_MODE,
    };
  }

  if (env.XIFAN_LLM_DRIVER === 'auto' || env.XIFAN_LLM_DRIVER === 'builtin' || env.XIFAN_LLM_DRIVER === 'litellm') {
    override.llm = {
      ...(override.llm ?? {}),
      driver: env.XIFAN_LLM_DRIVER,
    };
  }

  if (env.XIFAN_LITELLM_BASE_URL) {
    override.llm = {
      ...(override.llm ?? {}),
      litellmBaseUrl: env.XIFAN_LITELLM_BASE_URL,
    };
  }

  const allowWrite = parseBooleanEnv(env.XIFAN_ALLOW_WRITE);
  if (allowWrite !== undefined) {
    override.permissions = {
      ...(override.permissions ?? {}),
      allowWrite,
    };
  }

  const allowShell = parseBooleanEnv(env.XIFAN_ALLOW_SHELL);
  if (allowShell !== undefined) {
    override.permissions = {
      ...(override.permissions ?? {}),
      allowShell,
    };
  }

  const headless = parseBooleanEnv(env.XIFAN_HEADLESS);
  if (headless !== undefined) {
    override.permissions = {
      ...(override.permissions ?? {}),
      headless,
    };
  }

  return override;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return undefined;
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

function mergeConfigLayers(layers: readonly unknown[]): unknown {
  let merged: unknown = {};
  for (const layer of layers) {
    merged = deepMerge(merged, layer);
  }
  return merged;
}

function deepMerge(base: unknown, override: unknown): unknown {
  /* v8 ignore next 3 -- defensive guard: callers always pass plain objects */
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override ?? base;
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }
    const previous = merged[key];
    if (Array.isArray(value)) {
      merged[key] = [...value];
      continue;
    }
    if (isPlainObject(previous) && isPlainObject(value)) {
      merged[key] = deepMerge(previous, value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
