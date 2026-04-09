import { describe, expect, it } from 'vitest';

import { AiderExecutor } from '../aider.js';
import type { ProcessRunInput, ProcessRunResult } from '../process.js';

function okResult(overrides: Partial<ProcessRunResult> = {}): ProcessRunResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: 'ok',
    stderr: '',
    timedOut: false,
    ...overrides,
  };
}

describe('AiderExecutor', () => {
  it('returns clear install hint when aider is missing', async () => {
    const executor = new AiderExecutor(
      {
        projectPath: process.cwd(),
        env: {},
      },
      async () => okResult({ spawnError: 'spawn aider ENOENT', exitCode: -1 }),
    );

    await expect(
      executor.executeTool('aider_edit', {
        files: ['src/index.ts'],
        instruction: 'update file',
      }),
    ).rejects.toThrowError('pip install aider-chat');
  });

  it('builds aider_edit command with files, model, and no-auto-commits', async () => {
    const calls: ProcessRunInput[] = [];
    const executor = new AiderExecutor(
      {
        projectPath: '/tmp/project',
        env: {},
      },
      async (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return okResult({ stdout: 'aider 0.80.0' });
        }
        return okResult({ stdout: 'updated src/index.ts' });
      },
    );

    const result = await executor.executeTool('aider_edit', {
      files: ['src/index.ts', 'README.md'],
      instruction: 'refactor module',
      model: 'gpt-4o-mini',
      baseUrl: 'http://localhost:4000',
      apiKey: 'sk-test',
      mapTokens: 2048,
    });

    expect(result.tool).toBe('aider_edit');
    const editCall = calls[1];
    expect(editCall?.args).toContain('--no-auto-commits');
    expect(editCall?.args).toContain('--yes-always');
    expect(editCall?.args).toContain('--model');
    expect(editCall?.args).toContain('gpt-4o-mini');
    expect(editCall?.args).toContain('--map-tokens');
    expect(editCall?.args).toContain('2048');
    expect(editCall?.inputText).toContain('refactor module');
    expect(editCall?.env.OPENAI_API_BASE).toBe('http://localhost:4000');
    expect(editCall?.env.OPENAI_API_KEY).toBe('sk-test');
  });

  it('supports aider_commit and aider_undo commands', async () => {
    const calls: ProcessRunInput[] = [];
    const executor = new AiderExecutor(
      {
        projectPath: '/tmp/project',
        env: {},
      },
      async (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return okResult({ stdout: 'aider 0.80.0' });
        }
        return okResult({ stdout: 'done' });
      },
    );

    const committed = await executor.executeTool('aider_commit', {
      files: ['src/index.ts'],
      message: 'chore: adjust output',
    });
    expect(committed.tool).toBe('aider_commit');
    expect(calls[1]?.inputText).toContain('/commit chore: adjust output');

    const undone = await executor.executeTool('aider_undo', {});
    expect(undone.tool).toBe('aider_undo');
    expect(calls[2]?.inputText).toContain('/undo');
  });

  it('throws for unsupported tool name', async () => {
    const executor = new AiderExecutor(
      { projectPath: '/tmp/project', env: {} },
      async () => okResult({ stdout: 'aider 0.80.0' }),
    );

    await expect(
      executor.executeTool('aider_unknown', {}),
    ).rejects.toThrowError('unsupported tool: aider_unknown');
  });

  it('returns unavailable when aider --version exits non-zero without ENOENT', async () => {
    const executor = new AiderExecutor(
      { projectPath: '/tmp/project', env: {} },
      async () => okResult({ exitCode: 1, stdout: '', stderr: 'error' }),
    );

    await expect(
      executor.executeTool('aider_edit', {
        files: ['src/index.ts'],
        instruction: 'update file',
      }),
    ).rejects.toThrowError('aider --version failed: exit=1');
  });

  it('throws when aider_edit receives empty files array', async () => {
    const executor = new AiderExecutor(
      { projectPath: '/tmp/project', env: {} },
      async () => okResult({ stdout: 'aider 0.80.0' }),
    );

    await expect(
      executor.executeTool('aider_edit', { files: [], instruction: 'do something' }),
    ).rejects.toThrowError('aider_edit requires non-empty files');
  });

  it('throws when aider_edit receives empty instruction', async () => {
    const executor = new AiderExecutor(
      { projectPath: '/tmp/project', env: {} },
      async () => okResult({ stdout: 'aider 0.80.0' }),
    );

    await expect(
      executor.executeTool('aider_edit', { files: ['a.ts'], instruction: '   ' }),
    ).rejects.toThrowError('aider_edit requires instruction');
  });

  it('throws on spawn error in toExecutionResult', async () => {
    let callCount = 0;
    const executor = new AiderExecutor(
      { projectPath: '/tmp/project', env: {} },
      async () => {
        callCount++;
        if (callCount === 1) {
          return okResult({ stdout: 'aider 0.80.0' });
        }
        return okResult({ spawnError: 'spawn failed', exitCode: -1 });
      },
    );

    await expect(
      executor.executeTool('aider_commit', { files: ['a.ts'] }),
    ).rejects.toThrowError('aider process error: spawn failed');
  });

  it('throws on timeout in toExecutionResult', async () => {
    let callCount = 0;
    const executor = new AiderExecutor(
      { projectPath: '/tmp/project', env: {} },
      async () => {
        callCount++;
        if (callCount === 1) {
          return okResult({ stdout: 'aider 0.80.0' });
        }
        return okResult({ timedOut: true, exitCode: -1 });
      },
    );

    await expect(
      executor.executeTool('aider_undo', {}),
    ).rejects.toThrowError('aider timed out after command execution');
  });

  it('throws on non-zero exit code in toExecutionResult', async () => {
    let callCount = 0;
    const executor = new AiderExecutor(
      { projectPath: '/tmp/project', env: {} },
      async () => {
        callCount++;
        if (callCount === 1) {
          return okResult({ stdout: 'aider 0.80.0' });
        }
        return okResult({ exitCode: 2, stderr: 'bad args' });
      },
    );

    await expect(
      executor.executeTool('aider_edit', { files: ['a.ts'], instruction: 'fix' }),
    ).rejects.toThrowError('aider command failed: exit=2 stderr=bad args');
  });
});
