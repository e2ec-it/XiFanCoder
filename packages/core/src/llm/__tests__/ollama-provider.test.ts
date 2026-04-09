import { describe, expect, it, vi } from 'vitest';

const openaiAdapterCtorCalls: Array<{
  apiKey: string;
  variant: string;
  baseUrl?: string;
}> = [];

vi.mock('../adapters/openai-adapter.js', () => {
  class OpenAIAdapter {
    constructor(apiKey: string, variant: string, baseUrl?: string) {
      openaiAdapterCtorCalls.push({ apiKey, variant, baseUrl });
    }

    async chat(): Promise<never> {
      throw new Error('not used');
    }

    async *stream(): AsyncGenerator<never> {
      return;
    }

    countTokens(): number {
      return 0;
    }

    async getModels(): Promise<readonly []> {
      return [];
    }
  }

  return { OpenAIAdapter };
});

import { createDriver } from '../driver-factory.js';

describe('ollama provider contract', () => {
  it('uses ollama-compatible adapter and default local baseURL', () => {
    openaiAdapterCtorCalls.length = 0;

    const driver = createDriver({
      type: 'ollama',
      model: 'qwen2.5-coder:7b',
    });

    expect(driver.providerType).toBe('ollama');
    expect(openaiAdapterCtorCalls[0]).toEqual({
      apiKey: 'ollama',
      variant: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
    });
  });

  it('respects custom ollama baseURL', () => {
    openaiAdapterCtorCalls.length = 0;

    createDriver({
      type: 'ollama',
      model: 'llama3.1',
      baseUrl: 'http://127.0.0.1:11435/v1',
    });

    expect(openaiAdapterCtorCalls[0]?.baseUrl).toBe('http://127.0.0.1:11435/v1');
  });
});
