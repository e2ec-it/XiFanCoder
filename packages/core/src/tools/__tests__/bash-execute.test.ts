import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ToolExecutionError } from '../../errors/tool-errors.js';
import { executeBashCommand } from '../bash-execute.js';

describe.skipIf(process.platform === 'win32')('executeBashCommand', () => {
  it('executes command and captures stdout/stderr/exit code', async () => {
    const result = await executeBashCommand({
      command: "echo 'hello'; echo 'oops' 1>&2",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
    expect(result.stderr).toContain('oops');
    expect(result.timedOut).toBe(false);
  });

  it('marks timedOut when command exceeds timeout', async () => {
    const result = await executeBashCommand({
      command: 'sleep 2',
      timeoutMs: 50,
    });

    expect(result.timedOut).toBe(true);
  });

  it('force kills process when command ignores SIGTERM after timeout', async () => {
    const result = await executeBashCommand({
      command: 'trap "" TERM; while true; do sleep 1; done',
      timeoutMs: 80,
    });

    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(2_000);
    expect(result.signal === 'SIGTERM' || result.signal === 'SIGKILL').toBe(true);
  });

  it('truncates oversized output', async () => {
    const result = await executeBashCommand({
      command: "printf '1234567890'",
      maxStdoutBytes: 5,
    });

    expect(result.stdout).toBe('12345');
    expect(result.stdoutTruncated).toBe(true);
  });

  it('blocks dangerous commands before execution', async () => {
    await expect(
      executeBashCommand({
        command: 'rm -rf /',
      }),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('writes audit logs for executed and blocked commands', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-bash-audit-'));
    const auditLogPath = path.join(root, 'audit.ndjson');

    await executeBashCommand(
      { command: "echo 'ok'" },
      { auditLogPath },
    );
    await expect(
      executeBashCommand(
        { command: 'rm -rf /' },
        { auditLogPath },
      ),
    ).rejects.toBeInstanceOf(ToolExecutionError);

    const lines = fs
      .readFileSync(auditLogPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { decision: string });
    expect(lines.some((entry) => entry.decision === 'executed')).toBe(true);
    expect(lines.some((entry) => entry.decision === 'blocked')).toBe(true);
  });

  it('rejects empty command', async () => {
    await expect(
      executeBashCommand({ command: '' }),
    ).rejects.toBeInstanceOf(ToolExecutionError);
    await expect(
      executeBashCommand({ command: '   ' }),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('rejects invalid working directory', async () => {
    await expect(
      executeBashCommand({
        command: 'echo hi',
        workingDir: '/tmp/nonexistent-xifan-dir-9999',
      }),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('rejects when workingDir is a file, not a directory', async () => {
    const tempFile = path.join(os.tmpdir(), 'xifan-bash-notdir-' + Date.now());
    fs.writeFileSync(tempFile, 'data', 'utf8');
    try {
      await expect(
        executeBashCommand({
          command: 'echo hi',
          workingDir: tempFile,
        }),
      ).rejects.toBeInstanceOf(ToolExecutionError);
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('rejects invalid positive integer parameters', async () => {
    await expect(
      executeBashCommand({
        command: 'echo hi',
        timeoutMs: -1,
      }),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('truncates oversized stderr', async () => {
    const result = await executeBashCommand({
      command: "printf '1234567890' 1>&2",
      maxStderrBytes: 5,
    });

    expect(result.stderr).toBe('12345');
    expect(result.stderrTruncated).toBe(true);
  });

  it('drops subsequent chunks when already at max bytes', async () => {
    // Output much more data than buffer allows to ensure overflow path is hit
    // Using yes + head to generate multi-line output that comes in multiple chunks
    const result = await executeBashCommand({
      command: "yes ABCDEFGHIJ | head -100",
      maxStdoutBytes: 5,
    });

    expect(result.stdout.length).toBeLessThanOrEqual(5);
    expect(result.stdoutTruncated).toBe(true);
  });

  it('handles chunk that exactly fills remaining capacity', async () => {
    const result = await executeBashCommand({
      command: "printf '12345'",
      maxStdoutBytes: 5,
    });

    expect(result.stdout).toBe('12345');
    expect(result.stdoutTruncated).toBe(false);
  });

  it('does not inherit sensitive parent env vars by default', async () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'top-secret';
    try {
      const result = await executeBashCommand({
        command: 'printf "${OPENAI_API_KEY:-}"',
      });
      expect(result.stdout).toBe('');
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });
});
