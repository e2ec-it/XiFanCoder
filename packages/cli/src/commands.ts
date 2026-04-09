import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createInterface } from 'node:readline/promises';
import os from 'node:os';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';

import { resolveCliVersion } from './version.js';

import {
  ChildProcessPluginFactory,
  DefaultPluginDiscoverer,
  PluginBus,
  PluginLoader,
  PluginRegistry,
} from '@xifan-coder/plugin-bus';
import {
  MemoryManager,
  type SearchResult,
  XifanMemoryMcpServer,
} from '@xifan-coder/mem';
import {
  BasicTypeScriptLSPClient,
  createPluginToolDefinition,
  CRUSH_TOOL_DESCRIPTORS,
  detectCrushAvailability as detectCrushAvailabilityRuntime,
  discoverSkills as discoverSkillsRuntime,
  initRuntimeConfigFile,
  loadXifanContext,
  LSPRegistry,
  MCPWebSocketServer,
  readSkill as readSkillRuntime,
  resolveLLMDriverMode,
  SessionManager,
  SessionDaemonClient,
  SessionDaemonServer,
  SessionRuntime,
  TaskStateMachine,
  ToolDispatcher,
  ToolPermissionDeniedError,
  updateCatalogFromSource,
} from '@xifan-coder/core';

import type { CliCommand } from './types.js';
import type {
  DiscoverSkillsOptions,
  LSPDiagnostic,
  LSPReference,
  LSPRenameEdit,
  LSPSymbol,
  MessageRecord,
  ResolvedLLMDriverMode,
  SessionEvent,
  SessionRecord,
  TaskItem,
  TokenUsageAggregate,
  SkillDescriptor,
  SkillDocument,
} from '@xifan-coder/core';
import type {
  DiscoveredPluginManifest,
  PluginRegistryEntry,
  PluginSearchPaths,
  PluginToolExecuteResult,
} from '@xifan-coder/plugin-bus';

export interface BootstrapPluginsInput {
  readonly searchPaths: PluginSearchPaths;
  readonly enabledL3Plugins: readonly string[];
}

export interface ExecutePluginToolInput extends BootstrapPluginsInput {
  readonly pluginName: string;
  readonly toolName: string;
  readonly args: unknown;
}

export interface ExecutePluginToolOutput {
  readonly result: PluginToolExecuteResult;
  readonly pluginEntry?: PluginRegistryEntry;
}

export interface SkillListEntry {
  readonly name: string;
  readonly title: string;
  readonly rootPath: string;
  readonly skillFilePath: string;
}

interface SerializedTaskItem {
  readonly id: string;
  readonly title: string;
  readonly status: TaskItem['status'];
  readonly updatedAt: string;
  readonly lastReason?: string;
}

interface DaemonClientLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<{ status: string }>;
  getSession(sessionId: string): Promise<readonly SessionEvent[]>;
  appendSessionEvent(input: {
    sessionId: string;
    role?: 'user' | 'assistant' | 'system';
    content: string;
    source?: 'cli' | 'desktop' | 'daemon';
  }): Promise<SessionEvent>;
}

interface DaemonServerLike {
  start(): Promise<{
    host: string;
    port: number;
  }>;
  stop(): Promise<void>;
}

interface McpServerLike {
  start(): Promise<{
    host: string;
    port: number;
    path: string;
    tokenFilePath?: string;
    tlsEnabled: boolean;
    tlsCertPath?: string;
    connectedClients: number;
    ideConnected: boolean;
  }>;
  stop(): Promise<void>;
}

interface MemoryMcpServerLike {
  start(): Promise<{
    started: true;
    transport: 'stdio';
    toolCount: number;
  }>;
  stop(): Promise<void>;
}

interface MemoryManagerLike {
  search(
    query: string,
    options?: {
      project?: string;
      limit?: number;
    },
  ): readonly SearchResult[];
  close(): void;
}

interface MemoryViewerLike {
  start(): Promise<{
    started: true;
    host: string;
    port: number;
    url: string;
  }>;
  stop(): Promise<void>;
}

interface PersistedModeState {
  readonly mode: 'build' | 'plan';
  readonly updatedAt: string;
}

interface SessionManagerLike {
  createSession(input: {
    id?: string;
    projectPath: string;
    model: string;
    provider: string;
    agentMode?: 'build' | 'plan';
  }): SessionRecord;
  listSessions(options?: {
    projectPath?: string;
    limit?: number;
  }): readonly SessionRecord[];
  resumeSession(sessionId: string): {
    session: SessionRecord;
    messages: readonly MessageRecord[];
  } | undefined;
  getSessionCost(sessionId: string): TokenUsageAggregate;
  getTodayCost(day?: string): TokenUsageAggregate;
  getModelCost(model: string): TokenUsageAggregate;
  close(): void;
}

export interface ExecuteCommandDeps {
  readonly resolveDriverMode?: (options?: {
    mode?: 'auto' | 'builtin' | 'litellm';
    headless?: boolean;
    litellmBaseUrl?: string;
    confirmUseLiteLLM?: () => Promise<boolean>;
  }) => Promise<ResolvedLLMDriverMode>;
  readonly promptYesNo?: (question: string) => Promise<boolean>;
  readonly stdinIsTTY?: boolean;
  readonly discoverPlugins?: (
    paths: PluginSearchPaths,
  ) => Promise<readonly DiscoveredPluginManifest[]>;
  readonly bootstrapPlugins?: (
    input: BootstrapPluginsInput,
  ) => Promise<readonly PluginRegistryEntry[]>;
  readonly executePluginTool?: (
    input: ExecutePluginToolInput,
  ) => Promise<ExecutePluginToolOutput>;
  readonly discoverSkills?: (
    options: DiscoverSkillsOptions,
  ) => readonly SkillDescriptor[] | Promise<readonly SkillDescriptor[]>;
  readonly readSkill?: (descriptor: SkillDescriptor) => SkillDocument | Promise<SkillDocument>;
  readonly createLspRegistry?: (options?: { rootDir?: string }) => LSPRegistry;
  readonly createDaemonClient?: (options: {
    host: string;
    port: number;
    token: string;
  }) => DaemonClientLike;
  readonly createDaemonServer?: (options: {
    host: string;
    port: number;
    token: string;
  }) => DaemonServerLike;
  readonly detectCrushAvailability?: (command?: string) => {
    available: boolean;
    command: string;
    reason?: string;
  };
  readonly createMcpServer?: (options: {
    host: string;
    port: number;
    path: string;
    token?: string;
    tokenFilePath?: string;
    maxConnections: number;
    requireTls: boolean;
    tlsKeyPath?: string;
    tlsCertPath?: string;
  }) => McpServerLike;
  readonly createMemoryMcpServer?: (options: {
    dbPath?: string;
  }) => MemoryMcpServerLike;
  readonly createMemoryManager?: (options: {
    dbPath?: string;
  }) => MemoryManagerLike;
  readonly createMemoryViewer?: (options: {
    host: string;
    port: number;
    dbPath?: string;
  }) => MemoryViewerLike;
  readonly createSessionManager?: (options: {
    dbPath?: string;
  }) => SessionManagerLike;
}

