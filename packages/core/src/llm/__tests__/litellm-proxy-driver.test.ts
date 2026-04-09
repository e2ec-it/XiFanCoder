import type { ChildProcess, SpawnOptions } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { createDriver } from '../driver-factory.js';
import {
  LiteLLMProxyDriver,
  probeLiteLLMProxyHealth,
  resolveLiteLLMProxyStartupConfig,
} from '../litellm-proxy-driver.js';
import type {
  ILLMAdapter,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  LLMTool,
  ModelInfo,
  ProviderConfig,
  StreamChunk,
} from '../types.js';

function createAdapterStub(): ILLMAdapter {
  return {
    chat: async (request: LLMRequest): Promise<LLMResponse> => ({
      message: { role: 'assistant', content: `ok:${request.model}` },
      finishReason: 'stop',
      usage: {
        promptTokens: 1,
        completionTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      latencyMs: 1,
      requestId: 'req-1',
    }),
    stream: async function* stream(): AsyncGenerator<StreamChunk> {
      yield {
        type: 'message_stop',
        finishReason: 'stop',
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      };
    },
    countTokens: (messages: readonly LLMMessage[], _tools?: readonly LLMTool[]): number => messages.length,
    getModels: async (): Promise<readonly ModelInfo[]> => [
      {
        id: 'lite-model',
        provider: 'litellm-proxy',
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
        supportsFunctionCalling: true,
        supportsStreaming: true,
      },
    ],
  };
}

describe('probeLiteLLMProxyHealth', () => {
  it('returns true when models endpoint replies with 200', async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: URL | RequestInfo): Promise<Response> => {
      calls.push(String(input));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const healthy = await probeLiteLLMProxyHealth('http://localhost:4000/', 500, fetchFn);
    expect(healthy).toBe(true);
    expect(calls[0]).toBe('http://localhost:4000/v1/models');
  });

  it('returns false when fetch throws', async () => {
    const fetchFn = (async (): Promise<Response> => {
      throw new Error('network-down');
    }) as typeof fetch;

    const healthy = await probeLiteLLMProxyHealth('http://localhost:4000', 500, fetchFn);
    expect(healthy).toBe(false);
  });
});

describe('resolveLiteLLMProxyStartupConfig', () => {
  it('infers port from baseUrl when args are omitted', () => {
    const startup = resolveLiteLLMProxyStartupConfig({
      baseUrl: 'http://localhost:4312',
    });
    expect(startup).toEqual({
      command: 'litellm',
      args: ['--port', '4312'],
    });
  });

  it('uses explicit command and args', () => {
    const startup = resolveLiteLLMProxyStartupConfig({
      baseUrl: 'http://localhost:4000',
      startCommand: 'python',
      startArgs: ['-m', 'litellm', '--port', '9001'],
    });
    expect(startup).toEqual({
      command: 'python',
      args: ['-m', 'litellm', '--port', '9001'],
    });
  });
});

