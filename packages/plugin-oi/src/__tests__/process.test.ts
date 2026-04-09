import { describe, expect, it } from 'vitest';

import { runProcessCommand } from '../process.js';

describe('runProcessCommand', () => {
  it('captures output and input', async () => {
    const script = [
      "process.stdin.setEncoding('utf8');",
      "let text='';",
      "process.stdin.on('data', (chunk) => { text += chunk; });",
      "process.stdin.on('end', () => {",
      "  process.stdout.write('OUT:' + text.trim() + '\\n');",
      "  process.stderr.write('ERR:warn\\n');",
      '});',
    ].join('\n');

    const result = await runProcessCommand({
      command: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      env: process.env,
      inputText: 'oi-test\n',
      timeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('OUT:oi-test');
    expect(result.stderr).toContain('ERR:warn');
  });

  it('marks timed out commands', async () => {
    const result = await runProcessCommand({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10_000);'],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 50,
    });

    expect(result.timedOut).toBe(true);
  });

  it('captures spawn error for non-existent command', async () => {
    const result = await runProcessCommand({
      command: '/usr/bin/non-existent-binary-xyzzy-12345',
      args: [],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
    });

    expect(result.spawnError).toBeDefined();
    expect(result.spawnError).toContain('ENOENT');
  });

  it('sends SIGKILL to process that ignores SIGTERM after timeout', async () => {
    const script = [
      "process.on('SIGTERM', () => {});",
      'setTimeout(() => {}, 30_000);',
    ].join('\n');

    const result = await runProcessCommand({
      command: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 50,
    });

    expect(result.timedOut).toBe(true);
  }, 10_000);
});
