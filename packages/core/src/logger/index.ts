import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { sanitizeLogValue } from './sanitizer.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly module: string;
  readonly message: string;
  readonly context?: unknown;
}

export interface LoggerOptions {
  readonly module: string;
  readonly level?: LogLevel;
  readonly logDir?: string;
  readonly enableConsole?: boolean;
  readonly retainDays?: number;
  readonly now?: () => Date;
}

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  readonly module: string;
  readonly level: LogLevel;
  readonly logDir: string;
  readonly enableConsole: boolean;
  readonly retainDays: number;

  private readonly now: () => Date;
  private lastPruneDate = '';

  constructor(options: LoggerOptions) {
    this.module = options.module;
    this.level = options.level ?? resolveLogLevel(process.env.XIFAN_LOG_LEVEL);
    this.logDir = options.logDir ?? path.join(homedir(), '.xifan', 'coder', 'logs');
    this.enableConsole = options.enableConsole ?? false;
    this.retainDays = options.retainDays ?? 7;
    this.now = options.now ?? (() => new Date());
  }

  debug(message: string, context?: unknown): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: unknown): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: unknown): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: unknown): void {
    this.log('error', message, context);
  }

  log(level: LogLevel, message: string, context?: unknown): void {
    if (!shouldLog(level, this.level)) {
      return;
    }

    const now = this.now();
    const entry: LogEntry = {
      timestamp: now.toISOString(),
      level,
      module: this.module,
      message,
      ...(context === undefined ? {} : { context: sanitizeLogValue(context) }),
    };

    this.ensureLogDir();
    this.pruneIfNeeded(now);

    const filePath = path.join(this.logDir, `${formatDate(now)}.log`);
    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFileSync(filePath, line, 'utf8');

    if (this.enableConsole) {
      emitConsole(level, line.trim());
    }
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private pruneIfNeeded(now: Date): void {
    const today = formatDate(now);
    if (today === this.lastPruneDate) {
      return;
    }
    pruneOldLogFiles(this.logDir, this.retainDays, now);
    this.lastPruneDate = today;
  }
}

export function resolveLogLevel(raw: string | undefined): LogLevel {
  const normalized = raw?.trim().toLowerCase();
  if (
    normalized === 'debug' ||
    normalized === 'info' ||
    normalized === 'warn' ||
    normalized === 'error'
  ) {
    return normalized;
  }
  return 'info';
}

export function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[threshold];
}

export function pruneOldLogFiles(logDir: string, retainDays = 7, now = new Date()): void {
  if (!fs.existsSync(logDir)) {
    return;
  }

  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  cutoff.setUTCDate(cutoff.getUTCDate() - retainDays);

  for (const name of fs.readdirSync(logDir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(name)) {
      continue;
    }
    const fileDate = parseLogDate(name);
    if (!fileDate) {
      continue;
    }
    if (fileDate < cutoff) {
      fs.rmSync(path.join(logDir, name), { force: true });
    }
  }
}

function parseLogDate(fileName: string): Date | undefined {
  const [datePart] = fileName.split('.log');
  /* v8 ignore next 3 -- defensive guard: split always produces a first element */
  if (!datePart) {
    return undefined;
  }
  const parsed = new Date(`${datePart}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function emitConsole(level: LogLevel, line: string): void {
  if (level === 'debug' || level === 'info') {
    console.log(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.error(line);
}
