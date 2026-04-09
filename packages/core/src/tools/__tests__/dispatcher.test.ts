import { describe, expect, it, vi } from 'vitest';

import {
  ToolExecutionError,
  ToolNotFoundError,
  ToolPermissionDeniedError,
  ToolTimeoutError,
} from '../../errors/index.js';
import { SessionRuntime } from '../../runtime/index.js';
import {
  createPluginToolDefinition,
  ToolDispatcher,
} from '../dispatcher.js';

describe('ToolDispatcher', () => {
  it('registers/lists/unregisters tools', () => {
    const runtime = new SessionRuntime({ mode: 'build' });
    const dispatcher = new ToolDispatcher(runtime);

    dispatcher.registerTool({
      name: 'read_file',
      permissionLevel: 'L0',
      source: 'builtin',
      execute: async () => 'ok',
    });
    expect(dispatcher.hasTool('read_file')).toBe(true);
    expect(dispatcher.listTools().map((x) => x.name)).toEqual(['read_file']);

    dispatcher.unregisterTool('read_file');
    expect(dispatcher.hasTool('read_file')).toBe(false);
    expect(dispatcher.listTools()).toHaveLength(0);
  });

  it('throws ToolNotFoundError for unknown tool', async () => {
    const runtime = new SessionRuntime({ mode: 'build' });
    const dispatcher = new ToolDispatcher(runtime);

    await expect(dispatcher.executeTool('missing_tool', {})).rejects.toBeInstanceOf(
      ToolNotFoundError,
    );
  });

  it('denies execution by mode policy', async () => {
    const runtime = new SessionRuntime({ mode: 'plan' });
    const dispatcher = new ToolDispatcher(runtime);
    dispatcher.registerTool({
      name: 'write_file',
      permissionLevel: 'L1',
      source: 'builtin',
      execute: async () => 'ok',
    });

    await expect(dispatcher.executeTool('write_file', {})).rejects.toBeInstanceOf(
      ToolPermissionDeniedError,
    );
  });

  it('requires approval for L1 in build mode', async () => {
    const runtime = new SessionRuntime({ mode: 'build' });
    const dispatcher = new ToolDispatcher(runtime, {
      approvalHandler: async () => false,
    });
    dispatcher.registerTool({
      name: 'write_file',
      permissionLevel: 'L1',
      source: 'builtin',
      execute: async () => 'ok',
    });

    await expect(dispatcher.executeTool('write_file', {})).rejects.toBeInstanceOf(
      ToolPermissionDeniedError,
    );
  });

  it('does not require approval for L0 tools in build mode', async () => {
    const runtime = new SessionRuntime({ mode: 'build' });
    const approvalHandler = vi.fn().mockResolvedValue(false);
    const dispatcher = new ToolDispatcher(runtime, { approvalHandler });
    dispatcher.registerTool({
      name: 'read_file',
      permissionLevel: 'L0',
      source: 'builtin',
      execute: async () => 'ok',
    });

    const result = await dispatcher.executeTool('read_file', {});
    expect(result.output).toBe('ok');
    expect(approvalHandler).not.toHaveBeenCalled();
  });

  it('requires approval for L2 in build mode', async () => {
    const runtime = new SessionRuntime({ mode: 'build' });
    const dispatcher = new ToolDispatcher(runtime, {
      approvalHandler: async () => false,
    });
    dispatcher.registerTool({
      name: 'bash_execute',
      permissionLevel: 'L2',
      source: 'builtin',
      execute: async () => 'ok',
    });

    await expect(dispatcher.executeTool('bash_execute', {})).rejects.toBeInstanceOf(
      ToolPermissionDeniedError,
    );
  });

  it('executes tool when approval is granted', async () => {
    const runtime = new SessionRuntime({ mode: 'build' });
    const dispatcher = new ToolDispatcher(runtime, {
      approvalHandler: async () => true,
    });
    dispatcher.registerTool({
      name: 'write_file',
      permissionLevel: 'L1',
      source: 'builtin',
      execute: async (args) => args,
    });

    const result = await dispatcher.executeTool('write_file', { path: 'a.txt' });
    expect(result.toolName).toBe('write_file');
    expect(result.output).toEqual({ path: 'a.txt' });
    expect(result.permission.requiresApproval).toBe(true);
  });

  it('throws timeout error when tool exceeds timeout', async () => {
    const runtime = new SessionRuntime({ mode: 'build' });
    const dispatcher = new ToolDispatcher(runtime, {
      approvalHandler: async () => true,
      defaultTimeoutMs: 20,
    });

    dispatcher.registerTool({
      name: 'slow_tool',
      permissionLevel: 'L1',
      source: 'builtin',
      execute: async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 80);
        });
        return 'done';
      },
    });

    await expect(dispatcher.executeTool('slow_tool', {})).rejects.toBeInstanceOf(ToolTimeoutError);
  });

  it('bridges plugin tool definition and executes through plugin executor', async () => {
    const runtime = new SessionRuntime({ mode: 'build' });
    const dispatcher = new ToolDispatcher(runtime, {
      approvalHandler: async () => true,
    });

    const pluginTool = createPluginToolDefinition(
      {
        pluginName: 'echo',
        toolName: 'echo_text',
        permissionLevel: 'L1',
      },
      {
        execute: async (pluginName, toolName, args) => ({
          pluginName,
          toolName,
          args,
        }),
      },
    );

    dispatcher.registerTool(pluginTool);
    const result = await dispatcher.executeTool('echo:echo_text', { message: 'hi' });

    expect(result.source).toBe('plugin');
    expect(result.pluginName).toBe('echo');
    expect(result.output).toEqual({
      pluginName: 'echo',
      toolName: 'echo_text',
      args: { message: 'hi' },
    });
  });

  it('supports always approval persistence within dispatcher session', async () => {
    const runtime = new SessionRuntime({ mode: 'build' });
    const approvalHandler = vi
      .fn()
      .mockResolvedValueOnce('always')
      .mockResolvedValueOnce(false);

    const dispatcher = new ToolDispatcher(runtime, { approvalHandler });
    dispatcher.registerTool({
      name: 'bash_execute',
      permissionLevel: 'L2',
      source: 'builtin',
      execute: async () => 'ok',
    });

    const first = await dispatcher.executeTool('bash_execute', {});
    const second = await dispatcher.executeTool('bash_execute', {});

    expect(first.output).toBe('ok');
    expect(second.output).toBe('ok');
    expect(approvalHandler).toHaveBeenCalledTimes(1);
  });

  it('supports never approval persistence within dispatcher session', async () => {
    const runtime = new SessionRuntime({ mode: 'build' });
    const approvalHandler = vi
      .fn()
      .mockResolvedValueOnce('never')
      .mockResolvedValueOnce(true);

    const dispatcher = new ToolDispatcher(runtime, { approvalHandler });
    dispatcher.registerTool({
      name: 'bash_execute',
      permissionLevel: 'L2',
      source: 'builtin',
      execute: async () => 'ok',
    });

    await expect(dispatcher.executeTool('bash_execute', {})).rejects.toBeInstanceOf(
      ToolPermissionDeniedError,
    );
    await expect(dispatcher.executeTool('bash_execute', {})).rejects.toBeInstanceOf(
      ToolPermissionDeniedError,
    );
    expect(approvalHandler).toHaveBeenCalledTimes(1);
  });

  it('wraps non-XiFanError thrown by tool execute', async () => {
    const runtime = new SessionRuntime({ mode: 'build' });
    const dispatcher = new ToolDispatcher(runtime);
    dispatcher.registerTool({
      name: 'failing_tool',
      permissionLevel: 'L0',
      source: 'builtin',
      execute: async () => {
        throw new TypeError('unexpected null');
      },
    });

    await expect(dispatcher.executeTool('failing_tool', {})).rejects.toBeInstanceOf(
      ToolExecutionError,
    );
  });

  it('denies L1 tool when no approval handler is configured', async () => {
    const runtime = new SessionRuntime({ mode: 'build' });
    // No approvalHandler means resolveApproval returns false
    const dispatcher = new ToolDispatcher(runtime);
    dispatcher.registerTool({
      name: 'write_file',
      permissionLevel: 'L1',
      source: 'builtin',
      execute: async () => 'ok',
    });

    await expect(dispatcher.executeTool('write_file', {})).rejects.toBeInstanceOf(
      ToolPermissionDeniedError,
    );
  });
});
