import { describe, expect, it, vi } from 'vitest';

import { AgentLoop } from '../loop.js';
import type { ILLMDriver, LLMResponse } from '../../llm/index.js';

function createResponse(input: Partial<LLMResponse> & Pick<LLMResponse, 'message'>): LLMResponse {
  return {
    message: input.message,
    finishReason: input.finishReason ?? 'stop',
    usage: input.usage ?? {
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    latencyMs: input.latencyMs ?? 1,
    requestId: input.requestId,
  };
}

describe('AgentLoop', () => {
  it('executes tool calls and appends tool result feedback into next round', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          finishReason: 'tool_use',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: '{"path":"README.md"}',
                },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        createResponse({
          finishReason: 'stop',
          message: {
            role: 'assistant',
            content: 'done',
          },
        }),
      );
    const llmDriver: Pick<ILLMDriver, 'chat'> = {
      chat,
    };
    const executeTool = vi.fn().mockResolvedValue({
      toolName: 'read_file',
      source: 'builtin',
      permission: {
        allowed: true,
        requiresApproval: false,
        reason: 'allowed',
        policySource: 'default',
      },
      durationMs: 8,
      output: { content: 'file-content' },
    });

    const loop = new AgentLoop({
      llmDriver,
      executeTool,
    });
    const result = await loop.run({
      model: 'claude-sonnet-4-6',
      userInput: 'read readme',
    });

    expect(result.status).toBe('completed');
    expect(result.rounds).toBe(2);
    expect(result.assistantText).toBe('done');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.toolName).toBe('read_file');
    expect(executeTool).toHaveBeenCalledWith('read_file', { path: 'README.md' });

    const secondRequest = chat.mock.calls[1]?.[0] as { messages: Array<{ role: string; content: unknown }> } | undefined;
    expect(secondRequest).toBeDefined();
    expect(secondRequest?.messages.some((item) => item.role === 'tool')).toBe(true);
    expect(String(secondRequest?.messages.at(-1)?.content ?? '')).toContain('file-content');
  });

  it('falls back to raw argument payload when tool call arguments are invalid JSON', async () => {
    const llmDriver: Pick<ILLMDriver, 'chat'> = {
      chat: vi
        .fn()
        .mockResolvedValueOnce(
          createResponse({
            finishReason: 'tool_use',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'unsafe',
                    arguments: '{"invalid"',
                  },
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          createResponse({
            finishReason: 'stop',
            message: {
              role: 'assistant',
              content: 'ok',
            },
          }),
        ),
    };
    const executeTool = vi.fn().mockResolvedValue({
      toolName: 'unsafe',
      source: 'builtin',
      permission: {
        allowed: true,
        requiresApproval: false,
        reason: 'allowed',
        policySource: 'default',
      },
      durationMs: 1,
      output: 'ok',
    });

    const loop = new AgentLoop({
      llmDriver,
      executeTool,
    });
    await loop.run({
      model: 'test-model',
      userInput: 'do it',
    });

    expect(executeTool).toHaveBeenCalledWith('unsafe', { _raw: '{"invalid"' });
  });

  it('returns max_rounds status when tool chaining does not converge', async () => {
    const llmDriver: Pick<ILLMDriver, 'chat'> = {
      chat: vi.fn().mockResolvedValue(
        createResponse({
          finishReason: 'tool_use',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-loop',
                type: 'function',
                function: {
                  name: 'repeat',
                  arguments: '{}',
                },
              },
            ],
          },
        }),
      ),
    };
    const executeTool = vi.fn().mockResolvedValue({
      toolName: 'repeat',
      source: 'builtin',
      permission: {
        allowed: true,
        requiresApproval: false,
        reason: 'allowed',
        policySource: 'default',
      },
      durationMs: 1,
      output: 'next',
    });

    const loop = new AgentLoop({
      llmDriver,
      executeTool,
    });
    const result = await loop.run({
      model: 'test-model',
      userInput: 'loop forever',
      maxRounds: 2,
    });

    expect(result.status).toBe('max_rounds');
    expect(result.rounds).toBe(2);
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it('passes output style into the initial user context', async () => {
    const chat = vi.fn().mockResolvedValue(
      createResponse({
        finishReason: 'stop',
        message: {
          role: 'assistant',
          content: 'ok',
        },
      }),
    );
    const llmDriver: Pick<ILLMDriver, 'chat'> = { chat };
    const executeTool = vi.fn();

    const loop = new AgentLoop({
      llmDriver,
      executeTool,
    });
    await loop.run({
      model: 'test-model',
      userInput: 'summarize changes',
      outputStyle: 'bullet',
    });

    const firstRequest = chat.mock.calls[0]?.[0] as { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const userMessage = firstRequest?.messages?.find((item) => item.role === 'user');
    expect(String(userMessage?.content ?? '')).toContain('<output-style>');
    expect(String(userMessage?.content ?? '')).toContain('flat bullet points');
  });

  it('parses empty tool arguments as empty object', async () => {
    const llmDriver: Pick<ILLMDriver, 'chat'> = {
      chat: vi
        .fn()
        .mockResolvedValueOnce(
          createResponse({
            finishReason: 'tool_use',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-empty',
                  type: 'function',
                  function: {
                    name: 'noop',
                    arguments: '   ',
                  },
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          createResponse({
            finishReason: 'stop',
            message: { role: 'assistant', content: 'done' },
          }),
        ),
    };
    const executeTool = vi.fn().mockResolvedValue({
      toolName: 'noop',
      source: 'builtin',
      permission: { allowed: true, requiresApproval: false, reason: 'ok', policySource: 'default' },
      durationMs: 1,
      output: 'ok',
    });

    const loop = new AgentLoop({ llmDriver, executeTool });
    await loop.run({ model: 'test', userInput: 'go' });
    expect(executeTool).toHaveBeenCalledWith('noop', {});
  });

  it('extracts text from array content parts', async () => {
    const llmDriver: Pick<ILLMDriver, 'chat'> = {
      chat: vi.fn().mockResolvedValue(
        createResponse({
          finishReason: 'stop',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'part1' },
              { type: 'image', data: 'img' },
              { type: 'text', text: 'part2' },
            ] as unknown as string,
          },
        }),
      ),
    };

    const loop = new AgentLoop({ llmDriver, executeTool: vi.fn() });
    const result = await loop.run({ model: 'test', userInput: 'test' });
    expect(result.assistantText).toBe('part1part2');
  });

  it('returns empty string for non-string non-array content', async () => {
    const llmDriver: Pick<ILLMDriver, 'chat'> = {
      chat: vi.fn().mockResolvedValue(
        createResponse({
          finishReason: 'stop',
          message: {
            role: 'assistant',
            content: null,
          },
        }),
      ),
    };

    const loop = new AgentLoop({ llmDriver, executeTool: vi.fn() });
    const result = await loop.run({ model: 'test', userInput: 'test' });
    expect(result.assistantText).toBe('');
  });

  it('applies history compression before sending initial request', async () => {
    const chat = vi.fn().mockResolvedValue(
      createResponse({
        finishReason: 'stop',
        message: {
          role: 'assistant',
          content: 'ok',
        },
      }),
    );

    const history = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `long-turn-${index}-${'x'.repeat(64)}`,
    })) as const;

    const loop = new AgentLoop({
      llmDriver: { chat },
      executeTool: vi.fn(),
    });
    await loop.run({
      model: 'test-model',
      userInput: 'final question',
      history,
      historyCompression: {
        enabled: true,
        maxChars: 800,
        preserveRecentMessages: 6,
      },
    });

    const firstRequest = chat.mock.calls[0]?.[0] as { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const messages = firstRequest?.messages ?? [];
    expect(messages.length).toBeLessThan(history.length + 1);
    expect(messages.some((item) => String(item.content).includes('<history-summary'))).toBe(true);
  });
});
