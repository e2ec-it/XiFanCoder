import { describe, expect, it } from 'vitest';

import { OpenInterpreterExecutor } from '../oi.js';
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

describe('OpenInterpreterExecutor', () => {
  it('requires confirm=true for every oi_execute call', async () => {
    const executor = new OpenInterpreterExecutor(
      {
        projectPath: process.cwd(),
        env: {},
      },
      async () => okResult({ stdout: 'interpreter 1.0.0' }),
    );

    await expect(
      executor.executeTool('oi_execute', {
        language: 'python',
        code: 'print(1)',
        confirm: false,
      }),
    ).rejects.toThrowError('confirm=true');
  });

  it('returns install hint when open-interpreter is missing', async () => {
    const executor = new OpenInterpreterExecutor(
      {
        projectPath: process.cwd(),
        env: {},
      },
      async () => okResult({ spawnError: 'spawn python3 ENOENT', exitCode: -1 }),
    );

    await expect(
      executor.executeTool('oi_execute', {
        language: 'python',
        code: 'print(1)',
        confirm: true,
      }),
    ).rejects.toThrowError('pip install open-interpreter');
  });

  it('maps sandbox/model/baseUrl/apiKey to command and env', async () => {
    const calls: ProcessRunInput[] = [];
    const executor = new OpenInterpreterExecutor(
      {
        projectPath: '/tmp/project',
        env: {},
      },
      async (input) => {
        calls.push(input);
        if (calls.length === 1) {
          return okResult({ stdout: 'interpreter 1.0.0' });
        }
        return okResult({ stdout: 'execution done' });
      },
    );

    const result = await executor.executeTool('oi_execute', {
      language: 'python',
      code: 'print(42)',
      sandbox: 'docker',
      confirm: true,
      model: 'gpt-4o-mini',
      baseUrl: 'http://localhost:4000',
      apiKey: 'sk-oi',
    });

    expect(result.sandbox).toBe('docker');
    const execCall = calls[1];
    expect(execCall?.command).toBe('python3');
    expect(execCall?.args[0]).toBe('-c');
    expect(execCall?.env.OI_DOCKER_SANDBOX).toBe('1');
    expect(execCall?.env.OPENAI_API_BASE).toBe('http://localhost:4000');
    expect(execCall?.env.OPENAI_API_KEY).toBe('sk-oi');
    expect(execCall?.inputText).toContain('\"code\":\"print(42)\"');
    expect(execCall?.inputText).toContain('\"model\":\"gpt-4o-mini\"');
    expect(execCall?.inputText).toContain('\"sandbox\":\"docker\"');
  });

  it('validates toolName/language/code and surfaces execution failures', async () => {
    const executor = new OpenInterpreterExecutor(
      {
        projectPath: '/tmp/project',
        env: {},
      },
      async () => okResult({ stdout: 'interpreter 1.0.0' }),
    );

    await expect(executor.executeTool('bad_tool', {})).rejects.toThrowError('unsupported tool');
    await expect(
      executor.executeTool('oi_execute', {
        confirm: true,
        code: 'print(1)',
      }),
    ).rejects.toThrowError('requires language');
    await expect(
      executor.executeTool('oi_execute', {
        confirm: true,
        language: 'python',
      }),
    ).rejects.toThrowError('requires code');
  });

  it('surfaces process timeout and non-zero exit failures', async () => {
    const timeoutExecutor = new OpenInterpreterExecutor(
      {
        projectPath: '/tmp/project',
        env: {},
      },
      async (_input) => okResult({ stdout: 'interpreter 1.0.0', timedOut: false }),
    );

    let calls = 0;
    const failingExecutor = new OpenInterpreterExecutor(
      {
        projectPath: '/tmp/project',
        env: {},
      },
      async () => {
        calls += 1;
        if (calls === 1) {
          return okResult({ stdout: 'interpreter 1.0.0' });
        }
        return okResult({ timedOut: true });
      },
    );

    await expect(
      failingExecutor.executeTool('oi_execute', {
        language: 'python',
        code: 'print(1)',
        confirm: true,
      }),
    ).rejects.toThrowError('timed out');

    calls = 0;
    const exitExecutor = new OpenInterpreterExecutor(
      {
        projectPath: '/tmp/project',
        env: {},
      },
      async () => {
        calls += 1;
        if (calls === 1) {
          return okResult({ stdout: 'interpreter 1.0.0' });
        }
        return okResult({ exitCode: 7, stderr: 'bad stderr' });
      },
    );

    await expect(
      exitExecutor.executeTool('oi_execute', {
        language: 'python',
        code: 'print(1)',
        confirm: true,
      }),
    ).rejects.toThrowError('exit=7');

    await expect(
      timeoutExecutor.checkAvailability(),
    ).resolves.toMatchObject({ available: true });
  });

  it('returns cached availability after first check', async () => {
    let calls = 0;
    const executor = new OpenInterpreterExecutor(
      { projectPath: '/tmp/project', env: {} },
      async () => {
        calls += 1;
        return okResult({ stdout: 'interpreter 1.0.0' });
      },
    );

    const first = await executor.checkAvailability();
    const second = await executor.checkAvailability();
    expect(first).toBe(second);
    expect(calls).toBe(1);
  });

  it('returns unavailable when python import exits non-zero without ENOENT', async () => {
    const executor = new OpenInterpreterExecutor(
      { projectPath: '/tmp/project', env: {} },
      async () => okResult({ exitCode: 2, stdout: '', stderr: 'import error' }),
    );

    await expect(
      executor.executeTool('oi_execute', {
        language: 'python',
        code: 'print(1)',
        confirm: true,
      }),
    ).rejects.toThrowError('open-interpreter python import failed: exit=2');
  });

  it('throws on spawn error during execution', async () => {
    let calls = 0;
    const executor = new OpenInterpreterExecutor(
      { projectPath: '/tmp/project', env: {} },
      async () => {
        calls += 1;
        if (calls === 1) {
          return okResult({ stdout: 'interpreter 1.0.0' });
        }
        return okResult({ spawnError: 'spawn failed', exitCode: -1 });
      },
    );

    await expect(
      executor.executeTool('oi_execute', {
        language: 'python',
        code: 'print(1)',
        confirm: true,
      }),
    ).rejects.toThrowError('open-interpreter process error: spawn failed');
  });
});
