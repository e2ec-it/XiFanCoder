export type PluginToolLevel = 'L0' | 'L1' | 'L2' | 'L3';

export interface PluginToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly level: PluginToolLevel;
  readonly inputSchema?: Record<string, unknown>;
}

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly tools: readonly PluginToolDefinition[];
  readonly commands?: readonly string[];
}

export interface PluginContext {
  readonly sessionId?: string;
  readonly projectPath?: string;
}

export interface PluginExecutionResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

export interface XiFanPlugin {
  readonly manifest: PluginManifest;
  initialize?(): Promise<void> | void;
  executeTool(
    toolName: string,
    args: unknown,
    context?: PluginContext,
  ): Promise<PluginExecutionResult> | PluginExecutionResult;
  destroy?(): Promise<void> | void;
}
