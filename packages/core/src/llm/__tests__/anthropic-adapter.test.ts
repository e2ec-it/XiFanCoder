import { afterEach, describe, expect, it, vi } from 'vitest';

import { LLMStreamError } from '../../errors/index.js';
import { AnthropicAdapter } from '../adapters/anthropic-adapter.js';
import type { LLMRequest, StreamChunk } from '../types.js';

// ─── Mock anthropic module ───────────────────────────────────────────────────

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
      stream: vi.fn(),
    },
  }));
  return { default: MockAnthropic };
});

function getClientMock(adapter: AnthropicAdapter): {
  messages: {
    create: ReturnType<typeof vi.fn>;
    stream: ReturnType<typeof vi.fn>;
  };
} {
  return (adapter as unknown as { client: unknown }).client as ReturnType<typeof getClientMock>;
}

describe('AnthropicAdapter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('constructs with apiKey', () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    expect(adapter).toBeDefined();
  });

  it('constructs with baseUrl', () => {
    const adapter = new AnthropicAdapter('sk-ant-test', 'http://localhost:8080');
    expect(adapter).toBeDefined();
  });

  it('chat makes request and returns response', async () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    const client = getClientMock(adapter);

    client.messages.create.mockResolvedValueOnce({
      id: 'msg-1',
      content: [{ type: 'text', text: 'Hello!' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 5,
        output_tokens: 2,
      },
    });

    const request: LLMRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hi' }],
    };

    const result = await adapter.chat(request);
    expect(result.message.content).toBe('Hello!');
    expect(result.finishReason).toBe('stop');
    expect(result.requestId).toBe('msg-1');
  });

  it('chat with tool_use stop reason', async () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    const client = getClientMock(adapter);

    client.messages.create.mockResolvedValueOnce({
      id: 'msg-2',
      content: [
        { type: 'tool_use', id: 'tc-1', name: 'read_file', input: { path: 'test.ts' } },
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 1,
      },
    });

    const request: LLMRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'read test.ts' }],
    };

    const result = await adapter.chat(request);
    expect(result.finishReason).toBe('tool_use');
    expect(result.message.tool_calls).toHaveLength(1);
    expect(result.message.tool_calls![0]!.function.name).toBe('read_file');
    expect(result.usage.cacheReadTokens).toBe(2);
    expect(result.usage.cacheWriteTokens).toBe(1);
  });

  it('chat maps HTTP status errors', async () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    const client = getClientMock(adapter);

    client.messages.create.mockRejectedValueOnce({
      status: 401,
      error: 'Invalid API key',
    });

    const request: LLMRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(adapter.chat(request)).rejects.toThrow();
  });

  it('chat maps generic Error to LLMNetworkError', async () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    const client = getClientMock(adapter);

    client.messages.create.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const request: LLMRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(adapter.chat(request)).rejects.toThrow();
  });

  it('chat maps non-Error throws', async () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    const client = getClientMock(adapter);

    client.messages.create.mockRejectedValueOnce('string error');

    const request: LLMRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(adapter.chat(request)).rejects.toThrow();
  });

  it('stream yields chunks and finishes', async () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    const client = getClientMock(adapter);

    async function* mockStream() {
      yield {
        type: 'content_block_start',
        content_block: { type: 'text' },
      };
      yield {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello' },
      };
      yield {
        type: 'content_block_stop',
      };
      yield {
        type: 'message_delta',
        usage: { input_tokens: 5, output_tokens: 2 },
      };
      yield {
        type: 'message_stop',
      };
    }

    client.messages.stream.mockReturnValueOnce(mockStream());

    const request: LLMRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
    };

    const chunks: StreamChunk[] = [];
    for await (const chunk of adapter.stream(request)) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === 'text_delta')).toBe(true);
    expect(chunks.at(-1)?.type).toBe('message_stop');
  });

  it('stream with tool_use events', async () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    const client = getClientMock(adapter);

    async function* mockStream() {
      yield {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'tc-1', name: 'read_file' },
      };
      yield {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"path":"test.ts"}' },
      };
      yield { type: 'content_block_stop' };
      yield { type: 'message_stop' };
    }

    client.messages.stream.mockReturnValueOnce(mockStream());

    const request: LLMRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
    };

    const chunks: StreamChunk[] = [];
    for await (const chunk of adapter.stream(request)) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === 'tool_use_delta')).toBe(true);
  });

  it('stream throws LLMStreamError on initial Error', async () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    const client = getClientMock(adapter);

    client.messages.stream.mockImplementationOnce(() => {
      throw new Error('stream init fail');
    });

    const request: LLMRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(async () => {
      for await (const _chunk of adapter.stream(request)) {
        // consume
      }
    }).rejects.toThrow(LLMStreamError);
  });

  it('stream throws LLMStreamError on initial non-Error', async () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    const client = getClientMock(adapter);

    client.messages.stream.mockImplementationOnce(() => {
      throw 'string error';
    });

    const request: LLMRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(async () => {
      for await (const _chunk of adapter.stream(request)) {
        // consume
      }
    }).rejects.toThrow(LLMStreamError);
  });

  it('stream throws LLMStreamError on iteration Error', async () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    const client = getClientMock(adapter);

    async function* mockStream() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } };
      throw new Error('mid-stream failure');
    }

    client.messages.stream.mockReturnValueOnce(mockStream());

    const request: LLMRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(async () => {
      for await (const _chunk of adapter.stream(request)) {
        // consume
      }
    }).rejects.toThrow(LLMStreamError);
  });

  it('stream throws LLMStreamError on iteration non-Error', async () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    const client = getClientMock(adapter);

    async function* mockStream() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } };
      throw 42;
    }

    client.messages.stream.mockReturnValueOnce(mockStream());

    const request: LLMRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'test' }],
    };

    await expect(async () => {
      for await (const _chunk of adapter.stream(request)) {
        // consume
      }
    }).rejects.toThrow(LLMStreamError);
  });

  it('countTokens returns a positive number', () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    const count = adapter.countTokens([
      { role: 'user', content: 'hello world' },
    ]);
    expect(count).toBeGreaterThan(0);
  });

  it('getModels returns static anthropic models list', async () => {
    const adapter = new AnthropicAdapter('sk-ant-test');
    const models = await adapter.getModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.provider === 'anthropic')).toBe(true);
    expect(models.some((m) => m.id.includes('claude'))).toBe(true);
  });
});
