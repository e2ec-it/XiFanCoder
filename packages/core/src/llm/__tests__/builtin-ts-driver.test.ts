import { describe, expect, it, vi } from 'vitest';

import { BuiltinTSDriver } from '../builtin-ts-driver.js';
import type { ILLMAdapter, LLMRequest, LLMResponse, ProviderConfig, StreamChunk } from '../types.js';

function makeAdapter(overrides: Partial<ILLMAdapter> = {}): ILLMAdapter {
  return {
    chat: vi.fn().mockResolvedValue({
      message: { role: 'assistant', content: 'hello' },
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      latencyMs: 42,
      requestId: 'req-1',
    } satisfies LLMResponse),
    stream: vi.fn().mockReturnValue((async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text_delta', delta: 'hi' };
      yield {
        type: 'message_stop',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
    })()),
    countTokens: vi.fn().mockReturnValue(42),
    getModels: vi.fn().mockResolvedValue([{ id: 'gpt-4o', object: 'model' }]),
    ...overrides,
  };
}

const config: ProviderConfig = { type: 'openai', model: 'gpt-4o' };

describe('BuiltinTSDriver', () => {
  it('delegates chat to adapter and reports usage', async () => {
    const onUsage = vi.fn();
    const adapter = makeAdapter();
    const driver = new BuiltinTSDriver(adapter, config, onUsage);

    const req: LLMRequest = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] };
    const res = await driver.chat(req);

    expect(res.message.content).toBe('hello');
    expect(onUsage).toHaveBeenCalledWith(res.usage, 'gpt-4o', 'req-1');
  });

  it('delegates stream to adapter via streamWithFallback', async () => {
    const adapter = makeAdapter();
    const driver = new BuiltinTSDriver(adapter, config);

    const req: LLMRequest = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] };
    const chunks: StreamChunk[] = [];
    for await (const chunk of driver.stream(req)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('delegates countTokens to adapter', () => {
    const adapter = makeAdapter();
    const driver = new BuiltinTSDriver(adapter, config);

    const count = driver.countTokens([{ role: 'user', content: 'test' }]);
    expect(count).toBe(42);
  });

  it('delegates getModels to adapter', async () => {
    const adapter = makeAdapter();
    const driver = new BuiltinTSDriver(adapter, config);

    const models = await driver.getModels();
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('gpt-4o');
  });
});