export type CommandResult =
  | {
      readonly type: 'help';
      readonly text: string;
    }
  | {
      readonly type: 'check-tool';
      readonly toolName: string;
      readonly level: 'L0' | 'L1' | 'L2' | 'L3';
      readonly mode: 'build' | 'plan';
      readonly allowed: boolean;
      readonly requiresApproval: boolean;
      readonly reason: string;
      readonly policySource: string;
    }
  | {
      readonly type: 'resolve-llm-driver';
      readonly selectedDriver: 'builtin' | 'litellm';
      readonly reason: string;
      readonly detected: boolean;
      readonly baseUrl: string;
    }
  | {
      readonly type: 'mode';
      readonly action: 'get' | 'set';
      readonly mode: 'build' | 'plan';
      readonly storePath: string;
      readonly updatedAt?: string;
    }
  | {
      readonly type: 'lsp';
      readonly action: 'diagnostics' | 'workspace-symbols' | 'references' | 'rename-preview';
      readonly language: string;
      readonly available: boolean;
      readonly reason?: string;
      readonly diagnostics?: readonly LSPDiagnostic[];
      readonly symbols?: readonly LSPSymbol[];
      readonly references?: readonly LSPReference[];
      readonly renameEdits?: readonly LSPRenameEdit[];
    }
  | {
      readonly type: 'daemon';
      readonly action: 'serve' | 'ping' | 'append' | 'get';
      readonly connected: boolean;
      readonly reason?: string;
      readonly host?: string;
      readonly port?: number;
      readonly status?: string;
      readonly sessionId?: string;
      readonly event?: SessionEvent;
      readonly events?: readonly SessionEvent[];
    }
  | {
      readonly type: 'mcp';
      readonly action: 'serve';
      readonly started: boolean;
      readonly host: string;
      readonly port: number;
      readonly path: string;
      readonly tokenFilePath?: string;
      readonly tlsEnabled: boolean;
      readonly tlsCertPath?: string;
      readonly connectedClients: number;
      readonly ideConnected: boolean;
      readonly memoryStarted?: boolean;
      readonly memoryToolCount?: number;
    }
  | {
      readonly type: 'memory';
      readonly action: 'serve';
      readonly started: boolean;
      readonly transport: 'stdio';
      readonly toolCount: number;
    }
  | {
      readonly type: 'memory';
      readonly action: 'search';
      readonly query: string;
      readonly project?: string;
      readonly results: readonly SearchResult[];
    }
  | {
      readonly type: 'memory';
      readonly action: 'open';
      readonly started: boolean;
      readonly host: string;
      readonly port: number;
      readonly url: string;
    }
  | {
      readonly type: 'context';
      readonly action: 'show' | 'init';
      readonly cwd: string;
      readonly sourcePaths?: readonly string[];
      readonly content?: string;
      readonly secretLeakCount?: number;
      readonly filePath?: string;
      readonly created?: boolean;
      readonly overwritten?: boolean;
    }
  | {
      readonly type: 'config';
      readonly action: 'init';
      readonly targetPath: string;
      readonly created: boolean;
      readonly overwritten: boolean;
    }
  | {
      readonly type: 'session';
      readonly action: 'create' | 'list' | 'resume';
      readonly dbPath?: string;
      readonly session?: SessionRecord;
      readonly sessions?: readonly SessionRecord[];
      readonly messages?: readonly MessageRecord[];
      readonly found?: boolean;
    }
  | {
      readonly type: 'cost';
      readonly scope: 'session' | 'today' | 'model';
      readonly dbPath?: string;
      readonly sessionId?: string;
      readonly day?: string;
      readonly model?: string;
      readonly aggregate: TokenUsageAggregate;
    }
  | {
      readonly type: 'tools';
      readonly crushAvailable: boolean;
      readonly crushCommand: string;
      readonly crushReason?: string;
      readonly tools: ReadonlyArray<{
        name: string;
        source: 'builtin' | 'crush';
        permissionLevel: 'L0' | 'L1' | 'L2' | 'L3';
        description: string;
      }>;
    }
  | {
      readonly type: 'skill-list';
      readonly skills: readonly SkillListEntry[];
    }
  | {
      readonly type: 'skill-use';
      readonly skillName: string;
      readonly applied: boolean;
      readonly reason?: string;
      readonly policySource?: string;
      readonly title?: string;
      readonly skillFilePath?: string;
      readonly appliedAt?: string;
      readonly content?: string;
    }
  | {
      readonly type: 'todo';
      readonly action: 'list' | 'add' | 'start' | 'done' | 'block' | 'guard';
      readonly tasks: readonly TaskItem[];
      readonly shouldContinue?: boolean;
      readonly guardReason?: string;
      readonly unfinishedTaskIds?: readonly string[];
    }
  | {
      readonly type: 'plugin-discover';
      readonly manifests: readonly DiscoveredPluginManifest[];
    }
  | {
      readonly type: 'plugin-bootstrap';
      readonly entries: readonly PluginRegistryEntry[];
    }
  | {
      readonly type: 'plugin-exec';
      readonly pluginName: string;
      readonly toolName: string;
      readonly executed: boolean;
      readonly status?: string;
      readonly reason?: string;
      readonly policySource?: string;
      readonly result?: PluginToolExecuteResult;
    }
  | {
      readonly type: 'provider-update';
      readonly version: string;
      readonly source: string;
      readonly checksum: string;
    }
  | {
      readonly type: 'setup';
      readonly success: boolean;
    };

/* v8 ignore start -- readline prompt, always injected via deps in tests */
async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
/* v8 ignore stop */

export function helpText(version?: string): string {
  const ver = version ?? resolveCliVersion();
  return [
    `XiFanCoder CLI v${ver}`,
    'AI Agent CLI Coding Tool',
    '',
    'Usage: xifan-coder [command] [options]',
    '',
    'Global Flags:',
    '  --json | --output json      Output structured JSON',
    '  --output text               Output plain text (default)',
    '  --help | -h                 Show this help message',
    '',
    'Interactive:',
    '  xifan-coder                          Start interactive REPL (/help for slash commands)',
    '',
    'Session:',
    '  session list                         List sessions',
    '  session create --model <m> --provider <p>',
    '  session resume --id <id>             Resume a session',
    '  --session resume [--id <id>]         Resume last session (startup alias)',
    '  cost [--session <id> | --today | --model <name>]',
    '',
    'Memory:',
    '  memory search --query <text> [--project <path>] [--limit <n>]',
    '  memory open [--host <addr>] [--port <n>]',
    '  memory serve [--db <path>]',
    '',
    'Configuration:',
    '  init --config [--cwd <dir>] [--force]',
    '  config init [--cwd <dir>] [--target <path>] [--force]',
    '  context [show] [--cwd <dir>] [--home <dir>]',
    '  context init [--cwd <dir>] [--force]',
    '  mode get|set <build|plan>',
    '  resolve-llm-driver [--driver auto|builtin|litellm]',
    '  provider-update [embedded|<file>|<url>]',
    '  setup [--server <host>] [--api-key <key>] [--uninstall]',
    '',
    'Tools & Skills:',
    '  tools [--crush-cmd <command>]',
    '  check-tool --tool <name> --level <L0|L1|L2|L3>',
    '  skill list',
    '  skill use <name> [--mode build|plan]',
    '',
    'Tasks:',
    '  todo list',
    '  todo add --id <id> --title <title>',
    '  todo start|done --id <id>',
    '  todo block --id <id> --reason <text>',
    '  todo guard [--current-round <n>] [--max-rounds <n>]',
    '',
    'Plugins:',
    '  plugin list',
    '  plugin <name> [<args>] [--tool <tool>]',
    '  plugin-discover',
    '  plugin-bootstrap',
    '  plugin-exec --plugin <name> --tool <tool> [--args-json <json>]',
    '',
    'LSP:',
    '  lsp diagnostics --file <path> [--language typescript]',
    '  lsp workspace-symbols --query <text>',
    '  lsp references --file <path> [--line <n>] [--character <n>]',
    '  lsp rename-preview --file <path> --new-name <text>',
    '',
    'MCP Server:',
    '  mcp [serve] [--host <addr>] [--port <n>] [--tls-key <path> --tls-cert <path>]',
    '',
    'Daemon:',
    '  daemon serve --token <token> [--host <addr>] [--port <n>]',
    '  daemon ping --token <token>',
    '  daemon append --token <token> --session <id> --content <text>',
    '  daemon get --token <token> --session <id>',
    '',
    'Run "xifan-coder <command> --help" for detailed options on each command.',
  ].join('\n');
}

function resolvePluginSearchPaths(input: {
  globalPluginsDir?: string;
  projectPluginsDir?: string;
  nodeModulesDir?: string;
  explicitConfig?: string;
}): PluginSearchPaths {
  return {
    globalPluginsDir: input.globalPluginsDir ?? path.join(os.homedir(), '.xifan', 'coder', 'plugins'),
    projectPluginsDir: input.projectPluginsDir ?? path.resolve('.xifan/coder/plugins'),
    nodeModulesDir: input.nodeModulesDir ?? path.resolve('node_modules'),
    explicitConfig: input.explicitConfig ?? path.join(os.homedir(), '.xifan', 'coder', 'plugins.json'),
  };
}