describe('LiteLLMProxyDriver', () => {
  it('fails fast when proxy is offline and autoStart is disabled', async () => {
    const driver = new LiteLLMProxyDriver(
      {
        type: 'litellm-proxy',
        model: 'gpt-4o-mini',
      },
      undefined,
      {
        createAdapter: () => createAdapterStub(),
        checkHealth: async () => false,
      },
    );

    await expect(driver.getModels()).rejects.toThrowError('xifan install python-extras');
  });

  it('auto-starts proxy and succeeds when follow-up health check passes', async () => {
    const calls: Array<{
      command: string;
      args: readonly string[];
      options: SpawnOptions;
    }> = [];
    const child = { unref: vi.fn() } as unknown as ChildProcess;
    const checkHealth = vi
      .fn<(_: string, __: number) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const driver = new LiteLLMProxyDriver(
      {
        type: 'litellm-proxy',
        model: 'gpt-4o-mini',
        litellm: {
          autoStart: true,
          startupGraceMs: 0,
        },
      },
      undefined,
      {
        createAdapter: () => createAdapterStub(),
        checkHealth,
        startProcess: (
          command: string,
          args: readonly string[],
          options: SpawnOptions,
        ): ChildProcess => {
          calls.push({ command, args, options });
          return child;
        },
        sleep: async () => undefined,
      },
    );

    const models = await driver.getModels();
    expect(models).toHaveLength(1);
    expect(checkHealth).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('litellm');
    expect(calls[0]?.args).toEqual(['--port', '4000']);
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it('delegates chat and countTokens correctly', async () => {
    const driver = new LiteLLMProxyDriver(
      {
        type: 'litellm-proxy',
        model: 'gpt-4o-mini',
      },
      undefined,
      {
        createAdapter: () => createAdapterStub(),
        checkHealth: async () => true,
      },
    );

    const chatResult = await driver.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(chatResult.message.content).toBe('ok:test-model');

    const tokenCount = driver.countTokens([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]);
    expect(tokenCount).toBe(2);
  });

  it('delegates stream correctly', async () => {
    const driver = new LiteLLMProxyDriver(
      {
        type: 'litellm-proxy',
        model: 'gpt-4o-mini',
      },
      undefined,
      {
        createAdapter: () => createAdapterStub(),
        checkHealth: async () => true,
      },
    );

    const chunks: StreamChunk[] = [];
    for await (const chunk of driver.stream({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('message_stop');
  });

  it('throws when auto-start process fails', async () => {
    const driver = new LiteLLMProxyDriver(
      {
        type: 'litellm-proxy',
        model: 'gpt-4o-mini',
        litellm: { autoStart: true, startupGraceMs: 0 },
      },
      undefined,
      {
        createAdapter: () => createAdapterStub(),
        checkHealth: async () => false,
        startProcess: () => { throw new Error('spawn failed'); },
        sleep: async () => undefined,
      },
    );

    await expect(driver.getModels()).rejects.toThrow('Failed to start LiteLLM proxy');
  });

  it('throws when health check fails after auto-start', async () => {
    const child = { unref: vi.fn() } as unknown as ChildProcess;
    const driver = new LiteLLMProxyDriver(
      {
        type: 'litellm-proxy',
        model: 'gpt-4o-mini',
        litellm: { autoStart: true, startupGraceMs: 0 },
      },
      undefined,
      {
        createAdapter: () => createAdapterStub(),
        checkHealth: async () => false,
        startProcess: () => child,
        sleep: async () => undefined,
      },
    );

    await expect(driver.getModels()).rejects.toThrow('health check failed after auto-start');
  });

  it('caches the bootstrap promise and retries after failure', async () => {
    let healthCallCount = 0;
    const driver = new LiteLLMProxyDriver(
      {
        type: 'litellm-proxy',
        model: 'gpt-4o-mini',
      },
      undefined,
      {
        createAdapter: () => createAdapterStub(),
        checkHealth: async () => {
          healthCallCount++;
          if (healthCallCount === 1) return false;
          return true;
        },
      },
    );

    // First call should fail (no autoStart, offline)
    await expect(driver.getModels()).rejects.toThrow('offline');

    // Second call should retry since ready was reset
    const models = await driver.getModels();
    expect(models).toHaveLength(1);
  });

  it('inferPortFromUrl returns 443 for https, 80 for http without port, 4000 for invalid URL', () => {
    const config1 = resolveLiteLLMProxyStartupConfig({ baseUrl: 'https://proxy.example.com' });
    expect(config1.args).toEqual(['--port', '443']);

    const config2 = resolveLiteLLMProxyStartupConfig({ baseUrl: 'http://proxy.example.com' });
    expect(config2.args).toEqual(['--port', '80']);

    const config3 = resolveLiteLLMProxyStartupConfig({ baseUrl: 'not-a-url' });
    expect(config3.args).toEqual(['--port', '4000']);
  });

  it('is returned by driver factory for litellm-proxy provider', () => {
    const driver = createDriver({
      type: 'litellm-proxy',
      model: 'gpt-4o-mini',
    } as ProviderConfig);

    expect(driver).toBeInstanceOf(LiteLLMProxyDriver);
  });
});
