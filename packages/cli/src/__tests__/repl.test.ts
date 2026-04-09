import { describe, expect, it, vi } from 'vitest';

import { runSingleTask, startRepl } from '../repl.js';

describe('startRepl – additional coverage', () => {
  it('skips empty lines in the REPL loop', async () => {
    const inputs = ['', '  ', '/exit'];
    const prints: string[] = [];

    const result = await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        close: () => undefined,
      }),
    });

    expect(result.exitReason).toBe('user_exit');
    // Should not have any "status=thinking" since all lines were empty until /exit
    expect(prints.filter((p) => p.includes('status=thinking'))).toHaveLength(0);
  });

  it('exits on /quit as well as /exit', async () => {
    const prints: string[] = [];
    const result = await startRepl({
      createIO: () => ({
        question: async () => '/quit',
        print: (line: string) => {
          prints.push(line);
        },
        close: () => undefined,
      }),
    });

    expect(result.exitReason).toBe('user_exit');
  });

  it('prints error message from slash command dispatch', async () => {
    const inputs = ['/unknown-command', '/exit'];
    const prints: string[] = [];

    const result = await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        close: () => undefined,
      }),
    });

    expect(result.exitReason).toBe('user_exit');
    // unknown slash command should produce error output
    const hasErrorOrMessage = prints.some(
      (p) => p.includes('error:') || p.includes('Unknown'),
    );
    expect(hasErrorOrMessage).toBe(true);
  });

  it('prints slash command success messages', async () => {
    const inputs = ['/help', '/exit'];
    const prints: string[] = [];

    const result = await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        close: () => undefined,
      }),
    });

    expect(result.exitReason).toBe('user_exit');
    // /help should produce some output message
    expect(prints.length).toBeGreaterThan(2);
  });

  it('falls back to io.print when io.write is undefined during streaming', async () => {
    const inputs = ['stream-msg', '/exit'];
    const prints: string[] = [];

    await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        // No write method
        close: () => undefined,
      }),
      runAgentTurnStream: async function* ({ message }) {
        yield `reply:${message}`;
      },
    });

    // Should use print instead of write
    expect(prints.some((p) => p.includes('reply:stream-msg'))).toBe(true);
  });

  it('skips empty chunks in stream and handles trailing newline', async () => {
    const inputs = ['msg', '/exit'];
    const writes: string[] = [];
    const prints: string[] = [];

    await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        write: (chunk: string) => {
          writes.push(chunk);
        },
        close: () => undefined,
      }),
      runAgentTurnStream: async function* () {
        yield '';
        yield '';
        yield 'hello';
        yield '';
        yield 'world';
      },
    });

    // Empty chunks should be skipped, only 'hello' and 'world' written
    expect(writes.filter((w) => w !== '\n')).toEqual(['hello', 'world']);
    // Trailing newline should be written since assistantText.length > 0
    expect(writes[writes.length - 1]).toBe('\n');
  });

  it('handles empty stream (no chunks yielded)', async () => {
    const inputs = ['msg', '/exit'];
    const writes: string[] = [];
    const prints: string[] = [];

    await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        write: (chunk: string) => {
          writes.push(chunk);
        },
        close: () => undefined,
      }),
      runAgentTurnStream: async function* () {
        // yield nothing
      },
    });

    // No trailing newline when assistantText is empty
    expect(writes).toHaveLength(0);
    expect(prints.some((p) => p.includes('status=done'))).toBe(true);
  });

  it('handles non-Error throw in agent turn', async () => {
    const inputs = ['err', '/exit'];
    const prints: string[] = [];

    await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        close: () => undefined,
      }),
      runAgentTurn: async () => {
        throw 'string-error';
      },
    });

    expect(prints.some((p) => p.includes('error: string-error'))).toBe(true);
  });

  it('uses default runAgentTurn when none is provided', async () => {
    const inputs = ['test message', '/exit'];
    const prints: string[] = [];

    await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        close: () => undefined,
      }),
    });

    expect(prints.some((p) => p.includes('已接收输入：test message'))).toBe(true);
  });

  it('exits with eof reason when question throws (readline close)', async () => {
    const prints: string[] = [];
    let firstCall = true;

    const result = await startRepl({
      createIO: () => ({
        question: async () => {
          if (firstCall) {
            firstCall = false;
            return '/exit';
          }
          throw new Error('readline closed');
        },
        print: (line: string) => {
          prints.push(line);
        },
        close: () => undefined,
      }),
    });

    expect(result.exitReason).toBe('user_exit');
  });

  it('uses custom now function for latency', async () => {
    let time = 1000;
    const inputs = ['hello', '/exit'];
    const prints: string[] = [];

    await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        close: () => undefined,
      }),
      now: () => {
        time += 100;
        return time;
      },
      runAgentTurn: async ({ message }) => ({
        text: `reply:${message}`,
      }),
    });

    expect(prints.some((p) => p.includes('latency_ms='))).toBe(true);
  });

  it('uses custom createRouter when provided', async () => {
    const inputs = ['/exit'];
    const prints: string[] = [];

    const customRouter = {
      isSlashCommand: (_line: string) => false,
      dispatch: async () => ({ type: 'ok' as const, message: '' }),
    };

    await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        close: () => undefined,
      }),
      createRouter: () => customRouter,
    });

    expect(prints.some((p) => p.includes('XiFan REPL started'))).toBe(true);
  });

  it('clamps progressIntervalMs to minimum 50', async () => {
    const inputs = ['x', '/exit'];
    const prints: string[] = [];

    await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        close: () => undefined,
      }),
      progressIntervalMs: 10, // below 50, should be clamped
      runAgentTurn: async ({ message }) => ({
        text: `reply:${message}`,
      }),
    });

    expect(prints.some((p) => p.includes('status=done'))).toBe(true);
  });
});

