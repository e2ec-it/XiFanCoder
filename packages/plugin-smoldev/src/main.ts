import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { smoldevGenerate, type SmoldevGenerateInput } from './generator.js';

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

function isJsonRpcRequest(input: unknown): input is JsonRpcRequest {
  if (!input || typeof input !== 'object') {
    return false;
  }

  const value = input as Partial<JsonRpcRequest>;
  return value.jsonrpc === '2.0' && typeof value.id === 'number' && typeof value.method === 'string';
}

function toResponse(request: JsonRpcRequest, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result,
  };
}

function toErrorResponse(request: JsonRpcRequest, message: string, code = -32000): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: request.id,
    error: {
      code,
      message,
    },
  };
}

export function createSmoldevRpcHandler(): (request: JsonRpcRequest) => Promise<JsonRpcResponse> {
  let initialized = false;

  return async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
    if (request.method === 'plugin/init') {
      initialized = true;
      return toResponse(request, {
        tools: ['smoldev_generate'],
      });
    }

    if (request.method === 'plugin/destroy') {
      initialized = false;
      return toResponse(request, {
        ok: true,
      });
    }

    if (request.method !== 'plugin/executeTool') {
      return toErrorResponse(request, `unknown method: ${request.method}`, -32601);
    }

    if (!initialized) {
      return toErrorResponse(request, 'plugin is not initialized', -32001);
    }

    const params = (request.params ?? {}) as {
      toolName?: unknown;
      args?: unknown;
    };

    const toolName = String(params.toolName ?? '');
    if (toolName !== 'smoldev_generate') {
      return toErrorResponse(request, `unsupported tool: ${toolName}`, -32602);
    }

    const args = (params.args ?? {}) as Partial<SmoldevGenerateInput>;
    try {
      const generated = await smoldevGenerate({
        spec: String(args.spec ?? ''),
        outputDir: String(args.outputDir ?? ''),
        stack: args.stack,
      });
      return toResponse(request, {
        content: generated,
        metadata: {
          phase: 'done',
          totalFiles: generated.filesCreated.length,
        },
      });
    } catch (error) {
      return toErrorResponse(
        request,
        error instanceof Error ? error.message : String(error),
        -32010,
      );
    }
  };
}

export async function startSmoldevPluginServer(): Promise<void> {
  const handler = createSmoldevRpcHandler();
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
  void startSmoldevPluginServer();
}
