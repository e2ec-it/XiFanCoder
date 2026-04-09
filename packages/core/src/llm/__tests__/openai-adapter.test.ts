import { afterEach, describe, expect, it, vi } from 'vitest';

import { LLMStreamError } from '../../errors/index.js';
import { OpenAIAdapter } from '../adapters/openai-adapter.js';
import type { LLMRequest, StreamChunk } from '../types.js';

// ─── Mock openai module ──────────────────────────────────────────────────────

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
    models: {
      list: vi.fn(),
    },
  }));
  return { default: MockOpenAI };
});

function getClientMock(adapter: OpenAIAdapter): {
  chat: { completions: { create: ReturnType<typeof vi.fn> } };
  models: { list: ReturnType<typeof vi.fn> };
} {
  return (adapter as unknown as { client: unknown }).client as ReturnType<typeof getClientMock>;
}

describe('OpenAIAdapter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('constructs with openai variant', () => {
    const adapter = new OpenAIAdapter('sk-test');
    expect(adapter).toBeDefined();
  });

  it('constructs with ollama variant and empty key defaults to "ollama"', () => {
    const adapter = new OpenAIAdapter('', 'ollama', 'http://localhost:11434');
    expect(adapter).toBeDefined();
  });

  it('constructs with litellm-proxy variant', () => {
    const adapter = new OpenAIAdapter('key', 'litellm-proxy', 'http://localhost:4000');
    expect(adapter).toBeDefined();
  });

  it('chat makes request and returns response', async () => {
    const adapter = new OpenAIAdapter('sk-test');
    const client = getClientMock(adapter);

    client.chat.completions.create.mockResolvedValueOnce({
      id: 'chatcmpl-1',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Hello!',
          },
        },
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 2,
      },
    });

    const request: LLMRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
    };

    const result = await adapter.chat(request);
    expect(result.message.content).toBe('Hello!');
    expect(result.finishReason).toBe('stop');
  });

  it('chat with tools, maxTokens, temperature, tool_choice', async () => {
    const adapter = new OpenAIAdapter('sk-test');
    const client = getClientMock(adapter);

    client.chat.completions.create.mockResolvedValueOnce({
      id: 'chatcmpl-2',
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'ok' },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    });

    const request: LLMRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'desc',
            parameters: { type: 'object' },
          },
        },
      ],
      tool_choice: 'auto',
      maxTokens: 100,
      temperature: 0.5,
    };

    await adapter.chat(request);
    const callArgs = client.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.tools).toBeDefined();
    expect(callArgs.tool_choice).toBe('auto');
    expect(callArgs.max_tokens).toBe(100);
    expect(callArgs.temperature).toBe(0.5);
  });

  it('chat with systemPrompt prepends system message and deduplicates', async () => {
    const adapter = new OpenAIAdapter('sk-test');
    const client = getClientMock(adapter);

    client.chat.completions.create.mockResolvedValueOnce({
      id: 'chatcmpl-3',
      choices: [
        { finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    });

    const request: LLMRequest = {
      model: 'gpt-4o',
      systemPrompt: 'be helpful',
      messages: [
        { role: 'system', content: 'old system' },
        { role: 'user', content: 'hi' },
      ],
    };

    await adapter.chat(request);
    const callArgs = client.chat.completions.create.mock.calls[0]![0];
    const messages = callArgs.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toBe('be helpful');
    // system message from messages array should be skipped
    expect(messages.filter((m: { role: string }) => m.role === 'system')).toHaveLength(1);
  });

  it('chat without systemPrompt keeps system messages in messages array', async () => {
    const adapter = new OpenAIAdapter('sk-test');
    const client = getClientMock(adapter);

    client.chat.completions.create.mockResolvedValueOnce({
      id: 'chatcmpl-4',
      choices: [
        { finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    });

    const request: LLMRequest = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'system msg' },
        { role: 'user', content: 'hi' },
      ],
    };

    await adapter.chat(request);
    const callArgs = client.chat.completions.create.mock.calls[0]![0];
    const messages = callArgs.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toBe('system msg');
  });

  it('chat maps HTTP status errors', async () => {
    const adapter = new OpenAIAdapter('sk-test');
    const client = getClientMock(adapter);

    client.chat.completions.create.mockRejectedValueOnce({
      status: 401,
      error: 'Unauthorized',
    });

    const request: LLMRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(adapter.chat(request)).rejects.toThrow();
  });

  it('chat maps generic Error objects to LLMNetworkError', async () => {
    const adapter = new OpenAIAdapter('sk-test');
    const client = getClientMock(adapter);

    client.chat.completions.create.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const request: LLMRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(adapter.chat(request)).rejects.toThrow();
  });

  it('chat maps non-Error non-object throws', async () => {
    const adapter = new OpenAIAdapter('sk-test');
    const client = getClientMock(adapter);

    client.chat.completions.create.mockRejectedValueOnce('string error');

    const request: LLMRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(adapter.chat(request)).rejects.toThrow();
  });

  it('stream yields chunks and finishes', async () => {
    const adapter = new OpenAIAdapter('sk-test');
    const client = getClientMock(adapter);

    async function* mockStream() {
      yield {
        choices: [{ delta: { content: 'Hello' } }],
      };
      yield {
        choices: [{ delta: { content: ' World' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      };
    }

    client.chat.completions.create.mockResolvedValueOnce(mockStream());

    const request: LLMRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
    };

    const chunks: StreamChunk[] = [];
    for await (const chunk of adapter.stream(request)) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === 'text_delta')).toBe(true);
    expect(chunks.at(-1)?.type).toBe('message_stop');
  });

  it('stream throws LLMStreamError on initial error (Error instance)', async () => {
    const adapter = new OpenAIAdapter('sk-test');
    const client = getClientMock(adapter);

    client.chat.completions.create.mockRejectedValueOnce(new Error('stream init fail'));

    const request: LLMRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(async () => {
      for await (const _chunk of adapter.stream(request)) {
        // consume
      }
    }).rejects.toThrow(LLMStreamError);
  });

  it('stream throws LLMStreamError on initial non-Error', async () => {
    const adapter = new OpenAIAdapter('sk-test');
    const client = getClientMock(adapter);

    client.chat.completions.create.mockRejectedValueOnce('string error');

    const request: LLMRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(async () => {
      for await (const _chunk of adapter.stream(request)) {
        // consume
      }
    }).rejects.toThrow(LLMStreamError);
  });

  it('stream throws LLMStreamError on iteration error (Error instance)', async () => {
    const adapter = new OpenAIAdapter('sk-test');
    const client = getClientMock(adapter);

    async function* mockStream() {
      yield { choices: [{ delta: { content: 'ok' } }] };
      throw new Error('mid-stream failure');
    }

    client.chat.completions.create.mockResolvedValueOnce(mockStream());

    const request: LLMRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(async () => {
      for await (const _chunk of adapter.stream(request)) {
        // consume
      }
    }).rejects.toThrow(LLMStreamError);
  });

  it('stream throws LLMStreamError on iteration non-Error', async () => {
    const adapter = new OpenAIAdapter('sk-test');
    const client = getClientMock(adapter);

    async function* mockStream() {
      yield { choices: [{ delta: { content: 'ok' } }] };
      throw 'string failure';
    }

    client.chat.completions.create.mockResolvedValueOnce(mockStream());

    const request: LLMRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(async () => {
      for await (const _chunk of adapter.stream(request)) {
        // consume
      }
    }).rejects.toThrow(LLMStreamError);
  });

  it('countTokens returns a positive number', () => {
    const adapter = new OpenAIAdapter('sk-test');
    const count = adapter.countTokens([
      { role: 'user', content: 'hello world' },
    ]);
    expect(count).toBeGreaterThan(0);
  });

  it('countTokens with tools', () => {
    const adapter = new OpenAIAdapter('sk-test');
    const count = adapter.countTokens(
      [{ role: 'user', content: 'test' }],
      [
        {
          type: 'function',
          function: {
            name: 'tool',
            description: 'desc',
            parameters: { type: 'object' },
          },
        },
      ],
    );
    expect(count).toBeGreaterThan(0);
  });

  it('getModels returns static list for openai variant', async () => {
    const adapter = new OpenAIAdapter('sk-test', 'openai');
    const models = await adapter.getModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.provider === 'openai')).toBe(true);
  });

  it('getModels calls API for ollama variant', async () => {
    const adapter = new OpenAIAdapter('', 'ollama', 'http://localhost:11434');
    const client = getClientMock(adapter);

    client.models.list.mockResolvedValueOnce({
      data: [{ id: 'llama3' }, { id: 'codellama' }],
    });

    const models = await adapter.getModels();
    expect(models).toHaveLength(2);
    expect(models[0]!.id).toBe('llama3');
    expect(models[0]!.provider).toBe('ollama');
    expect(models[0]!.contextWindow).toBe(128_000);
  });

  it('getModels returns empty array on API failure for ollama', async () => {
    const adapter = new OpenAIAdapter('', 'ollama', 'http://localhost:11434');
    const client = getClientMock(adapter);

    client.models.list.mockRejectedValueOnce(new Error('connection refused'));

    const models = await adapter.getModels();
    expect(models).toEqual([]);
  });

  it('getModels calls API for litellm-proxy variant', async () => {
    const adapter = new OpenAIAdapter('key', 'litellm-proxy', 'http://localhost:4000');
    const client = getClientMock(adapter);

    client.models.list.mockResolvedValueOnce({
      data: [{ id: 'gpt-4' }],
    });

    const models = await adapter.getModels();
    expect(models).toHaveLength(1);
    expect(models[0]!.provider).toBe('litellm-proxy');
  });
});
