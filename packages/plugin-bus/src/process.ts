import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

import type {
  DiscoveredPluginManifest,
  PluginConfig,
  PluginInitResult,
  PluginToolExecuteResult,
  PluginProcess,
  PluginProcessFactory,
} from './types.js';

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcErrorPayload {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

interface JsonRpcResponseSuccess {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result: unknown;
}

interface JsonRpcResponseError {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly error: JsonRpcErrorPayload;
}

type JsonRpcResponse = JsonRpcResponseSuccess | JsonRpcResponseError;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
  readonly communicationTimeout: ReturnType<typeof setTimeout>;
  readonly executionTimeout?: ReturnType<typeof setTimeout>;
}

const SAFE_ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'USER',
  'SHELL',
  'TERM',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
]);

function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function assertArgsWithinWorkingDirectory(value: unknown, workingDirectory: string): void {
  if (typeof value === 'string') {
    if (!path.isAbsolute(value)) {
      return;
    }
    const resolved = path.resolve(value);
    if (!isWithinRoot(resolved, workingDirectory)) {
      throw new Error(`plugin path argument outside working directory: ${value}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      assertArgsWithinWorkingDirectory(item, workingDirectory);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      assertArgsWithinWorkingDirectory(item, workingDirectory);
    }
  }
}

function buildSanitizedEnvironment(manifest: DiscoveredPluginManifest): NodeJS.ProcessEnv {
  if (manifest.sanitizeEnv === false) {
    const merged = {
      ...process.env,
      ...(manifest.env ?? {}),
    };
    merged.XIFAN_PLUGIN_MAX_MEMORY_MB = String(manifest.maxMemoryMb ?? 512);
    merged.XIFAN_PLUGIN_CPU_LIMIT_MS = String(manifest.cpuTimeLimitMs ?? 5_000);
    return merged;
  }

  const env: NodeJS.ProcessEnv = {};
  for (const [key, rawValue] of Object.entries(process.env)) {
    /* v8 ignore next 3 -- Object.entries(process.env) can yield undefined values on some platforms */
    if (rawValue === undefined) {
      continue;
    }
    if (SAFE_ENV_ALLOWLIST.has(key) || key.startsWith('XIFAN_')) {
      env[key] = rawValue;
    }
  }

  for (const [key, value] of Object.entries(manifest.env ?? {})) {
    env[key] = value;
  }
  env.XIFAN_PLUGIN_MAX_MEMORY_MB = String(manifest.maxMemoryMb ?? 512);
  env.XIFAN_PLUGIN_CPU_LIMIT_MS = String(manifest.cpuTimeLimitMs ?? 5_000);
  return env;
}

function applyNodeMemoryLimitArgs(
  manifest: DiscoveredPluginManifest,
  args: readonly string[],
): readonly string[] {
  const maxMemoryMb = manifest.maxMemoryMb ?? 512;
  if (maxMemoryMb <= 0) {
    return args;
  }

  const isNodeRuntime =
    manifest.type === 'node' ||
    path.basename(manifest.command ?? '').toLowerCase().startsWith('node');
  if (!isNodeRuntime) {
    return args;
  }

  const memoryFlag = `--max-old-space-size=${maxMemoryMb}`;
  const hasMemoryFlag = args.some((value) => value.startsWith('--max-old-space-size='));
  if (hasMemoryFlag) {
    return args;
  }
  return [memoryFlag, ...args];
}

function hasExited(child: ReturnType<typeof spawn>): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/* v8 ignore next 20 -- process-level timing: exit race between SIGTERM and timeout */
async function waitForExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<boolean> {
  if (hasExited(child)) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(true);
    };

    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);

    child.on('exit', onExit);
  });
}

function resolveLaunchCommand(
  manifest: DiscoveredPluginManifest,
): { readonly command: string; readonly args: readonly string[] } {
  if (manifest.type === 'stdio') {
    return {
      command: manifest.command ?? '',
      args: manifest.args ?? [],
    };
  }

  if (manifest.type === 'node') {
    const modulePath = manifest.module ?? '';
    if (!path.isAbsolute(modulePath) && !modulePath.startsWith('.')) {
      throw new Error(
        `node plugin currently requires absolute/relative module path: ${manifest.name}`,
      );
    }
    return {
      command: process.execPath,
      args: [modulePath, ...(manifest.args ?? [])],
    };
  }

  return {
    command: 'python3',
    args: ['-m', manifest.module ?? '', ...(manifest.args ?? [])],
  };
}

export class ChildProcessPluginProcess implements PluginProcess {
  private child?: ReturnType<typeof spawn>;
  private outputReader?: readline.Interface;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly manifest: DiscoveredPluginManifest) {}

  get pid(): number | undefined {
    return this.child?.pid;
  }

  async start(): Promise<void> {
    if (this.child) {
      return;
    }

    const launch = resolveLaunchCommand(this.manifest);
    if (!launch.command) {
      throw new Error(`invalid plugin command for ${this.manifest.name}`);
    }

    const launchArgs = applyNodeMemoryLimitArgs(this.manifest, launch.args);
    const child = spawn(launch.command, [...launchArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: buildSanitizedEnvironment(this.manifest),
    });
    this.child = child;

    this.outputReader = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    this.outputReader.on('line', (line) => this.handleStdoutLine(line));

    child.on('exit', (code, signal) => {
      this.rejectAllPending(
        new Error(
          `plugin process exited name=${this.manifest.name} code=${code ?? 'null'} signal=${signal ?? 'null'}`,
        ),
      );
      this.cleanupProcessHandles();
    });
  }

  async init(config: PluginConfig): Promise<PluginInitResult> {
    const result = await this.request('plugin/init', config);
    return (result ?? {}) as PluginInitResult;
  }

  async executeTool(toolName: string, args: unknown): Promise<PluginToolExecuteResult> {
    const result = await this.request('plugin/executeTool', {
      toolName,
      args,
    });
    return (result ?? {}) as PluginToolExecuteResult;
  }

  async destroy(): Promise<void> {
    if (!this.child) {
      return;
    }

    try {
      await this.request('plugin/destroy', {}, 1_000).catch(() => undefined);
    } finally {
      await this.terminateProcess();
    }
  }

  private async request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    if (method === 'plugin/executeTool') {
      const candidateArgs =
        params && typeof params === 'object'
          ? (params as Record<string, unknown>).args
          : /* v8 ignore next */ undefined;
      assertArgsWithinWorkingDirectory(candidateArgs, path.resolve(process.cwd()));
    }

    await this.start();

    const child = this.child;
    /* v8 ignore next 3 -- defensive guard: start() always sets this.child */
    if (!child || !child.stdin) {
      throw new Error(`plugin process not started: ${this.manifest.name}`);
    }

    const id = this.nextId++;
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const effectiveTimeout = timeoutMs ?? this.manifest.timeout ?? 30_000;
    const executionLimitMs =
      method === 'plugin/executeTool' ? (this.manifest.cpuTimeLimitMs ?? 5_000) : undefined;

    const requestPromise = new Promise<unknown>((resolve, reject) => {
      const communicationTimeout = setTimeout(() => {
        this.pending.delete(id);
        void this.terminateProcess();
        reject(new Error(`plugin request timeout name=${this.manifest.name} method=${method}`));
      }, effectiveTimeout);

      const executionTimeout =
        executionLimitMs === undefined
          ? undefined
          : setTimeout(() => {
            this.pending.delete(id);
            void this.terminateProcess();
            reject(
              new Error(
                `plugin execution limit exceeded name=${this.manifest.name} method=${method} limitMs=${executionLimitMs}`,
              ),
            );
          }, executionLimitMs);

      this.pending.set(id, {
        resolve,
        reject,
        communicationTimeout,
        executionTimeout,
      });
    });

    child.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8');
    return requestPromise;
  }

  private handleStdoutLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }

    if (!message || typeof message.id !== 'number' || message.jsonrpc !== '2.0') {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.communicationTimeout);
    if (pending.executionTimeout) {
      clearTimeout(pending.executionTimeout);
    }
    this.pending.delete(message.id);

    if ('error' in message) {
      pending.reject(
        new Error(
          `plugin rpc error name=${this.manifest.name} code=${message.error.code} message=${message.error.message}`,
        ),
      );
      return;
    }

    pending.resolve(message.result);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.communicationTimeout);
      if (pending.executionTimeout) {
        clearTimeout(pending.executionTimeout);
      }
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private cleanupProcessHandles(): void {
    this.outputReader?.close();
    this.outputReader = undefined;
    this.child = undefined;
  }

  private async terminateProcess(): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }

    if (!hasExited(child)) {
      child.kill('SIGTERM');
    }

    const exitedByTerm = await waitForExit(child, 1_000);
    /* v8 ignore next 4 -- OS-level SIGKILL fallback when SIGTERM fails */
    if (!exitedByTerm && !hasExited(child)) {
      child.kill('SIGKILL');
      await waitForExit(child, 1_000);
    }

    this.cleanupProcessHandles();
  }
}

export class ChildProcessPluginFactory implements PluginProcessFactory {
  private readonly processes = new Map<string, ChildProcessPluginProcess>();

  async create(manifest: DiscoveredPluginManifest): Promise<ChildProcessPluginProcess> {
    const process = new ChildProcessPluginProcess(manifest);
    await process.start();
    this.processes.set(manifest.name, process);
    return process;
  }

  get(name: string): ChildProcessPluginProcess | undefined {
    return this.processes.get(name);
  }
}
