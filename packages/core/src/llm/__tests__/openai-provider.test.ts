import { afterEach, describe, expect, it, vi } from 'vitest';

import { LLMAuthError, LLMNetworkError } from '../../errors/index.js';
import {
  OpenAIStreamParser,
  fromOpenAIResponse,
} from '../converters/from-openai.js';
import { withRetry } from '../retry.js';

describe('openai provider contract', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when response has no choices', () => {
    expect(() =>
      fromOpenAIResponse({ choices: [] }, 10),
    ).toThrowError('no choices');
  });

  it('converts response without tool_calls', () => {
    const converted = fromOpenAIResponse(
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'hello' },
          },
        ],
      },
      5,
    );
    expect(converted.message.tool_calls).toBeUndefined();
    expect(converted.message.content).toBe('hello');
  });

  it('maps length finish_reason to max_tokens', () => {
    const converted = fromOpenAIResponse(
      {
        choices: [
          {
            finish_reason: 'length',
            message: { role: 'assistant', content: 'cut' },
          },
        ],
      },
      5,
    );
    expect(converted.finishReason).toBe('max_tokens');
  });

  it('maps unknown finish_reason to stop', () => {
    const converted = fromOpenAIResponse(
      {
        choices: [
          {
            finish_reason: 'unknown_reason',
            message: { role: 'assistant', content: 'ok' },
          },
        ],
      },
      5,
    );
    expect(converted.finishReason).toBe('stop');
  });

  it('maps undefined usage to zero tokens', () => {
    const converted = fromOpenAIResponse(
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'ok' },
          },
        ],
      },
      5,
    );
    expect(converted.usage.promptTokens).toBe(0);
    expect(converted.usage.completionTokens).toBe(0);
  });

  it('stream parser handles finish without usage', () => {
    const parser = new OpenAIStreamParser();
    parser.processChunk({
      choices: [{ delta: { content: 'hello' }, finish_reason: 'stop' }],
    });

    const stop = parser.finish();
    expect(stop.type).toBe('message_stop');
    expect(stop.usage?.promptTokens).toBe(0);
  });

  it('stream parser returns empty array for chunk with no choices', () => {
    const parser = new OpenAIStreamParser();
    const result = parser.processChunk({ usage: { prompt_tokens: 5, completion_tokens: 3 } });
    expect(result).toEqual([]);
  });

  it('converts OpenAI response to unified message including tool calls', () => {
    const converted = fromOpenAIResponse(
      {
        id: 'chatcmpl-1',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'tc1',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: '{"path":"a.txt"}',
                  },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 7,
          completion_tokens: 3,
          prompt_tokens_details: {
            cached_tokens: 2,
          },
        },
      },
      41,
    );

    expect(converted.finishReason).toBe('tool_use');
    expect(converted.message.tool_calls?.[0]?.function.name).toBe('write_file');
    expect(converted.usage).toEqual({
      promptTokens: 7,
      completionTokens: 3,
      cacheReadTokens: 2,
      cacheWriteTokens: 0,
    });
  });

  it('assembles streaming chunk deltas into tool/text/message_stop events', () => {
    const parser = new OpenAIStreamParser();
    const chunks = [
      ...parser.processChunk({
        choices: [
          {
            delta: {
              content: 'hello',
            },
          },
        ],
      }),
      ...parser.processChunk({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'tc-1',
                  function: {
                    name: 'read_file',
                    arguments: '{"path":"',
                  },
                },
              ],
            },
          },
        ],
      }),
      ...parser.processChunk({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: 'README.md"}',
                  },
                },
              ],
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 4,
        },
      }),
      parser.finish(),
    ];

    expect(chunks.some((chunk) => chunk.type === 'text_delta')).toBe(true);
    expect(
      chunks.some(
        (chunk) =>
          chunk.type === 'tool_use_delta' &&
          chunk.toolCallId === 'tc-1' &&
          chunk.name === 'read_file',
      ),
    ).toBe(true);
    expect(chunks.at(-1)).toEqual({
      type: 'message_stop',
      finishReason: 'stop',
      usage: {
        promptTokens: 10,
        completionTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    });
  });

  it('retries retryable network errors but does not retry auth errors', async () => {
    vi.useFakeTimers();

    let retryableCalls = 0;
    const retryablePromise = withRetry(async () => {
      retryableCalls += 1;
      if (retryableCalls < 3) {
        throw new LLMNetworkError('https://api.openai.com', 'timeout');
      }
      return 'ok';
    });

    await vi.runAllTimersAsync();
    await expect(retryablePromise).resolves.toBe('ok');
    expect(retryableCalls).toBe(3);

    let authCalls = 0;
    await expect(
      withRetry(async () => {
        authCalls += 1;
        throw new LLMAuthError('openai');
      }),
    ).rejects.toBeInstanceOf(LLMAuthError);
    expect(authCalls).toBe(1);
  });
});
