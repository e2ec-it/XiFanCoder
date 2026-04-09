import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatCompletion } from '../../brain/llm-client.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('chatCompletion', () => {
  it('returns parsed content on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"score": 8}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    });

    const result = await chatCompletion({
      model: 'qwen2.5-coder-32b',
      messages: [{ role: 'user', content: 'evaluate this' }],
    });

    expect(result.content).toBe('{"score": 8}');
    expect(result.usage.promptTokens).toBe(100);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(chatCompletion({
      model: 'qwen2.5-coder-32b',
      messages: [{ role: 'user', content: 'test' }],
    })).rejects.toThrow('LLM API error 500');
  });

  it('throws on empty choices', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [] }),
    });

    await expect(chatCompletion({
      model: 'qwen2.5-coder-32b',
      messages: [{ role: 'user', content: 'test' }],
    })).rejects.toThrow('No response from LLM');
  });

  it('respects custom timeout via AbortSignal', async () => {
    mockFetch.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'late' } }] }) };
    });

    await expect(chatCompletion({
      model: 'qwen2.5-coder-32b',
      messages: [{ role: 'user', content: 'test' }],
      timeoutMs: 50,
    })).rejects.toThrow();
  });
});
