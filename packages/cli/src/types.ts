export type ToolLevel = 'L0' | 'L1' | 'L2' | 'L3';

export interface CheckToolCommand {
  readonly type: 'check-tool';
  readonly toolName: string;
  readonly level: ToolLevel;
  readonly mode: 'build' | 'plan';
  readonly headless: boolean;
  readonly allowWrite: boolean;
  readonly allowShell: boolean;
  readonly allowDangerous: boolean;
  readonly allowedTools: readonly string[];
  readonly deniedTools: readonly string[];
  readonly policyMode: 'compat' | 'strict';
  readonly dangerouslySkipPermissions: boolean;
}

export interface ProviderUpdateCommand {
  readonly type: 'provider-update';
  readonly source: string;
  readonly targetPath: string;
}

export interface ResolveLlmDriverCommand {
  readonly type: 'resolve-llm-driver';
  readonly mode: 'auto' | 'builtin' | 'litellm';
  readonly headless: boolean;
  readonly litellmBaseUrl: string;
  readonly confirm: 'ask' | 'yes' | 'no';
}

export interface PluginDiscoverCommand {
  readonly type: 'plugin-discover';
  readonly globalPluginsDir?: string;
  readonly projectPluginsDir?: string;
  readonly nodeModulesDir?: string;
  readonly explicitConfig?: string;
}

export interface PluginBootstrapCommand {
  readonly type: 'plugin-bootstrap';
  readonly globalPluginsDir?: string;
  readonly projectPluginsDir?: string;
  readonly nodeModulesDir?: string;
  readonly explicitConfig?: string;
  readonly enabledL3Plugins: readonly string[];
}

export interface SkillListCommand {
  readonly type: 'skill-list';
  readonly globalSkillsDir?: string;
  readonly projectSkillsDir?: string;
}

export interface SkillUseCommand {
  readonly type: 'skill-use';
  readonly skillName: string;
  readonly globalSkillsDir?: string;
  readonly projectSkillsDir?: string;
  readonly mode: 'build' | 'plan';
  readonly headless: boolean;
  readonly allowWrite: boolean;
  readonly allowShell: boolean;
  readonly allowDangerous: boolean;
  readonly policyMode: 'compat' | 'strict';
  readonly allowedTools: readonly string[];
  readonly deniedTools: readonly string[];
}

export interface TodoCommand {
  readonly type: 'todo';
  readonly action: 'list' | 'add' | 'start' | 'done' | 'block' | 'guard';
  readonly storePath?: string;
  readonly id?: string;
  readonly title?: string;
  readonly reason?: string;
  readonly currentRound?: number;
  readonly maxRounds?: number;
  readonly budgetExceeded?: boolean;
}

export interface ModeCommand {
  readonly type: 'mode';
  readonly action: 'get' | 'set';
  readonly value?: 'build' | 'plan';
  readonly storePath?: string;
}

export interface LspCommand {
  readonly type: 'lsp';
  readonly action: 'diagnostics' | 'workspace-symbols' | 'references' | 'rename-preview';
  readonly language: string;
  readonly filePath?: string;
  readonly content?: string;
  readonly query?: string;
  readonly line?: number;
  readonly character?: number;
  readonly newName?: string;
  readonly rootDir?: string;
}

export interface DaemonCommand {
  readonly type: 'daemon';
  readonly action: 'serve' | 'ping' | 'append' | 'get';
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly sessionId?: string;
  readonly role?: 'user' | 'assistant' | 'system';
  readonly content?: string;
  readonly source?: 'cli' | 'desktop' | 'daemon';
}

export interface McpCommand {
  readonly type: 'mcp';
  readonly action: 'serve';
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly token?: string;
  readonly tokenFilePath?: string;
  readonly maxConnections: number;
  readonly requireTls: boolean;
  readonly tlsKeyPath?: string;
  readonly tlsCertPath?: string;
  readonly autoStartMemory: boolean;
  readonly memoryDbPath?: string;
}

export interface MemoryCommand {
  readonly type: 'memory';
  readonly action: 'serve' | 'search' | 'open';
  readonly dbPath?: string;
  readonly query?: string;
  readonly project?: string;
  readonly limit?: number;
  readonly host?: string;
  readonly port?: number;
}

export interface ContextCommand {
  readonly type: 'context';
  readonly action: 'show' | 'init';
  readonly cwd: string;
  readonly homeDir?: string;
  readonly force?: boolean;
}

export interface SessionCommand {
  readonly type: 'session';
  readonly action: 'create' | 'list' | 'resume';
  readonly id?: string;
  readonly projectPath?: string;
  readonly model?: string;
  readonly provider?: string;
  readonly dbPath?: string;
  readonly limit?: number;
}

export interface CostCommand {
  readonly type: 'cost';
  readonly sessionId?: string;
  readonly today: boolean;
  readonly model?: string;
  readonly dbPath?: string;
}

export interface ToolsCommand {
  readonly type: 'tools';
  readonly crushCommand: string;
}

export interface ConfigCommand {
  readonly type: 'config';
  readonly action: 'init';
  readonly targetPath: string;
  readonly force: boolean;
}

export interface PluginExecuteCommand {
  readonly type: 'plugin-exec';
  readonly pluginName: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly confirm: 'ask' | 'yes' | 'no';
  readonly mode: 'build' | 'plan';
  readonly headless: boolean;
  readonly allowWrite: boolean;
  readonly allowShell: boolean;
  readonly allowDangerous: boolean;
  readonly policyMode: 'compat' | 'strict';
  readonly allowedTools: readonly string[];
  readonly deniedTools: readonly string[];
  readonly globalPluginsDir?: string;
  readonly projectPluginsDir?: string;
  readonly nodeModulesDir?: string;
  readonly explicitConfig?: string;
  readonly enabledL3Plugins: readonly string[];
  readonly dangerouslySkipPermissions: boolean;
}

export interface SetupCommand {
  readonly type: 'setup';
  readonly server: string | undefined;
  readonly apiKey: string | undefined;
  readonly uninstall: boolean;
}

export interface HelpCommand {
  readonly type: 'help';
}

export type CliCommand =
  | CheckToolCommand
  | ProviderUpdateCommand
  | ResolveLlmDriverCommand
  | SkillListCommand
  | SkillUseCommand
  | TodoCommand
  | ModeCommand
  | LspCommand
  | DaemonCommand
  | McpCommand
  | MemoryCommand
  | ContextCommand
  | SessionCommand
  | CostCommand
  | ToolsCommand
  | ConfigCommand
  | PluginDiscoverCommand
  | PluginBootstrapCommand
  | PluginExecuteCommand
  | SetupCommand
  | HelpCommand;
