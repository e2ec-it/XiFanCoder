import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createSubAgentToolDefinition, SubAgentManager } from '../sub-agent-manager.js';

describe('SubAgentManager', () => {
  it('runs sub-agent with isolated history and context file injection', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-sub-agent-'));
    const contextFile = path.join(root, 'ctx.txt');
    fs.writeFileSync(contextFile, 'context from file', 'utf8');

    const run = vi.fn().mockResolvedValue({
      status: 'completed',
      rounds: 1,
      assistantText: 'sub-agent done',
      messages: [],
      toolCalls: [],
      lastResponse: {
        message: { role: 'assistant', content: 'sub-agent done' },
        finishReason: 'stop',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        latencyMs: 1,
      },
    });

    const manager = new SubAgentManager({
      createLoop: () => ({ run }),
    });
    const result = await manager.run({
      prompt: 'summarize it',
      model: 'claude-haiku-4-5',
      contextFiles: [contextFile],
      maxRounds: 3,
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('sub-agent done');
    expect(run).toHaveBeenCalledTimes(1);
    const runInput = run.mock.calls[0]?.[0];
    expect(runInput.history).toEqual([]);
    expect(runInput.userInput).toContain('<sub-agent-context');
    expect(runInput.userInput).toContain('context from file');
  });

  it('queues tasks when max concurrent limit is reached', async () => {
    const release: Array<() => void> = [];
    const started: string[] = [];
    const run = vi.fn().mockImplementation(async (input: { userInput: string }) => {
      started.push(input.userInput);
      await new Promise<void>((resolve) => {
        release.push(resolve);
      });
      return {
        status: 'completed',
        rounds: 1,
        assistantText: input.userInput,
        messages: [],
        toolCalls: [],
        lastResponse: {
          message: { role: 'assistant', content: input.userInput },
          finishReason: 'stop',
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
          latencyMs: 1,
        },
      };
    });

    const manager = new SubAgentManager(
      {
        createLoop: () => ({ run }),
      },
      {
        maxConcurrent: 1,
      },
    );

    const first = manager.run({
      taskId: 'task-1',
      prompt: 'first',
      model: 'model',
    });
    const second = manager.run({
      taskId: 'task-2',
      prompt: 'second',
      model: 'model',
    });

    await Promise.resolve();
    expect(started).toEqual(['first']);
    release.shift()?.();

    await first;
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(started).toEqual(['first', 'second']);
    release.shift()?.();

    const secondResult = await second;
    const firstResult = await first;
    expect(firstResult.status).toBe('completed');
    expect(secondResult.status).toBe('completed');
  });

  it('supports cancellation before execution starts', async () => {
    const run = vi.fn().mockResolvedValue({
      status: 'completed',
      rounds: 1,
      assistantText: 'done',
      messages: [],
      toolCalls: [],
      lastResponse: {
        message: { role: 'assistant', content: 'done' },
        finishReason: 'stop',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        latencyMs: 1,
      },
    });
    const manager = new SubAgentManager({
      createLoop: () => ({ run }),
    });

    manager.cancel('task-cancelled');
    const result = await manager.run({
      taskId: 'task-cancelled',
      prompt: 'ignore',
      model: 'model',
    });

    expect(result.status).toBe('cancelled');
    expect(run).not.toHaveBeenCalled();
  });

  it('returns timeout status when task exceeds timeoutMs', async () => {
    const run = vi.fn().mockImplementation(
      () => new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('should not reach')), 10_000);
      }),
    );

    const manager = new SubAgentManager({
      createLoop: () => ({ run }),
      now: () => new Date('2026-01-01T00:00:00Z'),
    });

    const result = await manager.run({
      taskId: 'timeout-task',
      prompt: 'do something slow',
      model: 'model',
      timeoutMs: 10,
    });

    expect(result.status).toBe('timeout');
    expect(result.error).toBe('sub_agent_timeout');
    expect(result.rounds).toBe(0);
  });

  it('returns failed status when loop throws a non-timeout error', async () => {
    const run = vi.fn().mockRejectedValue(new Error('loop_crashed'));

    const manager = new SubAgentManager({
      createLoop: () => ({ run }),
      now: () => new Date('2026-01-01T00:00:00Z'),
    });

    const result = await manager.run({
      taskId: 'fail-task',
      prompt: 'crash',
      model: 'model',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('loop_crashed');
  });

  it('returns failed status when loop throws with timeoutMs set but before timeout', async () => {
    const run = vi.fn().mockRejectedValue(new Error('early_failure'));

    const manager = new SubAgentManager({
      createLoop: () => ({ run }),
      now: () => new Date('2026-01-01T00:00:00Z'),
    });

    const result = await manager.run({
      taskId: 'early-fail',
      prompt: 'crash early',
      model: 'model',
      timeoutMs: 60_000, // Long timeout, but promise rejects immediately
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('early_failure');
  });

  it('detects cancellation after loop completes', async () => {
    let managerRef: SubAgentManager;
    const run = vi.fn().mockImplementation(async () => {
      // Cancel during loop execution
      managerRef.cancel('cancel-after');
      return {
        status: 'completed',
        rounds: 2,
        assistantText: 'done',
        messages: [],
        toolCalls: [],
        lastResponse: {
          message: { role: 'assistant', content: 'done' },
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          latencyMs: 1,
        },
      };
    });

    managerRef = new SubAgentManager({
      createLoop: () => ({ run }),
      now: () => new Date('2026-01-01T00:00:00Z'),
    });

    const result = await managerRef.run({
      taskId: 'cancel-after',
      prompt: 'work',
      model: 'model',
    });

    expect(result.status).toBe('cancelled');
    expect(result.rounds).toBe(2);
  });

  it('listActive returns currently running tasks', async () => {
    let releaseLoop: () => void;
    const run = vi.fn().mockImplementation(
      () => new Promise<{ status: string; rounds: number; assistantText: string; messages: never[]; toolCalls: never[]; lastResponse: unknown }>((resolve) => {
        releaseLoop = () => resolve({
          status: 'completed',
          rounds: 1,
          assistantText: 'ok',
          messages: [],
          toolCalls: [],
          lastResponse: {
            message: { role: 'assistant', content: 'ok' },
            finishReason: 'stop',
            usage: { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            latencyMs: 1,
          },
        });
      }),
    );

    const manager = new SubAgentManager({
      createLoop: () => ({ run }),
      now: () => new Date('2026-01-01T00:00:00Z'),
    });

    const promise = manager.run({
      taskId: 'active-1',
      parentSessionId: 'parent-1',
      prompt: 'hello',
      model: 'model',
    });

    await Promise.resolve();
    const active = manager.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]?.taskId).toBe('active-1');
    expect(active[0]?.parentSessionId).toBe('parent-1');

    releaseLoop!();
    await promise;
    expect(manager.listActive()).toHaveLength(0);
  });

  it('cancel returns false for unknown taskId', () => {
    const manager = new SubAgentManager({
      createLoop: () => ({ run: vi.fn() }),
    });
    expect(manager.cancel('nonexistent')).toBe(false);
  });

  it('normalizeSubAgentTaskArgs validates required fields via tool definition', async () => {
    const manager = new SubAgentManager({
      createLoop: () => ({
        run: vi.fn().mockResolvedValue({
          status: 'completed',
          rounds: 1,
          assistantText: 'ok',
          messages: [],
          toolCalls: [],
          lastResponse: {
            message: { role: 'assistant', content: 'ok' },
            finishReason: 'stop',
            usage: { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            latencyMs: 1,
          },
        }),
      }),
    });

    const tool = createSubAgentToolDefinition(manager);

    // Missing args
    await expect(tool.execute(null, {})).rejects.toThrow('must be an object');
    // Missing prompt
    await expect(tool.execute({ model: 'x' }, {})).rejects.toThrow('prompt is required');
    // Missing model
    await expect(tool.execute({ prompt: 'hi' }, {})).rejects.toThrow('model is required');
  });

  it('normalizeSubAgentTaskArgs handles optional fields with correct types', async () => {
    const run = vi.fn().mockResolvedValue({
      status: 'completed',
      rounds: 1,
      assistantText: 'ok',
      messages: [],
      toolCalls: [],
      lastResponse: {
        message: { role: 'assistant', content: 'ok' },
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        latencyMs: 1,
      },
    });

    const manager = new SubAgentManager({
      createLoop: () => ({ run }),
      readFile: async () => 'mock-content',
      now: () => new Date('2026-01-01T00:00:00Z'),
    });

    const tool = createSubAgentToolDefinition(manager);
    const result = await tool.execute({
      prompt: 'hello',
      model: 'test-model',
      taskId: 'tid-1',
      parentSessionId: 'psid-1',
      outputStyle: 'concise',
      systemPrompt: 'you are helpful',
      contextFiles: ['a.ts', 42, 'b.ts'],
      maxRounds: 5,
      timeoutMs: 3000,
    }, {});

    expect(result).toMatchObject({ status: 'completed' });
    // Verify contextFiles filtered non-strings
    const callInput = run.mock.calls[0]?.[0];
    expect(callInput.userInput).not.toContain('42');
    expect(callInput.userInput).toContain('mock-content');
  });

  it('runs without contextFiles and uses defaults', async () => {
    const run = vi.fn().mockResolvedValue({
      status: 'completed',
      rounds: 1,
      assistantText: 'no context',
      messages: [],
      toolCalls: [],
      lastResponse: {
        message: { role: 'assistant', content: 'no context' },
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        latencyMs: 1,
      },
    });

    const manager = new SubAgentManager({
      createLoop: () => ({ run }),
    });

    const result = await manager.run({
      prompt: 'simple task',
      model: 'model',
    });

    expect(result.status).toBe('completed');
    expect(result.taskId).toBeTruthy(); // auto-generated UUID
    const callInput = run.mock.calls[0]?.[0];
    expect(callInput.userInput).toBe('simple task');
  });

  it('exposes sub-agent as a built-in tool definition', async () => {
    const manager = new SubAgentManager({
      createLoop: () => ({
        run: async () => ({
          status: 'completed',
          rounds: 1,
          assistantText: 'merged result',
          messages: [],
          toolCalls: [],
          lastResponse: {
            message: { role: 'assistant', content: 'merged result' },
            finishReason: 'stop',
            usage: {
              promptTokens: 0,
              completionTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
            latencyMs: 1,
          },
        }),
      }),
    });

    const tool = createSubAgentToolDefinition(manager);
    const out = await tool.execute({
      prompt: 'summarize',
      model: 'claude-haiku-4-5',
    }, {});

    expect(tool.name).toBe('sub_agent');
    expect(tool.permissionLevel).toBe('L1');
    expect(out).toMatchObject({
      status: 'completed',
      output: 'merged result',
      rounds: 1,
    });
  });
});
