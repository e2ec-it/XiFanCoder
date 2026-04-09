import { describe, expect, it, vi } from 'vitest';

import { createAiderRpcHandler } from '../main.js';

describe('createAiderRpcHandler', () => {
  it('requires init before executeTool', async () => {
    const handler = createAiderRpcHandler({
      createExecutor: () => ({
        executeTool: async () => ({ ok: true }),
      }),
    });

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin/executeTool',
      params: {
        toolName: 'aider_edit',
        args: {},
      },
    });

    expect(response.error?.message).toContain('not initialized');
  });

  it('runs init -> execute -> destroy lifecycle', async () => {
    const handler = createAiderRpcHandler({
      createExecutor: () => ({
        executeTool: async (toolName: string) => ({
          toolName,
          ok: true,
        }),
      }),
    });

    const initResponse = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin/init',
      params: {
        projectPath: '/tmp/project',
      },
    });

    expect((initResponse.result as { tools: readonly string[] }).tools).toContain('aider_edit');

    const executeResponse = await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'plugin/executeTool',
      params: {
        toolName: 'aider_commit',
        args: {
          files: ['src/index.ts'],
        },
      },
    });

    const payload = executeResponse.result as {
      content: {
        toolName: string;
        ok: boolean;
      };
      metadata: {
        toolName: string;
      };
    };
    expect(payload.content.ok).toBe(true);
    expect(payload.metadata.toolName).toBe('aider_commit');

    const destroyResponse = await handler({
      jsonrpc: '2.0',
      id: 3,
      method: 'plugin/destroy',
      params: {},
    });
    expect(destroyResponse.result).toEqual({ ok: true });
  });

  it('returns unknown-method error for unsupported request type', async () => {
    const handler = createAiderRpcHandler({
      createExecutor: () => ({
        executeTool: async () => ({ ok: true }),
      }),
    });

    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin/what-is-this',
      params: {},
    });

    expect(response.error?.code).toBe(-32601);
  });

  it('returns missing-toolName and executor failure errors', async () => {
    const handler = createAiderRpcHandler({
      createExecutor: () => ({
        executeTool: async () => {
          throw new Error('tool exploded');
        },
      }),
    });

    await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin/init',
      params: {
        projectPath: '/tmp/project',
      },
    });

    const missingToolName = await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'plugin/executeTool',
      params: {
        args: {},
      },
    });
    expect(missingToolName.error?.code).toBe(-32602);

    const failure = await handler({
      jsonrpc: '2.0',
      id: 3,
      method: 'plugin/executeTool',
      params: {
        toolName: 'aider_edit',
        args: {},
      },
    });
    expect(failure.error?.code).toBe(-32010);
    expect(failure.error?.message).toContain('tool exploded');
  });

  it('normalizes runtime config defaults during init', async () => {
    const seenConfigs: Array<Record<string, unknown>> = [];
    const handler = createAiderRpcHandler({
      createExecutor: (config) => {
        seenConfigs.push(config as unknown as Record<string, unknown>);
        return {
          executeTool: async () => ({ ok: true }),
        };
      },
    });

    await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin/init',
      params: {
        env: { FOO: 'bar' },
        options: {
          model: 'sonnet',
          baseUrl: 'http://localhost:11434/v1',
          apiKey: 'sk-test',
          aiderBin: 'python -m aider',
          timeoutMs: 4321,
        },
      },
    });

    expect(seenConfigs[0]).toMatchObject({
      projectPath: process.cwd(),
      env: { FOO: 'bar' },
      model: 'sonnet',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'sk-test',
      aiderBin: 'python -m aider',
      timeoutMs: 4321,
    });
  });
});

describe('startAiderPluginServer', () => {
  it('ignores invalid lines, writes responses, and stops after destroy', async () => {
    const input = ['   ', 'not-json', '{"jsonrpc":"2.0","id":"oops","method":"plugin/init"}', '{"jsonrpc":"2.0","id":1,"method":"plugin/init","params":{}}', '{"jsonrpc":"2.0","id":2,"method":"plugin/destroy","params":{}}'];
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
    const { startAiderPluginServer: startServer } = await import('../main.js');

    await startServer();

    expect(createInterface).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(2);
    expect(String(write.mock.calls[0]?.[0])).toContain('"id":1');
    expect(String(write.mock.calls[1]?.[0])).toContain('"id":2');

    stdoutSpy.mockRestore();
    vi.doUnmock('node:readline');
  });
});

describe('isJsonRpcRequest edge cases', () => {
  it('rejects null and non-object input silently', async () => {
    const input = [
      JSON.stringify(null),
      JSON.stringify(42),
      JSON.stringify('hello'),
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
    const { startAiderPluginServer: startServer } = await import('../main.js');

    await startServer();

    // null, 42, and "hello" should be silently ignored
    expect(write).toHaveBeenCalledTimes(2);
    expect(String(write.mock.calls[0]?.[0])).toContain('"id":1');
    expect(String(write.mock.calls[1]?.[0])).toContain('"id":2');

    stdoutSpy.mockRestore();
    vi.doUnmock('node:readline');
  });
});
