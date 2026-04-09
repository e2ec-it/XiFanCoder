import { describe, expect, it } from 'vitest';

import { runCli } from '../cli.js';

describe('runCli', () => {
  it('falls back to single-task mode for unknown top-level command', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await runCli(['创建一个 hello.ts 文件'], {
      runSingleTaskFn: async ({ message }) => ({
        assistantText: `single:${message}`,
        state: {
          model: 'mock',
          mode: 'build',
          turns: [],
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
          },
        },
      }),
      printStdout: (line) => {
        stdout.push(line);
      },
      printStderr: (line) => {
        stderr.push(line);
      },
    });

    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('single:创建一个 hello.ts 文件');
    expect(stderr).toHaveLength(0);
  });

  it('prints JSON payload in single-task mode when --output json is enabled', async () => {
    const stdout: string[] = [];

    const code = await runCli(['创建一个 hello.ts 文件', '--output', 'json'], {
      runSingleTaskFn: async () => ({
        assistantText: 'ok',
        state: {
          model: 'mock',
          mode: 'build',
          turns: [],
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
          },
        },
      }),
      printStdout: (line) => {
        stdout.push(line);
      },
      printStderr: () => undefined,
    });

    expect(code).toBe(0);
    const payload = JSON.parse(stdout.join('\n')) as {
      type: string;
      assistantText: string;
    };
    expect(payload.type).toBe('single-task');
    expect(payload.assistantText).toBe('ok');
  });

  it('starts repl when no args are provided', async () => {
    let started = 0;
    const code = await runCli([], {
      startReplFn: async () => {
        started += 1;
      },
      printStdout: () => undefined,
      printStderr: () => undefined,
    });

    expect(code).toBe(0);
    expect(started).toBe(1);
  });

  it('rejects json mode for repl and formats errors as json', async () => {
    const stderr: string[] = [];

    const code = await runCli(['--json'], {
      printStdout: () => undefined,
      printStderr: (line) => {
        stderr.push(line);
      },
    });

    expect(code).toBe(1);
    expect(JSON.parse(stderr.join('\n'))).toEqual({
      ok: false,
      error: 'REPL 模式不支持 --json 输出',
    });
  });

  it('executes parsed command in text and json output modes', async () => {
    const stdout: string[] = [];
    const crashContexts: unknown[] = [];

    const textCode = await runCli(['help'], {
      executeTextCommand: async () => 'plain-output',
      executeStructuredCommand: async () => ({ ok: true }),
      printStdout: (line) => {
        stdout.push(line);
      },
      printStderr: () => undefined,
      updateCrashContext: (context) => {
        crashContexts.push(context);
      },
    });

    const jsonCode = await runCli(['help', '--json'], {
      executeTextCommand: async () => 'plain-output',
      executeStructuredCommand: async () => ({ ok: true, type: 'help' }),
      printStdout: (line) => {
        stdout.push(line);
      },
      printStderr: () => undefined,
      updateCrashContext: (context) => {
        crashContexts.push(context);
      },
    });

    expect(textCode).toBe(0);
    expect(jsonCode).toBe(0);
    expect(stdout[0]).toBe('plain-output');
    expect(JSON.parse(stdout[1] ?? '{}')).toEqual({ ok: true, type: 'help' });
    expect(crashContexts.some((item) => JSON.stringify(item).includes('cli.command'))).toBe(true);
  });

  it('prints text errors for invalid output mode and command execution failures', async () => {
    const stderr: string[] = [];

    await expect(
      runCli(['help', '--output', 'yaml'], {
        printStdout: () => undefined,
        printStderr: (line) => {
          stderr.push(line);
        },
      }),
    ).rejects.toThrow('Invalid --output: yaml');

    const failedCommand = await runCli(['help'], {
      executeTextCommand: async () => {
        throw new Error('command failed hard');
      },
      printStdout: () => undefined,
      printStderr: (line) => {
        stderr.push(line);
      },
    });

    expect(failedCommand).toBe(1);
    expect(stderr).toContain('command failed hard');
  });

  it('re-throws non-unknown-command parse errors', async () => {
    const stderr: string[] = [];

    const code = await runCli(['mode', 'set'], {
      executeTextCommand: async () => {
        throw new Error('should not reach here');
      },
      printStdout: () => undefined,
      printStderr: (line) => {
        stderr.push(line);
      },
    });

    expect(code).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  });

  it('formats json error when command execution fails in json mode', async () => {
    const stderr: string[] = [];

    const code = await runCli(['help', '--json'], {
      executeStructuredCommand: async () => {
        throw new Error('structured failed');
      },
      printStdout: () => undefined,
      printStderr: (line) => {
        stderr.push(line);
      },
    });

    expect(code).toBe(1);
    const parsed = JSON.parse(stderr.join('\n')) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe('structured failed');
  });
});
