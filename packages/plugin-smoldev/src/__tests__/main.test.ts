import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createSmoldevRpcHandler } from '../main.js';

interface RpcResultPayload {
  readonly content: {
    readonly filesCreated: readonly string[];
    readonly outputDir: string;
  };
}

describe('createSmoldevRpcHandler', () => {
  it('requires init before executeTool', async () => {
    const handler = createSmoldevRpcHandler();
    const response = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin/executeTool',
      params: {
        toolName: 'smoldev_generate',
        args: {
          spec: 'x',
          outputDir: '/tmp/na',
        },
      },
    });

    expect(response.error?.message).toContain('not initialized');
  });

  it('handles init -> execute -> destroy lifecycle', async () => {
    const handler = createSmoldevRpcHandler();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-smoldev-rpc-'));
    const outputDir = path.join(root, 'generated');

    const initResponse = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin/init',
      params: {},
    });
    expect((initResponse.result as { tools: readonly string[] }).tools).toContain('smoldev_generate');

    const executeResponse = await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'plugin/executeTool',
      params: {
        toolName: 'smoldev_generate',
        args: {
          spec: 'Create cli starter project',
          outputDir,
          stack: 'node+typescript',
        },
      },
    });

    expect(executeResponse.error).toBeUndefined();
    const payload = executeResponse.result as RpcResultPayload;
    expect(payload.content.filesCreated).toContain('README.md');
    expect(fs.existsSync(path.join(outputDir, 'README.md'))).toBe(true);

    const destroyResponse = await handler({
      jsonrpc: '2.0',
      id: 3,
      method: 'plugin/destroy',
      params: {},
    });
    expect(destroyResponse.result).toEqual({ ok: true });
  });

  it('returns explicit error for unsupported tools', async () => {
    const handler = createSmoldevRpcHandler();
    await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin/init',
      params: {},
    });

    const response = await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'plugin/executeTool',
      params: {
        toolName: 'unsupported_tool',
        args: {},
      },
    });

    expect(response.error?.message).toContain('unsupported tool');
  });

  it('returns unknown-method and generator failure errors', async () => {
    const handler = createSmoldevRpcHandler();

    const unknownMethod = await handler({
      jsonrpc: '2.0',
      id: 1,
      method: 'plugin/what-is-this',
      params: {},
    });
    expect(unknownMethod.error?.code).toBe(-32601);

    await handler({
      jsonrpc: '2.0',
      id: 2,
      method: 'plugin/init',
      params: {},
    });

    const failure = await handler({
      jsonrpc: '2.0',
      id: 3,
      method: 'plugin/executeTool',
      params: {
        toolName: 'smoldev_generate',
        args: {
          spec: '',
          outputDir: '',
        },
      },
    });

    expect(failure.error?.code).toBe(-32010);
  });
});

describe('startSmoldevPluginServer', () => {
  it('ignores invalid lines, writes responses, and exits after destroy', async () => {
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
    const { startSmoldevPluginServer: startServer } = await import('../main.js');

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
    const { startSmoldevPluginServer: startServer } = await import('../main.js');

    await startServer();

    // null and 42 should be silently ignored
    expect(write).toHaveBeenCalledTimes(2);
    expect(String(write.mock.calls[0]?.[0])).toContain('"id":1');
    expect(String(write.mock.calls[1]?.[0])).toContain('"id":2');

    stdoutSpy.mockRestore();
    vi.doUnmock('node:readline');
  });
});
