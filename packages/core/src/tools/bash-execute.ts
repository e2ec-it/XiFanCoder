import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { ToolExecutionError } from '../errors/tool-errors.js';
import {
  buildSandboxedCommand,
  checkCommandSafety,
  sanitizeCommandEnv,
} from './sandbox.js';

export interface BashExecuteRequest {
  readonly command: string;
  readonly timeoutMs?: number;
  readonly workingDir?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly actor?: string;
}

export interface BashExecuteOptions {
  readonly defaultTimeoutMs?: number;
  readonly defaultMaxOutputBytes?: number;
  readonly defaultMemoryLimitMb?: number;
  readonly defaultCpuLimitSec?: number;
  readonly auditLogPath?: string;
}

export interface BashExecuteResult {
  readonly command: string;
  readonly workingDir: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_MEMORY_LIMIT_MB = 512;
const DEFAULT_CPU_LIMIT_SEC = 30;

interface BashAuditLogEntry {
  readonly timestamp: string;
  readonly actor: string;
  readonly command: string;
  readonly workingDir: string;
  readonly decision: 'blocked' | 'executed' | 'error';
  readonly reason?: string;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly timedOut?: boolean;
  readonly durationMs?: number;
}

interface StreamCapture {
  readonly chunks: Buffer[];
  bytes: number;
  truncated: boolean;
}

function isProcessStillRunning(child: ReturnType<typeof spawn>): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function signalProcessTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      /* v8 ignore next -- OS-level fallback: process group kill failure */
    }
  }
  /* v8 ignore next 2 -- OS-level fallback path */
  child.kill(signal);
}

function createCapture(): StreamCapture {
  return {
    chunks: [],
    bytes: 0,
    truncated: false,
  };
}

function appendChunk(capture: StreamCapture, chunk: Buffer, maxBytes: number): void {
  /* v8 ignore next 4 -- defensive guard: stream data arrives in sequence */
  if (capture.bytes >= maxBytes) {
    capture.truncated = true;
    return;
  }

  const remaining = maxBytes - capture.bytes;
  if (chunk.length <= remaining) {
    capture.chunks.push(chunk);
    capture.bytes += chunk.length;
    return;
  }

  capture.chunks.push(chunk.subarray(0, remaining));
  capture.bytes = maxBytes;
  capture.truncated = true;
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new ToolExecutionError('bash_execute', `invalid ${name}: ${resolved}`);
  }
  return resolved;
}

function normalizeWorkingDir(workingDir: string | undefined): string {
  const resolved = workingDir ?? process.cwd();

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch (error) {
    throw new ToolExecutionError('bash_execute', `working directory not found: ${resolved}`, error);
  }

  if (!stat.isDirectory()) {
    throw new ToolExecutionError('bash_execute', `working directory is not a directory: ${resolved}`);
  }

  return resolved;
}

function appendAuditLog(auditLogPath: string | undefined, entry: BashAuditLogEntry): void {
  if (!auditLogPath) return;

  fs.mkdirSync(path.dirname(auditLogPath), { recursive: true });
  fs.appendFileSync(
    auditLogPath,
    `${JSON.stringify(entry)}\n`,
    'utf8',
  );
}

export async function executeBashCommand(
  request: BashExecuteRequest,
  options: BashExecuteOptions = {},
): Promise<BashExecuteResult> {
  if (request.command.trim().length === 0) {
    throw new ToolExecutionError('bash_execute', 'command must not be empty');
  }

  const timeoutMs = normalizePositiveInteger(
    request.timeoutMs,
    options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    'timeoutMs',
  );
  const maxStdoutBytes = normalizePositiveInteger(
    request.maxStdoutBytes,
    options.defaultMaxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    'maxStdoutBytes',
  );
  const maxStderrBytes = normalizePositiveInteger(
    request.maxStderrBytes,
    options.defaultMaxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    'maxStderrBytes',
  );
  const memoryLimitMb = normalizePositiveInteger(
    undefined,
    options.defaultMemoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB,
    'memoryLimitMb',
  );
  const cpuLimitSec = normalizePositiveInteger(
    undefined,
    options.defaultCpuLimitSec ?? DEFAULT_CPU_LIMIT_SEC,
    'cpuLimitSec',
  );
  const workingDir = normalizeWorkingDir(request.workingDir);
  const actor = request.actor ?? 'assistant';

  const safetyDecision = checkCommandSafety(request.command);
  if (!safetyDecision.allowed) {
    appendAuditLog(options.auditLogPath, {
      timestamp: new Date().toISOString(),
      actor,
      command: request.command,
      workingDir,
      decision: 'blocked',
      reason: safetyDecision.reason,
    });
    throw new ToolExecutionError(
      'bash_execute',
      `command blocked by sandbox policy: ${safetyDecision.reason ?? 'unknown'}`,
    );
  }

  const started = Date.now();
  const stdoutCapture = createCapture();
  const stderrCapture = createCapture();
  let timedOut = false;
  const sandboxedCommand = buildSandboxedCommand(request.command, {
    memoryLimitMb,
    cpuTimeSec: cpuLimitSec,
  });

  return await new Promise<BashExecuteResult>((resolve, reject) => {
    const child = spawn('/bin/bash', ['-lc', sandboxedCommand], {
      cwd: workingDir,
      env: sanitizeCommandEnv(process.env, request.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let forceKillTimer: NodeJS.Timeout | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      if (isProcessStillRunning(child)) {
        signalProcessTree(child, 'SIGTERM');
      }
      forceKillTimer = setTimeout(() => {
        if (isProcessStillRunning(child)) {
          signalProcessTree(child, 'SIGKILL');
        }
      }, 500).unref();
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      appendChunk(
        stdoutCapture,
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        maxStdoutBytes,
      );
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      appendChunk(
        stderrCapture,
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        maxStderrBytes,
      );
    });

    /* v8 ignore start -- spawn error handler: requires OS-level spawn failure */
    child.on('error', (error) => {
      clearTimeout(timer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      appendAuditLog(options.auditLogPath, {
        timestamp: new Date().toISOString(),
        actor,
        command: request.command,
        workingDir,
        decision: 'error',
        reason: error.message,
        timedOut,
        durationMs: Date.now() - started,
      });
      reject(new ToolExecutionError('bash_execute', error.message, error));
    });
    /* v8 ignore stop */

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      const result: BashExecuteResult = {
        command: request.command,
        workingDir,
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutCapture.chunks).toString('utf8'),
        stderr: Buffer.concat(stderrCapture.chunks).toString('utf8'),
        stdoutTruncated: stdoutCapture.truncated,
        stderrTruncated: stderrCapture.truncated,
        timedOut,
        durationMs: Date.now() - started,
      };

      appendAuditLog(options.auditLogPath, {
        timestamp: new Date().toISOString(),
        actor,
        command: request.command,
        workingDir,
        decision: 'executed',
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      });

      resolve(result);
    });
  });
}
