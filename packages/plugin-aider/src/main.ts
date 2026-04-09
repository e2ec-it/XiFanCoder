import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { AiderExecutor } from './aider.js';
import type { AiderRuntimeConfig } from './types.js';

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcError {
  readonly code: number;
  readonly message: string;
}

interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

interface PluginConfigPayload {
  readonly name?: string;
  readonly projectPath?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly options?: Readonly<Record<string, unknown>>;
}

interface AiderExecutorLike {
  executeTool(toolName: string, args: unknown): Promise<unknown>;
}

interface HandlerDeps {
  readonly createExecutor?: (config: AiderRuntimeConfig) => AiderExecutorLike;
}

function isJsonRpcRequest(input: unknown): input is JsonRpcRequest {
  if (!input || typeof input !== 'object') {
    return false;
  }
  const value = input as Partial<JsonRpcRequest>;
  return value.jsonrpc === '2.0' && typeof value.id === 'number' && typeof value.method === 'string';
}

function toResult(request: JsonRpcRequest, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result,
  };
}

function toError(request: JsonRpcRequest, message: string, code = -32000): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: request.id,
    error: {
      code,
      message,
    },
  };
}

function toRuntimeConfig(config: PluginConfigPayload): AiderRuntimeConfig {
  const options = config.options ?? {};
  return {
    projectPath: String(config.projectPath ?? process.cwd()),
    env: config.env ?? {},
    model: typeof options.model === 'string' ? options.model : undefined,
    baseUrl: typeof options.baseUrl === 'string' ? options.baseUrl : undefined,
    apiKey: typeof options.apiKey === 'string' ? options.apiKey : undefined,
    aiderBin: typeof options.aiderBin === 'string' ? options.aiderBin : undefined,
    timeoutMs: typeof options.timeoutMs === 'number' ? options.timeoutMs : undefined,
  };
}

export function createAiderRpcHandler(deps: HandlerDeps = {}): (request: JsonRpcRequest) => Promise<JsonRpcResponse> {
  const createExecutor = deps.createExecutor ?? ((config: AiderRuntimeConfig) => new AiderExecutor(config));
  let initialized = false;
  let executor: AiderExecutorLike | undefined;

  return async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
    if (request.method === 'plugin/init') {
      const config = toRuntimeConfig((request.params ?? {}) as PluginConfigPayload);
      executor = createExecutor(config);
      initialized = true;
      return toResult(request, {
        tools: ['aider_edit', 'aider_commit', 'aider_undo'],
      });
    }

    if (request.method === 'plugin/destroy') {
      initialized = false;
      executor = undefined;
      return toResult(request, { ok: true });
    }

    if (request.method !== 'plugin/executeTool') {
      return toError(request, `unknown method: ${request.method}`, -32601);
    }

    if (!initialized || !executor) {
      return toError(request, 'plugin is not initialized', -32001);
    }

    const params = (request.params ?? {}) as {
      toolName?: unknown;
      args?: unknown;
    };
    const toolName = String(params.toolName ?? '');

    if (!toolName) {
      return toError(request, 'missing toolName', -32602);
    }

    try {
      const output = await executor.executeTool(toolName, params.args ?? {});
      return toResult(request, {
        content: output,
        metadata: {
          toolName,
        },
      });
    } catch (error) {
      return toError(request, error instanceof Error ? error.message : String(error), -32010);
    }
  };
}

export async function startAiderPluginServer(): Promise<void> {
  const handler = createAiderRpcHandler();
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isJsonRpcRequest(parsed)) {
      continue;
    }

    const response = await handler(parsed);
    process.stdout.write(`${JSON.stringify(response)}\n`);

    if (parsed.method === 'plugin/destroy') {
      break;
    }
  }

  rl.close();
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === fileURLToPath(new URL(process.argv[1], 'file:'));

/* v8 ignore next 3 */
if (isMain) {
  void startAiderPluginServer();
}
