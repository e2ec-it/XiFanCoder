import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';

import { BuiltinTSDriver } from './builtin-ts-driver.js';
import { OpenAIAdapter } from './adapters/openai-adapter.js';
import type {
  ILLMAdapter,
  ILLMDriver,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  LLMTool,
  ModelInfo,
  ProviderConfig,
  StreamChunk,
  TokenUsageHandler,
} from './types.js';

const DEFAULT_BASE_URL = 'http://localhost:4000';
const DEFAULT_HEALTHCHECK_TIMEOUT_MS = 1_000;
const DEFAULT_STARTUP_GRACE_MS = 1_500;
const INSTALL_HINT =
  'Run `xifan install python-extras` and verify `litellm --port 4000` is available.';

export interface LiteLLMProxyDriverDeps {
  readonly createAdapter?: (apiKey: string, baseUrl: string) => ILLMAdapter;
  readonly checkHealth?: (baseUrl: string, timeoutMs: number) => Promise<boolean>;
  readonly startProcess?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface LiteLLMResolvedStartupConfig {
  readonly command: string;
  readonly args: readonly string[];
}

export interface StartLiteLLMProxyProcessOptions {
  readonly baseUrl: string;
  readonly startCommand?: string;
  readonly startArgs?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}

export function resolveLiteLLMProxyBaseUrl(config: ProviderConfig): string {
  return config.litellm?.proxyUrl ?? config.baseUrl ?? DEFAULT_BASE_URL;
}

export function resolveLiteLLMProxyStartupConfig(options: {
  readonly baseUrl: string;
  readonly startCommand?: string;
  readonly startArgs?: readonly string[];
}): LiteLLMResolvedStartupConfig {
  if (options.startArgs && options.startArgs.length > 0) {
    return {
      command: options.startCommand ?? 'litellm',
      args: options.startArgs,
    };
  }

  const port = inferPortFromUrl(options.baseUrl);
  return {
    command: options.startCommand ?? 'litellm',
    args: ['--port', String(port)],
  };
}

export function startLiteLLMProxyProcess(
  options: StartLiteLLMProxyProcessOptions,
  startProcess: LiteLLMProxyDriverDeps['startProcess'] = spawn,
): ChildProcess {
  const startup = resolveLiteLLMProxyStartupConfig({
    baseUrl: options.baseUrl,
    startCommand: options.startCommand,
    startArgs: options.startArgs,
  });

  const child = startProcess(startup.command, startup.args, {
    detached: true,
    stdio: 'ignore',
    env: options.env ?? process.env,
  });
  child.unref();
  return child;
}

export async function probeLiteLLMProxyHealth(
  baseUrl: string,
  timeoutMs = DEFAULT_HEALTHCHECK_TIMEOUT_MS,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<boolean> {
  const endpoint = `${stripTrailingSlashes(baseUrl)}/v1/models`;
  try {
    const response = await fetchFn(endpoint, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) {
    end -= 1;
  }
  return end > 0 ? value.slice(0, end) : value;
}

export class LiteLLMProxyDriver implements ILLMDriver {
  readonly driverName = 'litellm-proxy-driver';
  readonly providerType = 'litellm-proxy' as const;
  readonly proxyBaseUrl: string;

  private readonly delegate: BuiltinTSDriver;
  private readonly checkHealth: (baseUrl: string, timeoutMs: number) => Promise<boolean>;
  private readonly startProcess: NonNullable<LiteLLMProxyDriverDeps['startProcess']>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly autoStart: boolean;
  private readonly healthcheckTimeoutMs: number;
  private readonly startupGraceMs: number;
  private readonly startCommand?: string;
  private readonly startArgs?: readonly string[];
  private ready: Promise<void> | undefined;

  constructor(
    config: ProviderConfig,
    onUsage?: TokenUsageHandler,
    deps: LiteLLMProxyDriverDeps = {},
  ) {
    this.proxyBaseUrl = resolveLiteLLMProxyBaseUrl(config);
    const createAdapter =
      deps.createAdapter ??
      ((apiKey: string, baseUrl: string): ILLMAdapter =>
        new OpenAIAdapter(apiKey, 'litellm-proxy', baseUrl));

    this.delegate = new BuiltinTSDriver(
      createAdapter(config.apiKey ?? '', this.proxyBaseUrl),
      {
        ...config,
        type: 'litellm-proxy',
        baseUrl: this.proxyBaseUrl,
      },
      onUsage,
    );

    this.checkHealth = deps.checkHealth ?? probeLiteLLMProxyHealth;
    this.startProcess = deps.startProcess ?? spawn;
    this.sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.autoStart = config.litellm?.autoStart ?? false;
    this.healthcheckTimeoutMs =
      config.litellm?.healthcheckTimeoutMs ?? DEFAULT_HEALTHCHECK_TIMEOUT_MS;
    this.startupGraceMs = config.litellm?.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS;
    this.startCommand = config.litellm?.startCommand;
    this.startArgs = config.litellm?.startArgs;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    await this.ensureReady();
    return this.delegate.chat(request);
  }

  async *stream(request: LLMRequest): AsyncGenerator<StreamChunk> {
    await this.ensureReady();
    yield* this.delegate.stream(request);
  }

  countTokens(messages: readonly LLMMessage[], tools?: readonly LLMTool[]): number {
    return this.delegate.countTokens(messages, tools);
  }

  async getModels(): Promise<readonly ModelInfo[]> {
    await this.ensureReady();
    return this.delegate.getModels();
  }

  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.bootstrap().catch((error) => {
        this.ready = undefined;
        throw error;
      });
    }
    return this.ready;
  }

  private async bootstrap(): Promise<void> {
    const online = await this.checkHealth(this.proxyBaseUrl, this.healthcheckTimeoutMs);
    if (online) {
      return;
    }

    if (!this.autoStart) {
      throw new Error(
        `LiteLLM proxy is offline at ${this.proxyBaseUrl}. ${INSTALL_HINT}`,
      );
    }

    try {
      startLiteLLMProxyProcess(
        {
          baseUrl: this.proxyBaseUrl,
          startCommand: this.startCommand,
          startArgs: this.startArgs,
        },
        this.startProcess,
      );
    } catch (error) {
      throw new Error(
        `Failed to start LiteLLM proxy: ${error instanceof Error ? error.message : String(error)}. ${INSTALL_HINT}`,
      );
    }

    await this.sleep(this.startupGraceMs);

    const healthyAfterStart = await this.checkHealth(
      this.proxyBaseUrl,
      this.healthcheckTimeoutMs,
    );
    if (!healthyAfterStart) {
      throw new Error(
        `LiteLLM proxy health check failed after auto-start at ${this.proxyBaseUrl}. ${INSTALL_HINT}`,
      );
    }
  }
}

function inferPortFromUrl(baseUrl: string): number {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.port) {
      return Number(parsed.port);
    }
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return 4000;
  }
}
