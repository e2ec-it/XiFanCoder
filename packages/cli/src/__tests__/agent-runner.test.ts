import { describe, it, expect, vi } from 'vitest';

// Mock AgentLoop from @xifan-coder/core
vi.mock('@xifan-coder/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xifan-coder/core')>();
  return {
    ...actual,
    AgentLoop: vi.fn().mockImplementation(({ executeTool }: { executeTool: (name: string, args: unknown) => Promise<unknown> }) => ({
      run: async ({ userInput }: { userInput: string }) => {
        // Simulate one tool call
        await executeTool('read_file', { path: '/foo.ts' });
        return {
          status: 'completed',
          rounds: 1,
          assistantText: `done: ${userInput}`,
          toolCalls: [{ callId: 'c1', toolName: 'read_file', rawArguments: '{}', parsedArguments: {}, output: '', durationMs: 5 }],
        };
      },
    })),
  };
});

import { createObservedAgentRunner } from '../agent-runner.js';

describe('createObservedAgentRunner', () => {
  it('calls session_start before loop and session_end after', async () => {
    const calls: string[] = [];
    const mockBus = {
      executeTool: vi.fn().mockImplementation(async (_p: string, toolName: string) => {
        calls.push(toolName);
        if (toolName === 'agents_session_start') return { content: { sessionId: 'sess-1' } };
        return { content: { ok: true } };
      }),
    };
    const loopDeps = {
      llmDriver: { defaultModel: 'mock', chat: vi.fn() },
      executeTool: vi.fn().mockResolvedValue({ output: 'file content', durationMs: 10 }),
    };

    const runner = createObservedAgentRunner(mockBus as never, loopDeps as never);
    await runner({ message: 'fix bug', state: { turns: [], usageSummary: null } as never });

    expect(calls[0]).toBe('agents_session_start');
    expect(calls).toContain('agents_session_end');
  });

  it('records tool call events via wrapped executeTool', async () => {
    const recordedTools: string[] = [];
    const mockBus = {
      executeTool: vi.fn().mockImplementation(async (_p: string, toolName: string, args: unknown) => {
        if (toolName === 'agents_record_event') {
          recordedTools.push((args as { toolName: string }).toolName);
        }
        if (toolName === 'agents_session_start') return { content: { sessionId: 's1' } };
        return { content: { ok: true } };
      }),
    };
    const loopDeps = {
      llmDriver: { defaultModel: 'mock', chat: vi.fn() },
      executeTool: vi.fn().mockResolvedValue({ output: '', durationMs: 5 }),
    };

    const runner = createObservedAgentRunner(mockBus as never, loopDeps as never);
    await runner({ message: 'test', state: { turns: [], usageSummary: null } as never });

    // AgentLoop mock calls executeTool('read_file') which triggers agents_record_event
    expect(recordedTools).toContain('read_file');
  });

  it('retrieves xifanContext and passes it to loop.run()', async () => {
    const { AgentLoop } = await import('@xifan-coder/core');
    const mockRunFn = vi.fn().mockResolvedValue({
      status: 'completed',
      rounds: 1,
      assistantText: 'done',
      toolCalls: [],
    });
    vi.mocked(AgentLoop).mockImplementation(() => ({ run: mockRunFn }) as never);

    const mockBus = {
      executeTool: vi.fn().mockImplementation(async (_p: string, toolName: string) => {
        if (toolName === 'agents_session_start') return { content: { sessionId: 'sess-ctx' } };
        if (toolName === 'agents_get_context') return { content: 'relevant past experience' };
        return { content: { ok: true } };
      }),
    };
    const loopDeps = {
      llmDriver: { defaultModel: 'mock', chat: vi.fn() },
      executeTool: vi.fn().mockResolvedValue({ output: '', durationMs: 5 }),
    };

    const runner = createObservedAgentRunner(mockBus as never, loopDeps as never);
    await runner({ message: 'do task', state: { turns: [], usageSummary: null } as never });

    expect(mockRunFn).toHaveBeenCalledWith(
      expect.objectContaining({ xifanContext: 'relevant past experience' }),
    );
  });

  it('still runs loop even if agents_get_context throws', async () => {
    const { AgentLoop } = await import('@xifan-coder/core');
    const mockRunFn = vi.fn().mockResolvedValue({
      status: 'completed',
      rounds: 1,
      assistantText: 'done anyway',
      toolCalls: [],
    });
    vi.mocked(AgentLoop).mockImplementation(() => ({ run: mockRunFn }) as never);

    const mockBus = {
      executeTool: vi.fn().mockImplementation(async (_p: string, toolName: string) => {
        if (toolName === 'agents_session_start') return { content: { sessionId: 'sess-err' } };
        if (toolName === 'agents_get_context') throw new Error('context service down');
        return { content: { ok: true } };
      }),
    };
    const loopDeps = {
      llmDriver: { defaultModel: 'mock', chat: vi.fn() },
      executeTool: vi.fn().mockResolvedValue({ output: '', durationMs: 5 }),
    };

    const runner = createObservedAgentRunner(mockBus as never, loopDeps as never);
    // Should not throw — graceful degradation
    const result = await runner({ message: 'still works', state: { turns: [], usageSummary: null } as never });
    expect(result.text).toBe('done anyway');
    // Loop runs with empty xifanContext
    expect(mockRunFn).toHaveBeenCalledWith(
      expect.objectContaining({ xifanContext: '' }),
    );
  });

  it('calls agents_save_episodic after loop completes (fire-and-forget)', async () => {
    const { AgentLoop } = await import('@xifan-coder/core');
    vi.mocked(AgentLoop).mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        status: 'completed',
        rounds: 2,
        assistantText: 'all done',
        toolCalls: [
          { callId: 'c1', toolName: 'write_file', rawArguments: '{}', parsedArguments: {}, output: '', durationMs: 10 },
        ],
      }),
    }) as never);

    const savedPayloads: unknown[] = [];
    const mockBus = {
      executeTool: vi.fn().mockImplementation(async (_p: string, toolName: string, args: unknown) => {
        if (toolName === 'agents_session_start') return { content: { sessionId: 'sess-ep' } };
        if (toolName === 'agents_save_episodic') savedPayloads.push(args);
        return { content: { ok: true } };
      }),
    };
    const loopDeps = {
      llmDriver: { defaultModel: 'mock', chat: vi.fn() },
      executeTool: vi.fn().mockResolvedValue({ output: '', durationMs: 5 }),
    };

    const runner = createObservedAgentRunner(mockBus as never, loopDeps as never);
    await runner({ message: 'save this', state: { turns: [], usageSummary: null } as never });

    // Fire-and-forget — may not be settled yet, give microtasks a chance
    await new Promise((r) => setTimeout(r, 10));

    expect(savedPayloads.length).toBeGreaterThan(0);
    const ep = savedPayloads[0] as { summary: string; payload: { rounds: number; toolCalls: unknown[] }; failed: boolean };
    expect(ep.summary).toContain('save this');
    expect(ep.payload.rounds).toBe(2);
    expect(ep.failed).toBe(false);
  });

  it('buildEpisodicSummary truncates long inputs correctly', async () => {
    const { AgentLoop } = await import('@xifan-coder/core');
    vi.mocked(AgentLoop).mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        status: 'completed',
        rounds: 1,
        assistantText: 'x'.repeat(300),
        toolCalls: [],
      }),
    }) as never);

    const savedPayloads: unknown[] = [];
    const mockBus = {
      executeTool: vi.fn().mockImplementation(async (_p: string, toolName: string, args: unknown) => {
        if (toolName === 'agents_session_start') return { content: { sessionId: 's' } };
        if (toolName === 'agents_save_episodic') savedPayloads.push(args);
        return { content: { ok: true } };
      }),
    };
    const loopDeps = {
      llmDriver: { defaultModel: 'mock', chat: vi.fn() },
      executeTool: vi.fn().mockResolvedValue({ output: '', durationMs: 5 }),
    };

    const longInput = 'a'.repeat(200);
    const runner = createObservedAgentRunner(mockBus as never, loopDeps as never);
    await runner({ message: longInput, state: { turns: [], usageSummary: null } as never });
    await new Promise((r) => setTimeout(r, 10));

    const ep = savedPayloads[0] as { summary: string };
    // Input prefix is capped at 100 chars
    expect(ep.summary.startsWith('a'.repeat(100))).toBe(true);
    // Should NOT contain more than 100 'a' chars at the start
    expect(ep.summary.charAt(100)).not.toBe('a');
  });
});