function resolveSkillRoots(input: {
  globalSkillsDir?: string;
  projectSkillsDir?: string;
}): readonly string[] {
  return [
    input.globalSkillsDir ?? path.join(os.homedir(), '.xifan', 'coder', 'skills'),
    input.projectSkillsDir ?? path.resolve('.xifan/coder/skills'),
  ];
}

function resolveTodoStorePath(storePath?: string): string {
  return storePath ?? path.resolve('.xifan/coder/tasks.json');
}

function resolveModeStorePath(storePath?: string): string {
  return storePath ?? path.resolve('.xifan/coder/session-mode.json');
}

function resolvePermissionLogPath(logPath?: string): string {
  return logPath ?? path.resolve('.xifan/coder/permission-events.log');
}

function detectPackageScript(projectDir: string, scriptName: string): string | undefined {
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return undefined;
  }

  try {
    const raw = fs.readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      scripts?: Record<string, string>;
    };
    const script = parsed.scripts?.[scriptName];
    return script && script.trim().length > 0 ? script : undefined;
  } catch {
    return undefined;
  }
}

function renderInitTemplate(projectDir: string): string {
  const projectName = path.basename(path.resolve(projectDir));
  const build = detectPackageScript(projectDir, 'build') ?? 'pnpm build';
  const test = detectPackageScript(projectDir, 'test') ?? 'pnpm test';
  const lint = detectPackageScript(projectDir, 'lint') ?? 'pnpm lint';

  return [
    '# XIFAN.md',
    '',
    `## Project`,
    projectName,
    '',
    '## Build',
    build,
    '',
    '## Test',
    test,
    '',
    '## Lint',
    lint,
    '',
    '## Notes',
    '- Keep changes incremental and test-first.',
    '- Prefer pnpm workspace commands for monorepo operations.',
    '',
  ].join('\n');
}

const BUILTIN_TOOL_CATALOG: ReadonlyArray<{
  name: string;
  source: 'builtin';
  permissionLevel: 'L0' | 'L1' | 'L2' | 'L3';
  description: string;
}> = [
  {
    name: 'read_file',
    source: 'builtin',
    permissionLevel: 'L0',
    description: 'Read file segments',
  },
  {
    name: 'list_dir',
    source: 'builtin',
    permissionLevel: 'L0',
    description: 'List workspace directories',
  },
  {
    name: 'write_file',
    source: 'builtin',
    permissionLevel: 'L1',
    description: 'Write or patch files',
  },
  {
    name: 'bash_execute',
    source: 'builtin',
    permissionLevel: 'L2',
    description: 'Execute shell commands',
  },
  {
    name: 'web_fetch',
    source: 'builtin',
    permissionLevel: 'L3',
    description: 'Fetch web content with summary',
  },
] as const;

function defaultCreateLspRegistry(options?: { rootDir?: string }): LSPRegistry {
  const registry = new LSPRegistry();
  registry.register(
    new BasicTypeScriptLSPClient({
      rootDir: options?.rootDir ?? process.cwd(),
    }),
  );
  return registry;
}

/* v8 ignore start -- default factory functions, always overridden via deps in tests */
function defaultCreateDaemonClient(options: {
  host: string;
  port: number;
  token: string;
}): DaemonClientLike {
  return new SessionDaemonClient(options);
}

function defaultCreateDaemonServer(options: {
  host: string;
  port: number;
  token: string;
}): DaemonServerLike {
  return new SessionDaemonServer(options);
}

function defaultCreateMcpServer(options: {
  host: string;
  port: number;
  path: string;
  token?: string;
  tokenFilePath?: string;
  maxConnections: number;
  requireTls: boolean;
  tlsKeyPath?: string;
  tlsCertPath?: string;
}): McpServerLike {
  return new MCPWebSocketServer({
    host: options.host,
    port: options.port,
    path: options.path,
    token: options.token,
    tokenFilePath: options.tokenFilePath,
    maxConnections: options.maxConnections,
    requireTls: options.requireTls,
    tls:
      options.tlsKeyPath && options.tlsCertPath
        ? {
            keyPath: options.tlsKeyPath,
            certPath: options.tlsCertPath,
          }
        : undefined,
  });
}

function defaultCreateMemoryMcpServer(options: {
  dbPath?: string;
}): MemoryMcpServerLike {
  return new XifanMemoryMcpServer({
    dbPath: options.dbPath,
  });
}

function defaultCreateMemoryManager(options: {
  dbPath?: string;
}): MemoryManagerLike {
  return new MemoryManager({
    dbPath: options.dbPath,
    allowExternalDbPath: options.dbPath !== undefined,
  });
}

function defaultCreateMemoryViewer(options: {
  host: string;
  port: number;
  dbPath?: string;
}): MemoryViewerLike {
  let server: Server | undefined;
  const manager = defaultCreateMemoryManager({
    dbPath: options.dbPath,
  });

  return {
    start: async () => {
      if (server) {
        return {
          started: true,
          host: options.host,
          port: options.port,
          url: `http://${options.host}:${options.port}`,
        };
      }

      const next = createServer((request, response) => {
        const requestUrl = new URL(request.url ?? '/', `http://${options.host}:${options.port}`);
        if (requestUrl.pathname === '/health') {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: true }));
          return;
        }

        if (requestUrl.pathname === '/search') {
          const query = requestUrl.searchParams.get('query') ?? '';
          const project = requestUrl.searchParams.get('project') ?? undefined;
          const rawLimit = requestUrl.searchParams.get('limit');
          const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
          const limit = parsedLimit && parsedLimit > 0 ? parsedLimit : undefined;
          const results = manager.search(query, {
            project,
            limit,
          });
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify(results));
          return;
        }

        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          [
            '<!doctype html>',
            '<html><head><meta charset="utf-8"><title>XiFan Memory Viewer</title></head>',
            '<body><h1>XiFan Memory Viewer</h1><p>Use /search?query=... to query memory.</p></body></html>',
          ].join(''),
        );
      });

      await new Promise<void>((resolve, reject) => {
        next.once('error', reject);
        next.listen(options.port, options.host, () => {
          server = next;
          resolve();
        });
      });

      return {
        started: true,
        host: options.host,
        port: options.port,
        url: `http://${options.host}:${options.port}`,
      };
    },
    stop: async () => {
      manager.close();
      if (!server) {
        return;
      }
      await new Promise<void>((resolve) => {
        server?.close(() => {
          resolve();
        });
      });
      server = undefined;
    },
  };
}
/* v8 ignore stop */

