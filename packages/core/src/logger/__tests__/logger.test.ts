import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Logger, pruneOldLogFiles, resolveLogLevel, shouldLog } from '../index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
  delete process.env.XIFAN_LOG_LEVEL;
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-logger-'));
  tempDirs.push(dir);
  return dir;
}

describe('Logger', () => {
  it('writes sanitized json logs to date-based file', () => {
    const logDir = makeTempDir();
    const logger = new Logger({
      module: 'runtime',
      level: 'info',
      logDir,
      now: () => new Date('2026-02-20T12:00:00.000Z'),
    });

    logger.info('start', {
      apiKey: 'secret-value',
      message: 'token=abc123',
    });

    const file = path.join(logDir, '2026-02-20.log');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);

    const payload = JSON.parse(lines[0] ?? '{}') as {
      readonly level: string;
      readonly module: string;
      readonly context?: { readonly apiKey?: string; readonly message?: string };
    };
    expect(payload.level).toBe('info');
    expect(payload.module).toBe('runtime');
    expect(payload.context?.apiKey).toBe('****');
    expect(payload.context?.message).toContain('****');
  });

  it('filters lower-priority levels', () => {
    const logDir = makeTempDir();
    const logger = new Logger({
      module: 'runtime',
      level: 'warn',
      logDir,
      now: () => new Date('2026-02-20T12:00:00.000Z'),
    });

    logger.info('ignored');
    logger.warn('kept');

    const file = path.join(logDir, '2026-02-20.log');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);

    const payload = JSON.parse(lines[0] ?? '{}') as { readonly level: string };
    expect(payload.level).toBe('warn');
  });

  it('prunes files older than retain window', () => {
    const logDir = makeTempDir();
    fs.writeFileSync(path.join(logDir, '2026-02-10.log'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(logDir, '2026-02-14.log'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(logDir, '2026-02-20.log'), '{}\n', 'utf8');

    pruneOldLogFiles(logDir, 7, new Date('2026-02-20T10:00:00.000Z'));

    expect(fs.existsSync(path.join(logDir, '2026-02-10.log'))).toBe(false);
    expect(fs.existsSync(path.join(logDir, '2026-02-14.log'))).toBe(true);
    expect(fs.existsSync(path.join(logDir, '2026-02-20.log'))).toBe(true);
  });

  it('debug and error convenience methods write to file', () => {
    const logDir = makeTempDir();
    const logger = new Logger({
      module: 'test-mod',
      level: 'debug',
      logDir,
      now: () => new Date('2026-03-01T08:00:00.000Z'),
    });

    logger.debug('debug-msg', { key: 'val' });
    logger.error('error-msg');

    const file = path.join(logDir, '2026-03-01.log');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const debugEntry = JSON.parse(lines[0] ?? '{}') as { level: string };
    const errorEntry = JSON.parse(lines[1] ?? '{}') as { level: string };
    expect(debugEntry.level).toBe('debug');
    expect(errorEntry.level).toBe('error');
  });

  it('emitConsole outputs to console.log for debug/info and console.warn/error for warn/error', () => {
    const logDir = makeTempDir();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = new Logger({
      module: 'console-test',
      level: 'debug',
      logDir,
      enableConsole: true,
      now: () => new Date('2026-03-01T08:00:00.000Z'),
    });

    logger.debug('dbg');
    logger.info('inf');
    logger.warn('wrn');
    logger.error('err');

    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prunes only once per day', () => {
    const logDir = makeTempDir();
    fs.writeFileSync(path.join(logDir, '2026-01-01.log'), '{}\n', 'utf8');

    const logger = new Logger({
      module: 'prune-test',
      level: 'info',
      logDir,
      retainDays: 1,
      now: () => new Date('2026-03-01T08:00:00.000Z'),
    });

    // First log triggers prune
    logger.info('first');
    expect(fs.existsSync(path.join(logDir, '2026-01-01.log'))).toBe(false);

    // Write old file again; second log same day should NOT prune
    fs.writeFileSync(path.join(logDir, '2026-01-01.log'), '{}\n', 'utf8');
    logger.info('second');
    expect(fs.existsSync(path.join(logDir, '2026-01-01.log'))).toBe(true);
  });

  it('pruneOldLogFiles skips non-existent directory', () => {
    // Should not throw
    pruneOldLogFiles('/tmp/non-existent-xifan-dir-12345');
  });

  it('pruneOldLogFiles skips files named .log (empty date part)', () => {
    const logDir = makeTempDir();
    fs.writeFileSync(path.join(logDir, '.log'), '{}\n', 'utf8');

    pruneOldLogFiles(logDir, 7, new Date('2026-03-01T00:00:00.000Z'));
    expect(fs.existsSync(path.join(logDir, '.log'))).toBe(true);
  });

  it('pruneOldLogFiles skips non-date files and unparseable names', () => {
    const logDir = makeTempDir();
    fs.writeFileSync(path.join(logDir, 'random.log'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(logDir, 'not-a-date.log'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(logDir, '9999-99-99.log'), '{}\n', 'utf8');

    // Should not throw and should not delete non-matching files
    pruneOldLogFiles(logDir, 7, new Date('2026-03-01T00:00:00.000Z'));
    expect(fs.existsSync(path.join(logDir, 'random.log'))).toBe(true);
    expect(fs.existsSync(path.join(logDir, 'not-a-date.log'))).toBe(true);
  });

  it('creates log directory if it does not exist', () => {
    const root = makeTempDir();
    const logDir = path.join(root, 'nested', 'log', 'dir');

    const logger = new Logger({
      module: 'mkdir-test',
      level: 'info',
      logDir,
      now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    logger.info('hello');

    const file = path.join(logDir, '2026-04-01.log');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('resolveLogLevel handles various levels', () => {
    expect(resolveLogLevel('DEBUG')).toBe('debug');
    expect(resolveLogLevel('  WARN  ')).toBe('warn');
    expect(resolveLogLevel('ERROR')).toBe('error');
    expect(resolveLogLevel(undefined)).toBe('info');
    expect(resolveLogLevel('')).toBe('info');
  });

  it('log omits context field when context is undefined', () => {
    const logDir = makeTempDir();
    const logger = new Logger({
      module: 'no-ctx',
      level: 'info',
      logDir,
      now: () => new Date('2026-04-01T00:00:00.000Z'),
    });

    logger.info('no context');

    const file = path.join(logDir, '2026-04-01.log');
    const entry = JSON.parse(fs.readFileSync(file, 'utf8').trim()) as Record<string, unknown>;
    expect(entry).not.toHaveProperty('context');
  });
});

describe('log level helpers', () => {
  it('resolves env level with info fallback', () => {
    expect(resolveLogLevel('debug')).toBe('debug');
    expect(resolveLogLevel('invalid')).toBe('info');
  });

  it('compares level ordering', () => {
    expect(shouldLog('error', 'warn')).toBe(true);
    expect(shouldLog('info', 'warn')).toBe(false);
  });
});
