import { afterEach, describe, expect, it, vi } from 'vitest';

import { LLMAuthError, LLMRateLimitError, LLMStreamError } from '../../errors/index.js';
import { responseToStreamChunks, streamWithFallback, withRetry } from '../retry.js';
import type { LLMRequest } from '../types.js';

describe('withRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries rate-limit error until success', async () => {
    vi.useFakeTimers();
    let attempts = 0;

    const promise = withRetry(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new LLMRateLimitError(1);
      }
      return 'ok';
    });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry non-recoverable auth error', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts += 1;
        throw new LLMAuthError('anthropic');
      }),
    ).rejects.toBeInstanceOf(LLMAuthError);
    expect(attempts).toBe(1);
  });
});

describe('streamWithFallback', () => {
  it('falls back to chat when stream throws LLMStreamError', async () => {
    const request: LLMRequest = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    };

    const chunks: unknown[] = [];
    for await (const chunk of streamWithFallback(
      request,
      async function* streamFn() {
        throw new LLMStreamError('sse interrupted');
      },
      async () => ({
        message: { role: 'assistant', content: 'fallback-text' },
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        latencyMs: 5,
      }),
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'text_delta', delta: 'fallback-text' },
      {
        type: 'message_stop',
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
    ]);
  });

  it('rethrows non-stream errors from stream function', async () => {
    const request: LLMRequest = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    };

    const iterator = streamWithFallback(
      request,
      async function* streamFn() {
        throw new Error('fatal');
      },
      async () => {
        throw new Error('should-not-call-chat');
      },
    );

    await expect(iterator.next()).rejects.toThrowError('fatal');
  });
});

describe('responseToStreamChunks', () => {
  it('emits tool delta and message stop for tool-call response', async () => {
    const chunks = [];
    for await (const chunk of responseToStreamChunks({
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"README.md"}',
            },
          },
        ],
      },
      finishReason: 'tool_use',
      usage: {
        promptTokens: 3,
        completionTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      latencyMs: 1,
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toEqual({
      type: 'tool_use_delta',
      toolCallId: 'tc-1',
      name: 'read_file',
      argumentsDelta: '{"path":"README.md"}',
    });
    expect(chunks.at(-1)).toEqual({
      type: 'message_stop',
      finishReason: 'tool_use',
      usage: {
        promptTokens: 3,
        completionTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    });
  });
});
