import {
  ToolExecutionError,
  ToolNotFoundError,
  ToolPermissionDeniedError,
  ToolTimeoutError,
  XiFanError,
} from '../errors/index.js';
import type {
  PermissionDecision,
  ToolPermissionInput,
  ToolPermissionLevel,
} from '../permissions/index.js';
import { SessionRuntime } from '../runtime/index.js';

export type ToolSource = 'builtin' | 'plugin' | 'mcp';

export interface ToolExecutionContext {
  readonly signal?: AbortSignal;
}

export type ToolExecutor = (args: unknown, context: ToolExecutionContext) => Promise<unknown>;

export interface ToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly permissionLevel: ToolPermissionLevel;
  readonly source: ToolSource;
  readonly pluginName?: string;
  readonly timeoutMs?: number;
  readonly execute: ToolExecutor;
}

export interface ToolApprovalRequest {
  readonly toolName: string;
  readonly permissionLevel: ToolPermissionLevel;
  readonly source: ToolSource;
  readonly pluginName?: string;
  readonly args: unknown;
  readonly decision: PermissionDecision;
}

export type ToolApprovalResponse = boolean | 'always' | 'never';
export type ToolApprovalHandler = (
  request: ToolApprovalRequest,
) => Promise<ToolApprovalResponse> | ToolApprovalResponse;

export interface ToolDispatcherOptions {
  readonly approvalHandler?: ToolApprovalHandler;
  readonly defaultTimeoutMs?: number;
}

export interface ToolExecutionResult {
  readonly toolName: string;
  readonly source: ToolSource;
  readonly pluginName?: string;
  readonly permission: PermissionDecision;
  readonly durationMs: number;
  readonly output: unknown;
}

export interface PluginToolBinding {
  readonly pluginName: string;
  readonly toolName: string;
  readonly permissionLevel: ToolPermissionLevel;
  readonly timeoutMs?: number;
}

export interface PluginToolExecutor {
  execute(pluginName: string, toolName: string, args: unknown): Promise<unknown>;
}

function assertPermissionAllowed(input: ToolPermissionInput, decision: PermissionDecision): void {
  if (!decision.allowed) {
    throw new ToolPermissionDeniedError(
      input.toolName,
      `工具权限被拒绝: reason=${decision.reason} policy=${decision.policySource}`,
    );
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export class ToolDispatcher {
  private readonly runtime: SessionRuntime;
  private readonly options: ToolDispatcherOptions;
  private readonly registry = new Map<string, ToolDefinition>();
  private readonly approvalMemory = new Map<string, boolean>();

  constructor(runtime: SessionRuntime, options: ToolDispatcherOptions = {}) {
    this.runtime = runtime;
    this.options = options;
  }

  registerTool(tool: ToolDefinition): void {
    this.registry.set(tool.name, tool);
  }

  unregisterTool(toolName: string): void {
    this.registry.delete(toolName);
  }

  hasTool(toolName: string): boolean {
    return this.registry.has(toolName);
  }

  listTools(): readonly ToolDefinition[] {
    return Array.from(this.registry.values());
  }

  async executeTool(toolName: string, args: unknown): Promise<ToolExecutionResult> {
    const tool = this.registry.get(toolName);
    if (!tool) {
      throw new ToolNotFoundError(toolName);
    }

    const started = Date.now();
    const permissionInput: ToolPermissionInput = {
      toolName: tool.name,
      permissionLevel: tool.permissionLevel,
    };
    const decision = this.runtime.checkToolPermission(permissionInput);
    assertPermissionAllowed(permissionInput, decision);

    if (decision.requiresApproval) {
      const memorized = this.approvalMemory.get(tool.name);
      const approved = memorized ?? (await this.resolveApproval({
        toolName: tool.name,
        permissionLevel: tool.permissionLevel,
        source: tool.source,
        pluginName: tool.pluginName,
        args,
        decision,
      }));

      if (!approved) {
        throw new ToolPermissionDeniedError(
          tool.name,
          '工具执行需要人工确认，但未通过审批',
        );
      }
    }

    try {
      const timeoutMs = tool.timeoutMs ?? this.options.defaultTimeoutMs ?? 30_000;
      const output = await withTimeout(
        tool.execute(args, {}),
        timeoutMs,
        () => new ToolTimeoutError(tool.name, timeoutMs),
      );

      return {
        toolName: tool.name,
        source: tool.source,
        pluginName: tool.pluginName,
        permission: decision,
        durationMs: Date.now() - started,
        output,
      };
    } catch (error) {
      if (error instanceof XiFanError) {
        throw error;
      }
      throw new ToolExecutionError(
        tool.name,
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
  }

  private async resolveApproval(request: ToolApprovalRequest): Promise<boolean> {
    if (!this.options.approvalHandler) {
      return false;
    }

    const result = await this.options.approvalHandler(request);
    if (result === 'always') {
      this.approvalMemory.set(request.toolName, true);
      return true;
    }
    if (result === 'never') {
      this.approvalMemory.set(request.toolName, false);
      return false;
    }
    return result;
  }
}

export function createPluginToolDefinition(
  binding: PluginToolBinding,
  executor: PluginToolExecutor,
): ToolDefinition {
  return {
    name: `${binding.pluginName}:${binding.toolName}`,
    description: `Plugin tool ${binding.pluginName}:${binding.toolName}`,
    permissionLevel: binding.permissionLevel,
    source: 'plugin',
    pluginName: binding.pluginName,
    timeoutMs: binding.timeoutMs,
    execute: async (args) => {
      return await executor.execute(binding.pluginName, binding.toolName, args);
    },
  };
}