function loadPersistedMode(storePath: string): PersistedModeState {
  if (!fs.existsSync(storePath)) {
    return {
      mode: 'build',
      updatedAt: new Date().toISOString(),
    };
  }

  const raw = fs.readFileSync(storePath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<PersistedModeState>;
  if (parsed.mode !== 'build' && parsed.mode !== 'plan') {
    throw new Error(`Invalid mode store format: ${storePath}`);
  }
  return {
    mode: parsed.mode,
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
  };
}

function savePersistedMode(storePath: string, mode: 'build' | 'plan'): PersistedModeState {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });
  const next: PersistedModeState = {
    mode,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(storePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

function deserializeTasks(serialized: readonly SerializedTaskItem[]): TaskStateMachine {
  const machine = new TaskStateMachine();

  for (const item of serialized) {
    machine.upsertPending(item.id, item.title);
    if (item.status === 'in_progress') {
      machine.markInProgress(item.id);
      continue;
    }
    if (item.status === 'done') {
      machine.markDone(item.id);
      continue;
    }
    if (item.status === 'blocked') {
      machine.markBlocked(item.id, item.lastReason ?? 'blocked');
    }
  }

  return machine;
}

function loadTaskMachine(storePath: string): TaskStateMachine {
  if (!fs.existsSync(storePath)) {
    return new TaskStateMachine();
  }

  const raw = fs.readFileSync(storePath, 'utf8');
  const parsed = JSON.parse(raw) as readonly SerializedTaskItem[];
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid todo store format: ${storePath}`);
  }

  return deserializeTasks(parsed);
}

function saveTaskMachine(storePath: string, machine: TaskStateMachine): void {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });
  const serialized: SerializedTaskItem[] = machine.list().map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    updatedAt: task.updatedAt.toISOString(),
    lastReason: task.lastReason,
  }));
  fs.writeFileSync(storePath, JSON.stringify(serialized, null, 2) + '\n', 'utf8');
}

function toToolPermissionLevel(level: 0 | 1 | 2 | 3): 'L0' | 'L1' | 'L2' | 'L3' {
  switch (level) {
    case 0:
      return 'L0';
    case 1:
      return 'L1';
    case 2:
      return 'L2';
    case 3:
      return 'L3';
  }
}

export async function executeCommandDetailed(
  command: CliCommand,
  deps: ExecuteCommandDeps = {},
): Promise<CommandResult> {
  const resolveDriverMode = deps.resolveDriverMode ?? resolveLLMDriverMode;
  const yesNoPrompt = deps.promptYesNo ?? promptYesNo;
  const stdinIsTTY = deps.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  const discoverPlugins =
    deps.discoverPlugins ??
    (async (paths: PluginSearchPaths): Promise<readonly DiscoveredPluginManifest[]> =>
      new DefaultPluginDiscoverer().discover(paths));
  const bootstrapPlugins =
    deps.bootstrapPlugins ??
    /* v8 ignore start -- default factory, always overridden via deps in tests */
    (async (input: BootstrapPluginsInput): Promise<readonly PluginRegistryEntry[]> => {
      const registry = new PluginRegistry();
      const loader = new PluginLoader(registry, new ChildProcessPluginFactory());
      const bus = new PluginBus({
        registry,
        loader,
        enabledL3Plugins: input.enabledL3Plugins,
      });
      await bus.bootstrap(input.searchPaths);
      return bus.listPlugins();
    });
  /* v8 ignore stop */
  const executePluginTool =
    deps.executePluginTool ??
    (async (input: ExecutePluginToolInput): Promise<ExecutePluginToolOutput> => {
      const registry = new PluginRegistry();
      const loader = new PluginLoader(registry, new ChildProcessPluginFactory());
      const bus = new PluginBus({
        registry,
        loader,
        enabledL3Plugins: input.enabledL3Plugins,
      });
      await bus.bootstrap(input.searchPaths);
      const result = await bus.executeTool(input.pluginName, input.toolName, input.args);
      const pluginEntry = bus.listPlugins().find((entry) => entry.manifest.name === input.pluginName);
      return {
        result,
        pluginEntry,
      };
    });
  const discoverSkills =
    deps.discoverSkills ??
    ((options: DiscoverSkillsOptions): readonly SkillDescriptor[] =>
      discoverSkillsRuntime(options));
  const readSkill = deps.readSkill ?? ((descriptor: SkillDescriptor): SkillDocument => readSkillRuntime(descriptor));
  const createLspRegistry = deps.createLspRegistry ?? defaultCreateLspRegistry;
  const createDaemonClient = deps.createDaemonClient ?? defaultCreateDaemonClient;
  const createDaemonServer = deps.createDaemonServer ?? defaultCreateDaemonServer;
  const detectCrushAvailability = deps.detectCrushAvailability ?? detectCrushAvailabilityRuntime;
  const createMcpServer = deps.createMcpServer ?? defaultCreateMcpServer;
  const createMemoryMcpServer = deps.createMemoryMcpServer ?? defaultCreateMemoryMcpServer;
  const createMemoryManager = deps.createMemoryManager ?? defaultCreateMemoryManager;
  const createMemoryViewer = deps.createMemoryViewer ?? defaultCreateMemoryViewer;
  const createSessionManager =
    deps.createSessionManager ??
    /* v8 ignore next 4 -- default factory, always overridden via deps in tests */
    ((options: { dbPath?: string }): SessionManagerLike =>
      new SessionManager({
        dbPath: options.dbPath,
      }));

  if (command.type === 'help') {
    return {
      type: 'help',
      text: helpText(),
    };
  }

  if (command.type === 'tools') {
    const crush = detectCrushAvailability(command.crushCommand);
    const tools: Array<{
      name: string;
      source: 'builtin' | 'crush';
      permissionLevel: 'L0' | 'L1' | 'L2' | 'L3';
      description: string;
    }> = [...BUILTIN_TOOL_CATALOG];

    if (crush.available) {
      tools.push(
        ...CRUSH_TOOL_DESCRIPTORS.map((tool) => ({
          name: tool.name,
          source: 'crush' as const,
          permissionLevel: tool.permissionLevel,
          description: tool.description,
        })),
      );
    }

    return {
      type: 'tools',
      crushAvailable: crush.available,
      crushCommand: crush.command,
      crushReason: crush.reason,
      tools,
    };
  }

  if (command.type === 'check-tool') {
    const runtime = new SessionRuntime({
      mode: command.mode,
      headless: command.headless,
      allowWrite: command.allowWrite,
      allowShell: command.allowShell,
      allowDangerous: command.allowDangerous,
      allowedTools: command.allowedTools,
      deniedTools: command.deniedTools,
      policyMode: command.policyMode,
      dangerouslySkipPermissions: command.dangerouslySkipPermissions,
      permissionLogPath: resolvePermissionLogPath(),
    });

    const decision = runtime.checkToolPermission({
      toolName: command.toolName,
      permissionLevel: command.level,
    });

    return {
      type: 'check-tool',
      toolName: command.toolName,
      level: command.level,
      mode: command.mode,
      allowed: decision.allowed,
      requiresApproval: decision.requiresApproval,
      reason: decision.reason,
      policySource: decision.policySource,
    };
  }

  if (command.type === 'resolve-llm-driver') {
    const confirmUseLiteLLM =
      command.confirm === 'yes'
        ? async (): Promise<boolean> => true
        : command.confirm === 'no'
          ? async (): Promise<boolean> => false
          : stdinIsTTY
            ? async (): Promise<boolean> =>
                yesNoPrompt('检测到 LiteLLM Proxy，是否切换为 LiteLLM 驱动？')
            : undefined;

    const resolved = await resolveDriverMode({
      mode: command.mode,
      headless: command.headless,
      litellmBaseUrl: command.litellmBaseUrl,
      confirmUseLiteLLM,
    });

    return {
      type: 'resolve-llm-driver',
      selectedDriver: resolved.selectedDriver,
      reason: resolved.reason,
      detected: resolved.litellmDetected,
      baseUrl: resolved.litellmBaseUrl,
    };
  }

  if (command.type === 'mode') {
    const storePath = resolveModeStorePath(command.storePath);
    if (command.action === 'get') {
      const state = loadPersistedMode(storePath);
      return {
        type: 'mode',
        action: 'get',
        mode: state.mode,
        storePath,
        updatedAt: state.updatedAt,
      };
    }

    const state = savePersistedMode(storePath, command.value ?? 'build');
    return {
      type: 'mode',
      action: 'set',
      mode: state.mode,
      storePath,
      updatedAt: state.updatedAt,
    };
  }

  if (command.type === 'lsp') {
    const registry = createLspRegistry({ rootDir: command.rootDir });

    if (command.action === 'diagnostics') {
      const filePath = command.filePath ?? '';
      const content = command.content ?? fs.readFileSync(filePath, 'utf8');
      const result = await registry.diagnostics(command.language, filePath, content);
      return result.available
        ? {
            type: 'lsp',
            action: 'diagnostics',
            language: command.language,
            available: true,
            diagnostics: result.data,
          }
        : {
            type: 'lsp',
            action: 'diagnostics',
            language: command.language,
            available: false,
            reason: result.reason,
          };
    }

    if (command.action === 'workspace-symbols') {
      const result = await registry.workspaceSymbols(command.language, command.query ?? '');
      return result.available
        ? {
            type: 'lsp',
            action: 'workspace-symbols',
            language: command.language,
            available: true,
            symbols: result.data,
          }
        : {
            type: 'lsp',
            action: 'workspace-symbols',
            language: command.language,
            available: false,
            reason: result.reason,
          };
    }

    if (command.action === 'references') {
      const result = await registry.references(
        command.language,
        command.filePath ?? '',
        {
          line: command.line ?? 1,
          character: command.character ?? 1,
        },
      );
      return result.available
        ? {
            type: 'lsp',
            action: 'references',
            language: command.language,
            available: true,
            references: result.data,
          }
        : {
            type: 'lsp',
            action: 'references',
            language: command.language,
            available: false,
            reason: result.reason,
          };
    }

    const result = await registry.renamePreview(
      command.language,
      command.filePath ?? '',
      {
        line: command.line ?? 1,
        character: command.character ?? 1,
      },
      command.newName ?? '',
    );
    return result.available
      ? {
          type: 'lsp',
          action: 'rename-preview',
          language: command.language,
          available: true,
          renameEdits: result.data,
        }
      : {
          type: 'lsp',
          action: 'rename-preview',
          language: command.language,
          available: false,
          reason: result.reason,
        };
  }

  if (command.type === 'daemon') {
    if (command.action === 'serve') {
      const server = createDaemonServer({
        host: command.host,
        port: command.port,
        token: command.token,
      });
      try {
        const status = await server.start();
        /* v8 ignore start -- process signal handlers, untestable in unit */
        const stop = async (): Promise<void> => {
          await server.stop().catch(() => undefined);
        };
        process.once('SIGINT', () => {
          void stop();
        });
        process.once('SIGTERM', () => {
          void stop();
        });
        /* v8 ignore stop */

        return {
          type: 'daemon',
          action: 'serve',
          connected: true,
          host: status.host,
          port: status.port,
        };
      } catch (error) {
        return {
          type: 'daemon',
          action: 'serve',
          connected: false,
          reason: error instanceof Error ? error.message : String(error),
          host: command.host,
          port: command.port,
        };
      }
    }

    const client = createDaemonClient({
      host: command.host,
      port: command.port,
      token: command.token,
    });

    try {
      await client.connect();
    } catch (error) {
      return {
        type: 'daemon',
        action: command.action,
        connected: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      if (command.action === 'ping') {
        const pong = await client.ping();
        return {
          type: 'daemon',
          action: 'ping',
          connected: true,
          status: pong.status,
        };
      }

      if (command.action === 'append') {
        const event = await client.appendSessionEvent({
          sessionId: command.sessionId ?? '',
          role: command.role,
          content: command.content ?? '',
          source: command.source,
        });
        return {
          type: 'daemon',
          action: 'append',
          connected: true,
          sessionId: command.sessionId,
          event,
        };
      }

      const events = await client.getSession(command.sessionId ?? '');
      return {
        type: 'daemon',
        action: 'get',
        connected: true,
        sessionId: command.sessionId,
        events,
      };
    } catch (error) {
      return {
        type: 'daemon',
        action: command.action,
        connected: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await client.disconnect().catch(() => undefined);
    }
  }

  if (command.type === 'mcp') {
    let memoryServer: MemoryMcpServerLike | undefined;
    let memoryStatus:
      | {
          started: true;
          transport: 'stdio';
          toolCount: number;
        }
      | undefined;

    if (command.autoStartMemory) {
      memoryServer = createMemoryMcpServer({
        dbPath: command.memoryDbPath,
      });
      memoryStatus = await memoryServer.start();
    }

    const server = createMcpServer({
      host: command.host,
      port: command.port,
      path: command.path,
      token: command.token,
      tokenFilePath: command.tokenFilePath,
      maxConnections: command.maxConnections,
      requireTls: command.requireTls,
      tlsKeyPath: command.tlsKeyPath,
      tlsCertPath: command.tlsCertPath,
    });

    let status: {
      host: string;
      port: number;
      path: string;
      tokenFilePath?: string;
      tlsEnabled: boolean;
      tlsCertPath?: string;
      connectedClients: number;
      ideConnected: boolean;
    };
    try {
      status = await server.start();
    } catch (error) {
      if (memoryServer) {
        await memoryServer.stop().catch(() => undefined);
      }
      throw error;
    }

    /* v8 ignore start -- process signal handlers, untestable in unit */
    const stop = async (): Promise<void> => {
      await server.stop().catch(() => undefined);
      if (memoryServer) {
        await memoryServer.stop().catch(() => undefined);
      }
    };
    process.once('SIGINT', () => {
      void stop();
    });
    process.once('SIGTERM', () => {
      void stop();
    });
    /* v8 ignore stop */

    return {
      type: 'mcp',
      action: 'serve',
      started: true,
      host: status.host,
      port: status.port,
      path: status.path,
      tokenFilePath: status.tokenFilePath,
      tlsEnabled: status.tlsEnabled,
      tlsCertPath: status.tlsCertPath,
      connectedClients: status.connectedClients,
      ideConnected: status.ideConnected,
      memoryStarted: memoryStatus?.started,
      memoryToolCount: memoryStatus?.toolCount,
    };
  }

  if (command.type === 'memory') {
    if (command.action === 'search') {
      const manager = createMemoryManager({
        dbPath: command.dbPath,
      });
      try {
        const results = manager.search(command.query ?? '', {
          project: command.project,
          limit: command.limit,
        });
        return {
          type: 'memory',
          action: 'search',
          query: command.query ?? '',
          project: command.project,
          results,
        };
      } finally {
        manager.close();
      }
    }

    if (command.action === 'open') {
      const viewer = createMemoryViewer({
        host: command.host ?? '127.0.0.1',
        port: command.port ?? 37777,
        dbPath: command.dbPath,
      });
      const status = await viewer.start();
      /* v8 ignore start -- process signal handlers, untestable in unit */
      process.once('SIGINT', () => {
        void viewer.stop();
      });
      process.once('SIGTERM', () => {
        void viewer.stop();
      });
      /* v8 ignore stop */

      return {
        type: 'memory',
        action: 'open',
        started: status.started,
        host: status.host,
        port: status.port,
        url: status.url,
      };
    }

    const server = createMemoryMcpServer({
      dbPath: command.dbPath,
    });
    const status = await server.start();
    /* v8 ignore start -- process signal handlers, untestable in unit */
    const stop = async (): Promise<void> => {
      await server.stop().catch(() => undefined);
    };
    process.once('SIGINT', () => {
      void stop();
    });
    process.once('SIGTERM', () => {
      void stop();
    });
    /* v8 ignore stop */

    return {
      type: 'memory',
      action: 'serve',
      started: status.started,
      transport: status.transport,
      toolCount: status.toolCount,
    };
  }

  if (command.type === 'context') {
    if (command.action === 'show') {
      const loaded = loadXifanContext({
        cwd: command.cwd,
        homeDir: command.homeDir,
      });

      return {
        type: 'context',
        action: 'show',
        cwd: command.cwd,
        sourcePaths: loaded.sources,
        content: loaded.content,
        secretLeakCount: loaded.secretFindings.length,
      };
    }

    const targetPath = path.join(path.resolve(command.cwd), '.xifan', 'XIFAN.md');
    const existed = fs.existsSync(targetPath);
    if (existed && !command.force) {
      return {
        type: 'context',
        action: 'init',
        cwd: command.cwd,
        filePath: targetPath,
        created: false,
        overwritten: false,
      };
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, renderInitTemplate(command.cwd), 'utf8');

    return {
      type: 'context',
      action: 'init',
      cwd: command.cwd,
      filePath: targetPath,
      created: !existed,
      overwritten: existed,
    };
  }

  if (command.type === 'config') {
    const initialized = initRuntimeConfigFile({
      targetPath: command.targetPath,
      force: command.force,
    });
    return {
      type: 'config',
      action: 'init',
      targetPath: initialized.targetPath,
      created: initialized.created,
      overwritten: initialized.overwritten,
    };
  }

  if (command.type === 'session') {
    const manager = createSessionManager({
      dbPath: command.dbPath,
    });
    try {
      if (command.action === 'list') {
        return {
          type: 'session',
          action: 'list',
          dbPath: command.dbPath,
          sessions: manager.listSessions({
            projectPath: command.projectPath,
            limit: command.limit,
          }),
        };
      }

      if (command.action === 'create') {
        if (!command.model || !command.provider) {
          throw new Error('session create requires --model and --provider');
        }
        const session = manager.createSession({
          projectPath: command.projectPath ?? process.cwd(),
          model: command.model,
          provider: command.provider,
        });
        return {
          type: 'session',
          action: 'create',
          dbPath: command.dbPath,
          session,
        };
      }

      const resumeId = command.id ?? manager.listSessions({ limit: 1 })[0]?.id;
      if (!resumeId) {
        return {
          type: 'session',
          action: 'resume',
          dbPath: command.dbPath,
          found: false,
        };
      }

      const resumed = manager.resumeSession(resumeId);
      if (!resumed) {
        return {
          type: 'session',
          action: 'resume',
          dbPath: command.dbPath,
          found: false,
        };
      }

      return {
        type: 'session',
        action: 'resume',
        dbPath: command.dbPath,
        found: true,
        session: resumed.session,
        messages: resumed.messages,
      };
    } finally {
      manager.close();
    }
  }

  if (command.type === 'cost') {
    const manager = createSessionManager({
      dbPath: command.dbPath,
    });
    const emptyAggregate: TokenUsageAggregate = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      toolCallCount: 0,
    };
    try {
      if (command.sessionId) {
        return {
          type: 'cost',
          scope: 'session',
          dbPath: command.dbPath,
          sessionId: command.sessionId,
          aggregate: manager.getSessionCost(command.sessionId),
        };
      }

      if (command.today) {
        const day = new Date().toISOString().slice(0, 10);
        return {
          type: 'cost',
          scope: 'today',
          dbPath: command.dbPath,
          day,
          aggregate: manager.getTodayCost(day),
        };
      }

      if (command.model) {
        return {
          type: 'cost',
          scope: 'model',
          dbPath: command.dbPath,
          model: command.model,
          aggregate: manager.getModelCost(command.model),
        };
      }

      const latestSession = manager.listSessions({ limit: 1 })[0];
      if (!latestSession) {
        return {
          type: 'cost',
          scope: 'session',
          dbPath: command.dbPath,
          aggregate: emptyAggregate,
        };
      }

      return {
        type: 'cost',
        scope: 'session',
        dbPath: command.dbPath,
        sessionId: latestSession.id,
        aggregate: manager.getSessionCost(latestSession.id),
      };
    } finally {
      manager.close();
    }
  }

  if (command.type === 'skill-list') {
    const roots = resolveSkillRoots(command);
    const descriptors = await discoverSkills({ roots });
    const skills: SkillListEntry[] = [];

    for (const descriptor of descriptors) {
      try {
        const doc = await readSkill(descriptor);
        skills.push({
          name: descriptor.name,
          title: doc.title,
          rootPath: descriptor.rootPath,
          skillFilePath: descriptor.skillFilePath,
        });
      } catch {
        skills.push({
          name: descriptor.name,
          title: descriptor.name,
          rootPath: descriptor.rootPath,
          skillFilePath: descriptor.skillFilePath,
        });
      }
    }

    return {
      type: 'skill-list',
      skills,
    };
  }

  if (command.type === 'skill-use') {
    const roots = resolveSkillRoots(command);
    const descriptors = await discoverSkills({ roots });
    const descriptor = descriptors.find((skill) => skill.name === command.skillName);
    if (!descriptor) {
      return {
        type: 'skill-use',
        skillName: command.skillName,
        applied: false,
        reason: 'skill_not_found',
        policySource: 'skills',
      };
    }

    const runtime = new SessionRuntime({
      mode: command.mode,
      headless: command.headless,
      allowWrite: command.allowWrite,
      allowShell: command.allowShell,
      allowDangerous: command.allowDangerous,
      allowedTools: command.allowedTools,
      deniedTools: command.deniedTools,
      policyMode: command.policyMode,
      permissionLogPath: resolvePermissionLogPath(),
    });
    const decision = runtime.checkToolPermission({
      toolName: `skill_use:${command.skillName}`,
      permissionLevel: 'L0',
    });
    if (!decision.allowed) {
      return {
        type: 'skill-use',
        skillName: command.skillName,
        applied: false,
        reason: decision.reason,
        policySource: decision.policySource,
      };
    }

    try {
      const doc = await readSkill(descriptor);
      return {
        type: 'skill-use',
        skillName: command.skillName,
        applied: true,
        title: doc.title,
        skillFilePath: descriptor.skillFilePath,
        appliedAt: new Date().toISOString(),
        content: doc.content,
      };
    } catch {
      return {
        type: 'skill-use',
        skillName: command.skillName,
        applied: false,
        reason: 'skill_read_failed',
        policySource: 'skills',
      };
    }
  }

  if (command.type === 'todo') {
    const storePath = resolveTodoStorePath(command.storePath);
    const machine = loadTaskMachine(storePath);

    if (command.action === 'list') {
      return {
        type: 'todo',
        action: 'list',
        tasks: machine.list(),
      };
    }

    if (command.action === 'add') {
      if (!command.id || !command.title) {
        throw new Error('todo add requires id and title');
      }
      machine.upsertPending(command.id, command.title);
      saveTaskMachine(storePath, machine);
      return {
        type: 'todo',
        action: 'add',
        tasks: machine.list(),
      };
    }

    if (command.action === 'start') {
      if (!command.id) {
        throw new Error('todo start requires id');
      }
      machine.markInProgress(command.id);
      saveTaskMachine(storePath, machine);
      return {
        type: 'todo',
        action: 'start',
        tasks: machine.list(),
      };
    }

    if (command.action === 'done') {
      if (!command.id) {
        throw new Error('todo done requires id');
      }
      machine.markDone(command.id);
      saveTaskMachine(storePath, machine);
      return {
        type: 'todo',
        action: 'done',
        tasks: machine.list(),
      };
    }

    if (command.action === 'block') {
      if (!command.id || !command.reason) {
        throw new Error('todo block requires id and reason');
      }
      machine.markBlocked(command.id, command.reason);
      saveTaskMachine(storePath, machine);
      return {
        type: 'todo',
        action: 'block',
        tasks: machine.list(),
      };
    }

    const guard = machine.evaluateContinuation({
      currentRound: command.currentRound ?? 1,
      maxRounds: command.maxRounds ?? 50,
      budgetExceeded: command.budgetExceeded,
    });
    return {
      type: 'todo',
      action: 'guard',
      tasks: machine.list(),
      shouldContinue: guard.shouldContinue,
      guardReason: guard.reason,
      unfinishedTaskIds: guard.unfinishedTaskIds,
    };
  }

  if (command.type === 'plugin-discover') {
    const searchPaths = resolvePluginSearchPaths(command);

    const manifests = await discoverPlugins(searchPaths);
    return {
      type: 'plugin-discover',
      manifests,
    };
  }

  if (command.type === 'plugin-bootstrap') {
    const searchPaths = resolvePluginSearchPaths(command);
    const entries = await bootstrapPlugins({
      searchPaths,
      enabledL3Plugins: command.enabledL3Plugins,
    });
    return {
      type: 'plugin-bootstrap',
      entries,
    };
  }

  if (command.type === 'plugin-exec') {
    const searchPaths = resolvePluginSearchPaths(command);
    const manifests = await discoverPlugins(searchPaths);
    const manifest = manifests.find((item) => item.name === command.pluginName);
    if (!manifest) {
      throw new Error(`plugin not found: ${command.pluginName}`);
    }

    const runtime = new SessionRuntime({
      mode: command.mode,
      headless: command.headless,
      allowWrite: command.allowWrite,
      allowShell: command.allowShell,
      allowDangerous: command.allowDangerous,
      allowedTools: command.allowedTools,
      deniedTools: command.deniedTools,
      policyMode: command.policyMode,
      dangerouslySkipPermissions: command.dangerouslySkipPermissions,
      permissionLogPath: resolvePermissionLogPath(),
    });
    const toolPermissionName = `${command.pluginName}:${command.toolName}`;
    const toolPermissionLevel = toToolPermissionLevel(manifest.permissionLevel);
    const decision = runtime.checkToolPermission({
      toolName: toolPermissionName,
      permissionLevel: toolPermissionLevel,
    });
    if (!decision.allowed) {
      return {
        type: 'plugin-exec',
        pluginName: command.pluginName,
        toolName: command.toolName,
        executed: false,
        reason: decision.reason,
        policySource: decision.policySource,
      };
    }

    let approved = !decision.requiresApproval;
    if (!approved) {
      if (command.confirm === 'yes') {
        approved = true;
      } else if (command.confirm === 'no') {
        approved = false;
      } else {
        approved = stdinIsTTY
          ? await yesNoPrompt(`工具 ${toolPermissionName} 需要确认后才能执行，是否继续？`)
          : false;
      }

      if (!approved) {
        return {
          type: 'plugin-exec',
          pluginName: command.pluginName,
          toolName: command.toolName,
          executed: false,
          reason: 'approval_required',
          policySource: decision.policySource,
        };
      }
    }

    const dispatcher = new ToolDispatcher(runtime, {
      approvalHandler: async () => approved,
    });
    const pluginTool = createPluginToolDefinition(
      {
        pluginName: command.pluginName,
        toolName: command.toolName,
        permissionLevel: toolPermissionLevel,
        timeoutMs: manifest.timeout,
      },
      {
        execute: async (pluginName, toolName, args) => {
          return await executePluginTool({
            searchPaths,
            enabledL3Plugins: command.enabledL3Plugins,
            pluginName,
            toolName,
            args,
          });
        },
      },
    );
    dispatcher.registerTool(pluginTool);

    let executed: ExecutePluginToolOutput;
    try {
      const execution = await dispatcher.executeTool(pluginTool.name, command.args);
      executed = execution.output as ExecutePluginToolOutput;
    } catch (error) {
      /* v8 ignore start -- ToolPermissionDeniedError thrown by dispatcher internal re-evaluation */
      if (error instanceof ToolPermissionDeniedError) {
        return {
          type: 'plugin-exec',
          pluginName: command.pluginName,
          toolName: command.toolName,
          executed: false,
          reason: decision.requiresApproval ? 'approval_required' : decision.reason,
          policySource: decision.policySource,
        };
      }
      throw error;
    }
    /* v8 ignore stop */

    return {
      type: 'plugin-exec',
      pluginName: command.pluginName,
      toolName: command.toolName,
      executed: true,
      status: executed.pluginEntry?.status ?? 'unknown',
      result: executed.result,
    };
  }

  /* v8 ignore start -- setup command uses spawnSync + import.meta.url, tested via E2E */
  if (command.type === 'setup') {
    const { spawnSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');

    const cliDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(cliDir, '..', '..', '..', '02_scripts', 'setup-client.sh'),
      path.resolve(cliDir, '..', '..', '02_scripts', 'setup-client.sh'),
    ];
    const scriptPath = candidates.find((p) => fs.existsSync(p));

    if (!scriptPath) {
      throw new Error(
        'setup-client.sh not found. Run from a cloned XiFanCoder repository, ' +
        'or use: bash 02_scripts/setup-client.sh'
      );
    }

    const args: string[] = [];
    if (command.server) args.push('--server', command.server);
    if (command.apiKey) args.push('--api-key', command.apiKey);
    if (command.uninstall) args.push('--uninstall');

    try {
      spawnSync('bash', [scriptPath, ...args], { stdio: 'inherit' });
    } catch {
      return { type: 'setup', success: false };
    }
    return { type: 'setup', success: true };
  }
  /* v8 ignore stop */

  const meta = await updateCatalogFromSource({
    source: command.source,
    targetPath: command.targetPath,
  });

  return {
    type: 'provider-update',
    version: meta.version,
    source: meta.source,
    checksum: meta.checksum,
  };
}

export function formatCommandResultText(result: CommandResult): string {
  if (result.type === 'help') {
    return result.text;
  }

  if (result.type === 'check-tool') {
    return [
      `tool=${result.toolName}`,
      `level=${result.level}`,
      `mode=${result.mode}`,
      `allowed=${result.allowed}`,
      `requiresApproval=${result.requiresApproval}`,
      `reason=${result.reason}`,
      `policySource=${result.policySource}`,
    ].join(' ');
  }

  if (result.type === 'resolve-llm-driver') {
    return [
      `selected=${result.selectedDriver}`,
      `reason=${result.reason}`,
      `detected=${result.detected}`,
      `baseUrl=${result.baseUrl}`,
    ].join(' ');
  }

  if (result.type === 'mode') {
    return [
      `action=${result.action}`,
      `mode=${result.mode}`,
      `store=${result.storePath}`,
      `updatedAt=${result.updatedAt ?? 'unknown'}`,
    ].join(' ');
  }

  if (result.type === 'lsp') {
    if (!result.available) {
      return [
        `action=${result.action}`,
        `language=${result.language}`,
        'available=false',
        `reason=${result.reason ?? 'unavailable'}`,
      ].join(' ');
    }

    if (result.action === 'diagnostics') {
      return [
        `action=${result.action}`,
        `language=${result.language}`,
        'available=true',
        `count=${result.diagnostics?.length ?? 0}`,
        `data=${JSON.stringify(result.diagnostics ?? [])}`,
      ].join(' ');
    }

    if (result.action === 'workspace-symbols') {
      return [
        `action=${result.action}`,
        `language=${result.language}`,
        'available=true',
        `count=${result.symbols?.length ?? 0}`,
        `data=${JSON.stringify(result.symbols ?? [])}`,
      ].join(' ');
    }

    if (result.action === 'references') {
      return [
        `action=${result.action}`,
        `language=${result.language}`,
        'available=true',
        `count=${result.references?.length ?? 0}`,
        `data=${JSON.stringify(result.references ?? [])}`,
      ].join(' ');
    }

    return [
      `action=${result.action}`,
      `language=${result.language}`,
      'available=true',
      `count=${result.renameEdits?.length ?? 0}`,
      `data=${JSON.stringify(result.renameEdits ?? [])}`,
    ].join(' ');
  }

  if (result.type === 'daemon') {
    if (!result.connected) {
      return [
        `action=${result.action}`,
        'connected=false',
        `host=${result.host ?? 'unknown'}`,
        `port=${result.port ?? 'unknown'}`,
        `reason=${result.reason ?? 'unknown'}`,
      ].join(' ');
    }

    if (result.action === 'serve') {
      return [
        'action=serve',
        'connected=true',
        `host=${result.host ?? 'unknown'}`,
        `port=${result.port ?? 'unknown'}`,
      ].join(' ');
    }

    if (result.action === 'ping') {
      return [
        'action=ping',
        'connected=true',
        `status=${result.status ?? 'unknown'}`,
      ].join(' ');
    }

    if (result.action === 'append') {
      return [
        'action=append',
        'connected=true',
        `session=${result.sessionId ?? 'unknown'}`,
        `event=${JSON.stringify(result.event ?? {})}`,
      ].join(' ');
    }

    return [
      'action=get',
      'connected=true',
      `session=${result.sessionId ?? 'unknown'}`,
      `count=${result.events?.length ?? 0}`,
      `events=${JSON.stringify(result.events ?? [])}`,
    ].join(' ');
  }

  if (result.type === 'mcp') {
    return [
      `action=${result.action}`,
      `started=${result.started}`,
      `host=${result.host}`,
      `port=${result.port}`,
      `path=${result.path}`,
      `tokenFile=${result.tokenFilePath ?? 'none'}`,
      `tls=${result.tlsEnabled}`,
      `tlsCert=${result.tlsCertPath ?? 'none'}`,
      `clients=${result.connectedClients}`,
      `ideConnected=${result.ideConnected}`,
      `memoryStarted=${result.memoryStarted ?? false}`,
      `memoryTools=${result.memoryToolCount ?? 0}`,
    ].join(' ');
  }

  if (result.type === 'memory') {
    if (result.action === 'search') {
      return [
        'action=search',
        `query=${JSON.stringify(result.query)}`,
        `project=${result.project ?? 'n/a'}`,
        `count=${result.results.length}`,
        `results=${JSON.stringify(result.results)}`,
      ].join(' ');
    }

    if (result.action === 'open') {
      return [
        'action=open',
        `started=${result.started}`,
        `host=${result.host}`,
        `port=${result.port}`,
        `url=${result.url}`,
      ].join(' ');
    }

    return [
      `action=${result.action}`,
      `started=${result.started}`,
      `transport=${result.transport}`,
      `tools=${result.toolCount}`,
    ].join(' ');
  }

  if (result.type === 'context') {
    if (result.action === 'show') {
      return [
        'action=show',
        `cwd=${result.cwd}`,
        `sources=${result.sourcePaths?.length ?? 0}`,
        `secretLeaks=${result.secretLeakCount ?? 0}`,
        `sourcePaths=${JSON.stringify(result.sourcePaths ?? [])}`,
        `content=${JSON.stringify(result.content ?? '')}`,
      ].join(' ');
    }

    return [
      'action=init',
      `cwd=${result.cwd}`,
      `file=${result.filePath ?? 'unknown'}`,
      `created=${result.created ?? false}`,
      `overwritten=${result.overwritten ?? false}`,
    ].join(' ');
  }

  if (result.type === 'config') {
    return [
      'action=init',
      `target=${result.targetPath}`,
      `created=${result.created}`,
      `overwritten=${result.overwritten}`,
    ].join(' ');
  }

  if (result.type === 'session') {
    if (result.action === 'list') {
      const sessions = result.sessions ?? [];
      if (sessions.length === 0) {
        return [
          'action=list',
          'sessions=0',
          `db=${result.dbPath ?? 'default'}`,
        ].join(' ');
      }
      return [
        'action=list',
        `sessions=${sessions.length}`,
        `db=${result.dbPath ?? 'default'}`,
        ...sessions.map(
          (session) =>
            `${session.id} model=${session.model} provider=${session.provider} messages=${session.messageCount} updatedAt=${session.updatedAt}`,
        ),
      ].join('\n');
    }

    if (result.action === 'create') {
      return [
        'action=create',
        `db=${result.dbPath ?? 'default'}`,
        `session=${result.session?.id ?? 'unknown'}`,
        `project=${result.session?.projectPath ?? 'unknown'}`,
        `model=${result.session?.model ?? 'unknown'}`,
        `provider=${result.session?.provider ?? 'unknown'}`,
      ].join(' ');
    }

    if (!result.found) {
      return [
        'action=resume',
        `db=${result.dbPath ?? 'default'}`,
        'found=false',
      ].join(' ');
    }
    return [
      'action=resume',
      `db=${result.dbPath ?? 'default'}`,
      'found=true',
      `session=${result.session?.id ?? 'unknown'}`,
      `messages=${result.messages?.length ?? 0}`,
      `data=${JSON.stringify(result.messages ?? [])}`,
    ].join(' ');
  }

  if (result.type === 'cost') {
    return [
      `scope=${result.scope}`,
      `db=${result.dbPath ?? 'default'}`,
      `session=${result.sessionId ?? 'n/a'}`,
      `day=${result.day ?? 'n/a'}`,
      `model=${result.model ?? 'n/a'}`,
      `promptTokens=${result.aggregate.promptTokens}`,
      `completionTokens=${result.aggregate.completionTokens}`,
      `totalTokens=${result.aggregate.totalTokens}`,
      `cacheReadTokens=${result.aggregate.cacheReadTokens}`,
      `cacheWriteTokens=${result.aggregate.cacheWriteTokens}`,
      `costUsd=${result.aggregate.costUsd.toFixed(6)}`,
      `toolCalls=${result.aggregate.toolCallCount}`,
    ].join(' ');
  }

  if (result.type === 'tools') {
    const header = [
      `tools=${result.tools.length}`,
      `crushAvailable=${result.crushAvailable}`,
      `crushCommand=${result.crushCommand}`,
      `crushReason=${result.crushReason ?? 'none'}`,
    ].join(' ');
    return [
      header,
      ...result.tools.map((tool) => {
        const prefix = tool.source === 'crush' ? '[crush] ' : '';
        return `${prefix}${tool.name} source=${tool.source} level=${tool.permissionLevel} description=${JSON.stringify(tool.description)}`;
      }),
    ].join('\n');
  }

  if (result.type === 'skill-list') {
    if (result.skills.length === 0) {
      return 'skills=0';
    }
    return [
      `skills=${result.skills.length}`,
      ...result.skills.map(
        (skill) =>
          `${skill.name} title=${JSON.stringify(skill.title)} file=${skill.skillFilePath}`,
      ),
    ].join('\n');
  }

  if (result.type === 'skill-use') {
    if (!result.applied) {
      return [
        `skill=${result.skillName}`,
        'applied=false',
        `reason=${result.reason ?? 'unknown'}`,
        `policySource=${result.policySource ?? 'unknown'}`,
      ].join(' ');
    }

    return [
      `skill=${result.skillName}`,
      'applied=true',
      `title=${JSON.stringify(result.title ?? result.skillName)}`,
      `file=${result.skillFilePath ?? 'unknown'}`,
      `appliedAt=${result.appliedAt ?? 'unknown'}`,
      `content=${JSON.stringify(result.content ?? '')}`,
    ].join(' ');
  }

  if (result.type === 'todo') {
    if (result.action === 'guard') {
      return [
        `action=${result.action}`,
        `tasks=${result.tasks.length}`,
        `shouldContinue=${result.shouldContinue ?? false}`,
        `reason=${result.guardReason ?? 'none'}`,
        `unfinished=${JSON.stringify(result.unfinishedTaskIds ?? [])}`,
      ].join(' ');
    }

    if (result.tasks.length === 0) {
      return `action=${result.action} tasks=0`;
    }
    return [
      `action=${result.action}`,
      `tasks=${result.tasks.length}`,
      ...result.tasks.map(
        (task) =>
          `${task.id} status=${task.status} title=${JSON.stringify(task.title)}${
            task.lastReason ? ` reason=${JSON.stringify(task.lastReason)}` : ''
          }`,
      ),
    ].join('\n');
  }

  if (result.type === 'plugin-discover') {
    if (result.manifests.length === 0) {
      return 'plugins=0';
    }
    return [
      `plugins=${result.manifests.length}`,
      ...result.manifests.map(
        (manifest) =>
          `${manifest.name}@${manifest.version} source=${manifest.source} type=${manifest.type} enabled=${manifest.enabled} level=L${manifest.permissionLevel}`,
      ),
    ].join('\n');
  }

  if (result.type === 'plugin-bootstrap') {
    if (result.entries.length === 0) {
      return 'plugins=0';
    }
    return [
      `plugins=${result.entries.length}`,
      ...result.entries.map(
        (entry) =>
          `${entry.manifest.name} status=${entry.status} source=${entry.manifest.source} level=L${entry.manifest.permissionLevel}${
            entry.error ? ` error=${entry.error}` : ''
          }`,
      ),
    ].join('\n');
  }

  if (result.type === 'plugin-exec') {
    if (!result.executed) {
      return [
        `plugin=${result.pluginName}`,
        `tool=${result.toolName}`,
        'executed=false',
        `reason=${result.reason ?? 'unknown'}`,
        `policySource=${result.policySource ?? 'unknown'}`,
      ].join(' ');
    }
    return [
      `plugin=${result.pluginName}`,
      `tool=${result.toolName}`,
      'executed=true',
      `status=${result.status ?? 'unknown'}`,
      `result=${JSON.stringify(result.result ?? {})}`,
    ].join(' ');
  }

  if (result.type === 'setup') {
    return result.success ? 'Client setup completed.' : 'Client setup failed.';
  }

  return `provider catalog updated version=${result.version} source=${result.source} checksum=${result.checksum}`;
}

export async function executeCommand(
  command: CliCommand,
  deps: ExecuteCommandDeps = {},
): Promise<string> {
  const result = await executeCommandDetailed(command, deps);
  return formatCommandResultText(result);
}