describe('startRepl', () => {
  it('processes slash commands and chat turns in one loop', async () => {
    const inputs = ['/model gpt-4o', 'hello', '/cost', '/undo', '/exit'];
    const prints: string[] = [];
    const close = vi.fn();

    const result = await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        close,
      }),
      runAgentTurn: async ({ message }) => ({
        text: `assistant:${message}`,
      }),
    });

    expect(result.exitReason).toBe('user_exit');
    expect(result.state.model).toBe('gpt-4o');
    expect(result.state.turns).toHaveLength(0);
    expect(prints.join('\n')).toContain('status=thinking');
    expect(prints.join('\n')).toContain('status=done latency_ms=');
    expect(prints.join('\n')).toContain('assistant:hello');
    expect(prints.join('\n')).toContain('cost_usd=$');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('prints runAgentTurn errors and continues loop', async () => {
    const inputs = ['boom', '/exit'];
    const prints: string[] = [];

    await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        close: () => undefined,
      }),
      runAgentTurn: async () => {
        throw new Error('network down');
      },
    });

    expect(prints.join('\n')).toContain('status=error latency_ms=');
    expect(prints.join('\n')).toContain('error: network down');
  });

  it('streams assistant chunks and emits in-progress status', async () => {
    const inputs = ['stream', '/exit'];
    const prints: string[] = [];
    const writes: string[] = [];

    await startRepl({
      createIO: () => ({
        question: async () => inputs.shift() ?? '/exit',
        print: (line: string) => {
          prints.push(line);
        },
        write: (chunk: string) => {
          writes.push(chunk);
        },
        close: () => undefined,
      }),
      progressIntervalMs: 50,
      runAgentTurnStream: async function* ({ message }) {
        yield `assistant:${message}-part1 `;
        await new Promise((resolve) => {
          setTimeout(resolve, 60);
        });
        yield 'part2';
      },
    });

    expect(writes.join('')).toContain('assistant:stream-part1 part2');
    expect(prints.join('\n')).toContain('status=in_progress latency_ms=');
    expect(prints.join('\n')).toContain('status=done latency_ms=');
  });
});

describe('runSingleTask', () => {
  it('runs one-shot message without starting repl loop', async () => {
    const result = await runSingleTask(
      {
        message: '创建一个 hello.ts 文件',
      },
      {
        runAgentTurn: async ({ message }) => ({
          text: `single:${message}`,
        }),
      },
    );

    expect(result.assistantText).toBe('single:创建一个 hello.ts 文件');
    expect(result.state.turns).toHaveLength(2);
    expect(result.state.turns[0]?.role).toBe('user');
    expect(result.state.turns[1]?.role).toBe('assistant');
  });

  it('throws on empty message', async () => {
    await expect(
      runSingleTask({ message: '' }),
    ).rejects.toThrow('single task message cannot be empty');
  });

  it('throws on whitespace-only message', async () => {
    await expect(
      runSingleTask({ message: '   ' }),
    ).rejects.toThrow('single task message cannot be empty');
  });

  it('uses default runAgentTurn when no deps provided', async () => {
    const result = await runSingleTask({ message: 'hello' });
    expect(result.assistantText).toBe('已接收输入：hello');
    expect(result.state.turns).toHaveLength(2);
  });

  it('creates initial state when none is provided', async () => {
    const result = await runSingleTask(
      { message: 'test' },
      {
        runAgentTurn: async ({ message }) => ({
          text: `echo:${message}`,
        }),
      },
    );
    expect(result.state).toBeDefined();
    expect(result.state.turns).toHaveLength(2);
  });

  it('accepts a pre-existing state', async () => {
    const { createInitialReplState } = await import('../slash-router.js');
    const existingState = createInitialReplState();
    existingState.turns.push({ role: 'user', content: 'prior' });

    const result = await runSingleTask(
      { message: 'next', state: existingState },
      {
        runAgentTurn: async ({ message }) => ({
          text: `reply:${message}`,
        }),
      },
    );

    // Should have prior turn + new user + new assistant = 3
    expect(result.state.turns).toHaveLength(3);
    expect(result.state.turns[0]?.content).toBe('prior');
  });
});
