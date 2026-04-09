export type PluginType = 'stdio' | 'node' | 'python';
export type PluginStatus = 'unloaded' | 'loading' | 'ready' | 'executing' | 'error' | 'disabled';
export type ToolPermissionLevel = 0 | 1 | 2 | 3;
export type PluginSource = 'npm' | 'global' | 'project' | 'explicit';

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly type: PluginType;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly module?: string;
  readonly enabled: boolean;
  readonly requireConfirmation: boolean;
  readonly permissionLevel: ToolPermissionLevel;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeout?: number;
  readonly cpuTimeLimitMs?: number;
  readonly maxMemoryMb?: number;
  readonly sanitizeEnv?: boolean;
}

export interface DiscoveredPluginManifest extends PluginManifest {
  readonly source: PluginSource;
}

export interface PluginSearchPaths {
  readonly globalPluginsDir: string;
  readonly projectPluginsDir: string;
  readonly nodeModulesDir: string;
  readonly explicitConfig: string;
}

export interface PluginConfig {
  readonly name: string;
  readonly projectPath: string;
  readonly xifanConfigDir: string;
  readonly env: Readonly<Record<string, string>>;
  readonly options: Readonly<Record<string, unknown>>;
}

export interface PluginInitResult {
  readonly tools?: readonly string[];
}

export interface PluginToolExecuteResult {
  readonly content?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PluginProcess {
  readonly pid?: number;
  init(config: PluginConfig): Promise<PluginInitResult>;
  executeTool(toolName: string, args: unknown): Promise<PluginToolExecuteResult>;
  destroy(): Promise<void>;
}

export interface PluginProcessFactory {
  create(manifest: DiscoveredPluginManifest): Promise<PluginProcess>;
  get(name: string): PluginProcess | undefined;
}

export interface PluginRegistryEntry {
  readonly manifest: DiscoveredPluginManifest;
  readonly status: PluginStatus;
  readonly pid?: number;
  readonly loadedAt?: number;
  readonly error?: string;
}

export interface PluginDiscoverer {
  discover(searchPaths: PluginSearchPaths): Promise<readonly DiscoveredPluginManifest[]>;
}

export interface IPluginBus {
  bootstrap(searchPaths: PluginSearchPaths): Promise<void>;
  loadPlugin(name: string): Promise<void>;
  unloadPlugin(name: string): Promise<void>;
  executeTool(pluginName: string, toolName: string, args: unknown): Promise<PluginToolExecuteResult>;
  listPlugins(): readonly PluginRegistryEntry[];
}
