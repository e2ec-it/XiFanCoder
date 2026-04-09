import { describe, expect, it } from 'vitest';

import {
  CRUSH_TOOL_DESCRIPTORS,
  createCrushStdioClientOptions,
  createCrushToolDefinitions,
  detectCrushAvailability,
} from '../crush.js';

describe('crush mcp helpers', () => {
  it('detects availability from version command', () => {
    const available = detectCrushAvailability(
      'crush',
      () =>
        ({
          status: 0,
        }) as never,
    );
    expect(available.available).toBe(true);

    const unavailable = detectCrushAvailability(
      'crush',
      () =>
        ({
          status: 1,
        }) as never,
    );
    expect(unavailable.available).toBe(false);
  });

  it('creates stdio options with --mcp-server', () => {
    const options = createCrushStdioClientOptions();
    expect(options.transport).toBe('stdio');
    expect(options.command).toBe('crush');
    expect(options.args).toEqual(['--mcp-server']);
  });

  it('creates tool definitions and dispatches to mcp caller', async () => {
    const calls: Array<{
      name: string;
      args: Record<string, unknown>;
    }> = [];
    const defs = createCrushToolDefinitions({
      callTool: async (name, args) => {
        calls.push({ name, args });
        return { ok: true, name, args };
      },
    });

    expect(defs).toHaveLength(CRUSH_TOOL_DESCRIPTORS.length);
    const shell = defs.find((item) => item.name === 'crush_shell');
    expect(shell).toBeDefined();
    if (!shell) {
      throw new Error('crush_shell definition missing');
    }

    const output = await shell.execute({ command: 'echo hello' });
    expect(output).toEqual({
      ok: true,
      name: 'crush_shell',
      args: { command: 'echo hello' },
    });
    expect(calls).toEqual([
      {
        name: 'crush_shell',
        args: { command: 'echo hello' },
      },
    ]);
  });

  it('handles spawn error in version detection', () => {
    const result = detectCrushAvailability(
      'crush',
      () => ({
        status: null,
        error: new Error('ENOENT'),
      }) as never,
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe('ENOENT');
  });

  it('handles spawn throwing an exception', () => {
    const result = detectCrushAvailability(
      'crush',
      () => {
        throw new Error('spawn failed');
      },
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe('spawn failed');
  });

  it('handles non-Error thrown in spawn', () => {
    const result = detectCrushAvailability(
      'crush',
      () => {
        throw 'raw string error';
      },
    );
    expect(result.available).toBe(false);
    expect(result.reason).toBe('raw string error');
  });

  it('reports non-zero exit status', () => {
    const result = detectCrushAvailability(
      'crush',
      () => ({
        status: 127,
      }) as never,
    );
    expect(result.available).toBe(false);
    expect(result.reason).toContain('exit=127');
  });

  it('reports null exit status as -1', () => {
    const result = detectCrushAvailability(
      'crush',
      () => ({
        status: null,
      }) as never,
    );
    expect(result.available).toBe(false);
    expect(result.reason).toContain('exit=-1');
  });

  it('handles non-object args in tool execute', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const defs = createCrushToolDefinitions({
      callTool: async (name, args) => {
        calls.push({ name, args });
        return { ok: true };
      },
    });

    const shell = defs.find((item) => item.name === 'crush_shell')!;
    // Pass a non-object arg (string)
    await shell.execute('not-an-object');
    expect(calls[0]?.args).toEqual({});

    // Pass an array
    calls.length = 0;
    await shell.execute([1, 2, 3]);
    expect(calls[0]?.args).toEqual({});

    // Pass null
    calls.length = 0;
    await shell.execute(null);
    expect(calls[0]?.args).toEqual({});
  });
});
