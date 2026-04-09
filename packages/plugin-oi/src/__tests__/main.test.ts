import { describe, expect, it, vi } from 'vitest';

import { createOiRpcHandler } from '../main.js';

describe('createOiRpcHandler', () => {
  it('requires init before executeTool', async () => {
    const handler = createOiRpcHandler({
      createExecutor: () => ({
        executeTool: async () => ({ ok: true }),
      }),
    });

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin/executeTool',
      params: {
        toolName: 'oi_execute',
        args: {},
      },
    });

    expect(response.error?.message).toContain('not initialized');
  });

  it('runs init -> execute -> destroy lifecycle', async () => {
    const handler = createOiRpcHandler({
      createExecutor: () => ({
        executeTool: async (toolName: string) => ({
          toolName,
          ok: true,
        }),
      }),
    });

    const init = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin/init',
      params: {
        projectPath: '/tmp/project',
      },
    });
    expect((init.result as { tools: readonly string[] }).tools).toContain('oi_execute');

    const exec = await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'plugin/executeTool',
      params: {
        toolName: 'oi_execute',
        args: {
          language: 'python',
          code: 'print(1)',
          confirm: true,
        },
      },
    });

    const payload = exec.result as {
      content: {
        toolName: string;
        ok: boolean;
      };
      metadata: {
        toolName: string;
      };
    };
    expect(payload.content.ok).toBe(true);
    expect(payload.metadata.toolName).toBe('oi_execute');

    const destroy = await handler({
      jsonrpc: '2.0',
      id: 3,
      method: 'plugin/destroy',
      params: {},
    });
    expect(destroy.result).toEqual({ ok: true });
  });

  it('returns missing-toolName, unknown-method, and executor failure errors', async () => {
    const handler = createOiRpcHandler({
      createExecutor: () => ({
        executeTool: async () => {
          throw new Error('oi exploded');
        },
      }),
    });

    const unknownMethod = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin/unknown',
      params: {},
    });
    expect(unknownMethod.error?.code).toBe(-32601);

    await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'plugin/init',
      params: {
        options: {
          model: 'gpt-4o-mini',
          baseUrl: 'http://localhost:11434/v1',
          apiKey: 'sk-oi',
          oiBin: 'python',
          timeoutMs: 1234,
        },
        env: {
          OI_EXTRA: '1',
        },
      },
    });

    const missingToolName = await handler({
      jsonrpc: '2.0',
      id: 3,
      method: 'plugin/executeTool',
      params: {
        args: {},
      },
    });
    expect(missingToolName.error?.code).toBe(-32602);

    const failure = await handler({
      jsonrpc: '2.0',
      id: 4,
      method: 'plugin/executeTool',
      params: {
        toolName: 'oi_execute',
        args: {},
      },
    });
    expect(failure.error?.code).toBe(-32010);
    expect(failure.error?.message).toContain('oi exploded');
  });
});

describe('startOiPluginServer', () => {
  it('ignores invalid lines, writes responses, and stops after destroy', async () => {
    const input = ['   ', 'not-json', '{"jsonrpc":"2.0","id":"oops","method":"plugin/init"}', '{"jsonrpc":"2.0","id":1,"method":"plugin/init","params":{}}', '{"jsonrpc":"2.0","id":2,"method":"plugin/destroy","params":{}}'];
    const close = vi.fn();
    const createInterface = vi.fn(() => ({
      close,
      async *[Symbol.asyncIterator]() {
        for (const line of input) {
          yield line;
        }
      },
    }));
    const write = vi.fn();

    vi.resetModules();
    vi.doMock('node:readline', () => ({
      default: {
        createInterface,
      },
    }));

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(write as never);
    const { startOiPluginServer: startServer } = await import('../main.js');

    await startServer();

    expect(createInterface).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(2);
    expect(String(write.mock.calls[0]?.[0])).toContain('"id":1');
    expect(String(write.mock.calls[1]?.[0])).toContain('"id":2');
    expect(close).toHaveBeenCalledTimes(1);

    stdoutSpy.mockRestore();
    vi.doUnmock('node:readline');
  });
});

describe('isJsonRpcRequest edge cases', () => {
  it('rejects null and non-object input silently', async () => {
    const input = [
      JSON.stringify(null),
      JSON.stringify(42),
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'plugin/init', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'plugin/destroy', params: {} }),
    ];
    const createInterface = vi.fn(() => ({
      close: vi.fn(),
      async *[Symbol.asyncIterator]() {
        for (const line of input) {
          yield line;
        }
      },
    }));
    const write = vi.fn();

    vi.resetModules();
    vi.doMock('node:readline', () => ({
      default: {
        createInterface,
      },
    }));

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(write as never);
    const { startOiPluginServer: startServer } = await import('../main.js');

    await startServer();

    // null and 42 should be silently ignored
    expect(write).toHaveBeenCalledTimes(2);
    expect(String(write.mock.calls[0]?.[0])).toContain('"id":1');
    expect(String(write.mock.calls[1]?.[0])).toContain('"id":2');

    stdoutSpy.mockRestore();
    vi.doUnmock('node:readline');
  });
});
