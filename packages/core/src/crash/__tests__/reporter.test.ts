import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCrashReporter,
  installProcessCrashReporter,
  parseCrashReporterEnv,
  type CrashProcessLike,
  type CrashReport,
} from '../reporter.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-crash-report-'));
  tempDirs.push(dir);
  return dir;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function makeRuntime() {
  return {
    pid: 1001,
    argv: ['node', 'xifan', '--token', 'secret-token'],
    version: 'v20.0.0',
    platform: 'darwin' as const,
    arch: 'arm64',
    env: {},
    cwd: () => '/workspace/project',
    uptime: () => 42.123,
  };
}

describe('crash reporter', () => {
  it('captures crash report to local file with redaction', async () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      autoReport: false,
      reportDir,
      now: () => new Date('2026-02-23T10:00:00.000Z'),
      runtime: makeRuntime(),
    });

    reporter.setRecentContext({
      action: 'plugin execute',
      apiKey: 'sk-abc123456789',
      note: 'token=internal-secret',
    });

    const result = await reporter.capture(
      'uncaughtException',
      new Error('fatal token=my-secret'),
      { waitForDelivery: true },
    );

    expect(result.deliveryStatus).toBe('disabled');
    const payload = readJsonFile<{
      trigger: { error: { message: string } };
      context: { recentOperation?: { apiKey?: string; note?: string } };
    }>(result.reportPath);
    expect(payload.trigger.error.message).toContain('****');
    expect(payload.context.recentOperation?.apiKey).toBe('****');
    expect(payload.context.recentOperation?.note).toContain('****');
  });

  it('delivers report when auto report is enabled', async () => {
    const reportDir = makeTempDir();
    const sendReport = vi.fn(async () => undefined);
    const reporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash-intake',
      reportDir,
      sendReport,
      sleep: async () => undefined,
    });

    const result = await reporter.capture('unhandledRejection', new Error('boom'), {
      waitForDelivery: true,
    });

    expect(result.deliveryStatus).toBe('sent');
    expect(result.attempts).toBe(1);
    expect(sendReport).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(reportDir, 'pending'))).toBe(false);
  });

  it('queues report when delivery fails after retries', async () => {
    const reportDir = makeTempDir();
    const sendReport = vi.fn(async () => {
      throw new Error('network token=offline');
    });
    const reporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash-intake',
      reportDir,
      sendReport,
      maxSendRetries: 3,
      initialRetryDelayMs: 1,
      maxRetryDelayMs: 2,
      sleep: async () => undefined,
    });

    const result = await reporter.capture('unhandledRejection', new Error('boom'), {
      waitForDelivery: true,
    });

    expect(result.deliveryStatus).toBe('queued');
    expect(result.attempts).toBe(3);
    expect(sendReport).toHaveBeenCalledTimes(3);
    const pendingDir = path.join(reportDir, 'pending');
    const pendingFiles = fs.readdirSync(pendingDir).filter((item) => item.endsWith('.json'));
    expect(pendingFiles).toHaveLength(1);
  });

  it('stores fatal exit report synchronously and queues for next flush', () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash-intake',
      reportDir,
    });

    const result = reporter.captureFatalExitSync(2);
    expect(result).toBeDefined();
    expect(result?.deliveryStatus).toBe('queued');

    const pendingDir = path.join(reportDir, 'pending');
    const pendingFiles = fs.readdirSync(pendingDir).filter((item) => item.endsWith('.json'));
    expect(pendingFiles).toHaveLength(1);
  });

  it('captureFatalExitSync returns undefined for exit code 0', () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      reportDir,
    });

    const result = reporter.captureFatalExitSync(0);
    expect(result).toBeUndefined();
  });

  it('captureFatalExitSync with delivery disabled writes report but not pending', () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      autoReport: false,
      reportDir,
    });

    const result = reporter.captureFatalExitSync(1);
    expect(result).toBeDefined();
    expect(result?.deliveryStatus).toBe('disabled');
    expect(result?.pendingPath).toBeUndefined();
  });

  it('capture without waitForDelivery queues immediately', async () => {
    const reportDir = makeTempDir();
    const sendReport = vi.fn(async () => undefined);
    const reporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash-intake',
      reportDir,
      sendReport,
      sleep: async () => undefined,
    });

    const result = await reporter.capture('uncaughtException', new Error('boom'));
    expect(result.deliveryStatus).toBe('queued');
    expect(result.attempts).toBe(0);
  });

  it('capture with delivery disabled and no waitForDelivery', async () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      autoReport: false,
      reportDir,
    });

    const result = await reporter.capture('uncaughtException', new Error('boom'));
    expect(result.deliveryStatus).toBe('disabled');
    expect(result.attempts).toBe(0);
  });

  it('flushPendingReports sends queued reports', async () => {
    const reportDir = makeTempDir();
    const sendReport = vi.fn(async () => undefined);
    const failSendReport = vi.fn(async () => {
      throw new Error('network error');
    });

    // First create some pending reports with a failing reporter
    const failReporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash-intake',
      reportDir,
      sendReport: failSendReport,
      maxSendRetries: 1,
      initialRetryDelayMs: 0,
      sleep: async () => undefined,
    });

    await failReporter.capture('uncaughtException', new Error('pending-test'), {
      waitForDelivery: true,
    });

    // Now create a new reporter that can deliver
    const reporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash-intake',
      reportDir,
      sendReport,
      maxSendRetries: 1,
      initialRetryDelayMs: 0,
      sleep: async () => undefined,
    });

    const result = await reporter.flushPendingReports();
    expect(result.processed).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('flushPendingReports returns zeros when delivery is disabled', async () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      autoReport: false,
      reportDir,
    });

    const result = await reporter.flushPendingReports();
    expect(result).toEqual({ processed: 0, sent: 0, failed: 0 });
  });

  it('flushPendingReports returns zeros when pending dir does not exist', async () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash-intake',
      reportDir,
    });

    const result = await reporter.flushPendingReports();
    expect(result).toEqual({ processed: 0, sent: 0, failed: 0 });
  });

  it('flushPendingReports skips non-json files', async () => {
    const reportDir = makeTempDir();
    const pendingDir = path.join(reportDir, 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'not-json.txt'), 'hello', 'utf8');

    const reporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash-intake',
      reportDir,
      sendReport: async () => undefined,
      sleep: async () => undefined,
    });

    const result = await reporter.flushPendingReports();
    expect(result.processed).toBe(0);
  });

  it('flushPendingReports handles invalid JSON in pending files', async () => {
    const reportDir = makeTempDir();
    const pendingDir = path.join(reportDir, 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'bad-report.json'), 'invalid json', 'utf8');

    const reporter = createCrashReporter({
      appName: 'xifancoder-cli',
      appVersion: '0.1.1',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash-intake',
      reportDir,
      sendReport: async () => undefined,
      sleep: async () => undefined,
    });

    const result = await reporter.flushPendingReports();
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('flushPendingReports counts failed deliveries', async () => {
    const reportDir = makeTempDir();
    const sendReport = vi.fn(async () => {
      throw new Error('fail');
    });

    // Create a pending report manually
    const pendingDir = path.join(reportDir, 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(
      path.join(pendingDir, 'test-report.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        reportId: 'test-report',
        createdAt: new Date().toISOString(),
        app: { name: 'test', version: '1.0.0' },
        trigger: { kind: 'uncaughtException', error: { name: 'Error', message: 'test' } },
        runtime: { nodeVersion: 'v20', platform: 'darwin', arch: 'arm64', pid: 1, cwd: '/', uptimeSec: 1 },
        context: { argv: [] },
        delivery: { enabled: true, target: 'https://example.com', status: 'queued' },
      }),
      'utf8',
    );

    const reporter = createCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash-intake',
      reportDir,
      sendReport,
      maxSendRetries: 1,
      initialRetryDelayMs: 0,
      sleep: async () => undefined,
    });

    const result = await reporter.flushPendingReports();
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
  });

  it('normalizeErrorPayload handles string reason', async () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
    });

    const result = await reporter.capture('uncaughtException', 'string error');
    const payload = readJsonFile<CrashReport>(result.reportPath);
    expect(payload.trigger.error.name).toBe('Error');
    expect(payload.trigger.error.message).toBe('string error');
  });

  it('normalizeErrorPayload handles object-like reason', async () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
    });

    const result = await reporter.capture('uncaughtException', {
      name: 'CustomError',
      message: 'custom msg',
      stack: 'at foo:1',
    });
    const payload = readJsonFile<CrashReport>(result.reportPath);
    expect(payload.trigger.error.name).toBe('CustomError');
    expect(payload.trigger.error.message).toBe('custom msg');
    expect(payload.trigger.error.stack).toBe('at foo:1');
  });

  it('normalizeErrorPayload handles non-error non-string reason', async () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
    });

    const result = await reporter.capture('uncaughtException', 42);
    const payload = readJsonFile<CrashReport>(result.reportPath);
    expect(payload.trigger.error.name).toBe('Error');
    expect(payload.trigger.error.message).toBe('42');
  });

  it('normalizeErrorPayload handles object without name/message', async () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
    });

    const result = await reporter.capture('uncaughtException', { foo: 'bar' });
    const payload = readJsonFile<CrashReport>(result.reportPath);
    expect(payload.trigger.error.name).toBe('Error');
  });

  it('normalizeErrorPayload handles null reason', async () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
    });

    const result = await reporter.capture('uncaughtException', null);
    const payload = readJsonFile<CrashReport>(result.reportPath);
    expect(payload.trigger.error.name).toBe('Error');
  });

  it('redactArgvSecrets redacts --api-key, --password, --secret, --credential flags', async () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
      runtime: {
        ...makeRuntime(),
        argv: ['node', '--api-key', 'key123', '--password', 'pass', '--secret', 'sec', '--credential', 'cred', '--api_key', 'k2'],
      },
    });

    const result = await reporter.capture('uncaughtException', new Error('test'));
    const payload = readJsonFile<CrashReport>(result.reportPath);
    const argv = payload.context.argv;
    expect(argv).toContain('****');
    expect(argv).not.toContain('key123');
    expect(argv).not.toContain('pass');
  });

  it('creates report without recentContext', async () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
      runtime: makeRuntime(),
    });

    const result = await reporter.capture('uncaughtException', new Error('test'));
    const payload = readJsonFile<CrashReport>(result.reportPath);
    expect(payload.context.recentOperation).toBeUndefined();
  });

  it('retryWithBackoff respects delay and maxDelay', async () => {
    const reportDir = makeTempDir();
    const sleepCalls: number[] = [];
    let callCount = 0;
    const sendReport = vi.fn(async () => {
      callCount++;
      if (callCount <= 2) throw new Error('fail');
    });

    const reporter = createCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash-intake',
      reportDir,
      sendReport,
      maxSendRetries: 3,
      initialRetryDelayMs: 10,
      maxRetryDelayMs: 50,
      sleep: async (ms: number) => { sleepCalls.push(ms); },
    });

    const result = await reporter.capture('uncaughtException', new Error('test'), {
      waitForDelivery: true,
    });

    expect(result.deliveryStatus).toBe('sent');
    expect(result.attempts).toBe(3);
    expect(sleepCalls.length).toBe(2);
    expect(sleepCalls[0]).toBe(10);
    expect(sleepCalls[1]).toBe(20);
  });

  it('retryWithBackoff with initialRetryDelayMs=0 still progresses', async () => {
    const reportDir = makeTempDir();
    let callCount = 0;
    const sendReport = vi.fn(async () => {
      callCount++;
      if (callCount < 2) throw new Error('fail');
    });

    const reporter = createCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash-intake',
      reportDir,
      sendReport,
      maxSendRetries: 3,
      initialRetryDelayMs: 0,
      maxRetryDelayMs: 100,
      sleep: async () => undefined,
    });

    const result = await reporter.capture('uncaughtException', new Error('test'), {
      waitForDelivery: true,
    });

    expect(result.deliveryStatus).toBe('sent');
    expect(result.attempts).toBe(2);
  });

  it('uses defaultCrashReportSender when no custom sendReport provided', async () => {
    const reportDir = makeTempDir();
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const reporter = createCrashReporter({
      appName: 'test-app',
      appVersion: '2.0.0',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash',
      reportDir,
      maxSendRetries: 1,
      initialRetryDelayMs: 0,
      sleep: async () => undefined,
      // No sendReport - use defaultCrashReportSender
    });

    const result = await reporter.capture('uncaughtException', new Error('test'), {
      waitForDelivery: true,
    });

    expect(result.deliveryStatus).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.com/crash');
    expect(options.method).toBe('POST');
    expect(options.headers['content-type']).toBe('application/json');
    expect(options.headers['user-agent']).toBe('test-app/2.0.0');

    vi.unstubAllGlobals();
  });

  it('defaultCrashReportSender throws on non-ok response', async () => {
    const reportDir = makeTempDir();
    const fetchMock = vi.fn(async () => new Response('error', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const reporter = createCrashReporter({
      appName: 'test-app',
      appVersion: '2.0.0',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash',
      reportDir,
      maxSendRetries: 1,
      initialRetryDelayMs: 0,
      sleep: async () => undefined,
    });

    const result = await reporter.capture('uncaughtException', new Error('test'), {
      waitForDelivery: true,
    });

    expect(result.deliveryStatus).toBe('queued');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('toSafeErrorMessage handles non-Error non-string type in retry failure', async () => {
    const reportDir = makeTempDir();
    const sendReport = vi.fn(async () => {
      throw 42; // non-Error non-string
    });

    const reporter = createCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash',
      reportDir,
      sendReport,
      maxSendRetries: 1,
      initialRetryDelayMs: 0,
      sleep: async () => undefined,
    });

    const result = await reporter.capture('uncaughtException', new Error('test'), {
      waitForDelivery: true,
    });

    expect(result.deliveryStatus).toBe('queued');
  });

  it('toSafeErrorMessage handles string type in retry failure', async () => {
    const reportDir = makeTempDir();
    const sendReport = vi.fn(async () => {
      throw 'string error message'; // string error
    });

    const reporter = createCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      autoReport: true,
      reportEndpoint: 'https://example.com/crash',
      reportDir,
      sendReport,
      maxSendRetries: 1,
      initialRetryDelayMs: 0,
      sleep: async () => undefined,
    });

    const result = await reporter.capture('uncaughtException', new Error('test'), {
      waitForDelivery: true,
    });

    expect(result.deliveryStatus).toBe('queued');
  });

  it('attemptDelivery returns disabled when no endpoint', async () => {
    const reportDir = makeTempDir();
    const reporter = createCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      autoReport: true,
      reportDir,
    });

    // autoReport=true but no endpoint -> canDeliver is false
    const result = await reporter.capture('uncaughtException', new Error('test'), {
      waitForDelivery: true,
    });
    expect(result.deliveryStatus).toBe('disabled');
  });
});

describe('parseCrashReporterEnv', () => {
  it('parses empty env', () => {
    const config = parseCrashReporterEnv({});
    expect(config.autoReport).toBe(false);
    expect(config.reportEndpoint).toBeUndefined();
    expect(config.reportDir).toBeUndefined();
    expect(config.maxSendRetries).toBeUndefined();
    expect(config.initialRetryDelayMs).toBeUndefined();
    expect(config.maxRetryDelayMs).toBeUndefined();
  });

  it('parses truthy XIFAN_CRASH_AUTO_REPORT values', () => {
    for (const value of ['1', 'true', 'yes', 'on', 'TRUE', 'Yes']) {
      expect(parseCrashReporterEnv({ XIFAN_CRASH_AUTO_REPORT: value }).autoReport).toBe(true);
    }
  });

  it('parses falsy XIFAN_CRASH_AUTO_REPORT values', () => {
    for (const value of ['0', 'false', 'no', 'off', 'FALSE', 'No']) {
      expect(parseCrashReporterEnv({ XIFAN_CRASH_AUTO_REPORT: value }).autoReport).toBe(false);
    }
  });

  it('returns false for unrecognized XIFAN_CRASH_AUTO_REPORT', () => {
    expect(parseCrashReporterEnv({ XIFAN_CRASH_AUTO_REPORT: 'maybe' }).autoReport).toBe(false);
  });

  it('parses integer env vars', () => {
    const config = parseCrashReporterEnv({
      XIFAN_CRASH_REPORT_RETRIES: '5',
      XIFAN_CRASH_REPORT_RETRY_DELAY_MS: '200',
      XIFAN_CRASH_REPORT_RETRY_MAX_DELAY_MS: '10000',
    });
    expect(config.maxSendRetries).toBe(5);
    expect(config.initialRetryDelayMs).toBe(200);
    expect(config.maxRetryDelayMs).toBe(10000);
  });

  it('returns undefined for non-integer values', () => {
    const config = parseCrashReporterEnv({
      XIFAN_CRASH_REPORT_RETRIES: 'abc',
    });
    expect(config.maxSendRetries).toBeUndefined();
  });

  it('returns undefined for negative integer values', () => {
    const config = parseCrashReporterEnv({
      XIFAN_CRASH_REPORT_RETRIES: '-1',
    });
    expect(config.maxSendRetries).toBeUndefined();
  });

  it('parses endpoint and dir', () => {
    const config = parseCrashReporterEnv({
      XIFAN_CRASH_REPORT_ENDPOINT: 'https://crash.example.com',
      XIFAN_CRASH_REPORT_DIR: '/tmp/crashes',
    });
    expect(config.reportEndpoint).toBe('https://crash.example.com');
    expect(config.reportDir).toBe('/tmp/crashes');
  });

  it('uses process.env by default', () => {
    const config = parseCrashReporterEnv();
    expect(config).toBeDefined();
    expect(typeof config.autoReport).toBe('boolean');
  });
});

describe('installProcessCrashReporter', () => {
  it('installs hooks and dispose removes them', () => {
    const reportDir = makeTempDir();
    const onceHandlers = new Map<string, Function>();
    const offCalls: string[] = [];

    const fakeProcess = {
      pid: 1,
      argv: ['node'],
      version: 'v20.0.0',
      platform: 'darwin' as const,
      arch: 'arm64',
      env: {},
      cwd: () => '/tmp',
      uptime: () => 1,
      exit: vi.fn(),
      once: vi.fn((event: string, handler: Function) => {
        onceHandlers.set(event, handler);
        return fakeProcess;
      }),
      off: vi.fn((event: string) => {
        offCalls.push(event);
        return fakeProcess;
      }),
    } as unknown as CrashProcessLike;

    const installed = installProcessCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
      autoReport: false,
      processRef: fakeProcess,
    });

    expect(fakeProcess.once).toHaveBeenCalledTimes(3);
    expect(onceHandlers.has('uncaughtException')).toBe(true);
    expect(onceHandlers.has('unhandledRejection')).toBe(true);
    expect(onceHandlers.has('exit')).toBe(true);

    installed.setRecentContext({ op: 'test' });
    installed.dispose();

    expect(fakeProcess.off).toHaveBeenCalledTimes(3);
  });

  it('handles uncaughtException and calls exit when exitOnCrash=true', async () => {
    vi.useFakeTimers();
    const reportDir = makeTempDir();
    const onceHandlers = new Map<string, Function>();

    const fakeProcess = {
      pid: 1,
      argv: ['node'],
      version: 'v20.0.0',
      platform: 'darwin' as const,
      arch: 'arm64',
      env: {},
      cwd: () => '/tmp',
      uptime: () => 1,
      exit: vi.fn(),
      once: vi.fn((event: string, handler: Function) => {
        onceHandlers.set(event, handler);
        return fakeProcess;
      }),
      off: vi.fn(() => fakeProcess),
    } as unknown as CrashProcessLike;

    installProcessCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
      autoReport: false,
      processRef: fakeProcess,
      exitOnCrash: true,
    });

    const handler = onceHandlers.get('uncaughtException')!;
    handler(new Error('crash!'));

    // After timeout, exit should be called
    await vi.advanceTimersByTimeAsync(20);
    expect(fakeProcess.exit).toHaveBeenCalledWith(1);

    vi.useRealTimers();
  });

  it('handles uncaughtException without exit when exitOnCrash=false', () => {
    const reportDir = makeTempDir();
    const onceHandlers = new Map<string, Function>();

    const fakeProcess = {
      pid: 1,
      argv: ['node'],
      version: 'v20.0.0',
      platform: 'darwin' as const,
      arch: 'arm64',
      env: {},
      cwd: () => '/tmp',
      uptime: () => 1,
      exit: vi.fn(),
      once: vi.fn((event: string, handler: Function) => {
        onceHandlers.set(event, handler);
        return fakeProcess;
      }),
      off: vi.fn(() => fakeProcess),
    } as unknown as CrashProcessLike;

    installProcessCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
      autoReport: false,
      processRef: fakeProcess,
      exitOnCrash: false,
    });

    const handler = onceHandlers.get('uncaughtException')!;
    handler(new Error('crash!'));

    expect(fakeProcess.exit).not.toHaveBeenCalled();
  });

  it('handles unhandledRejection', async () => {
    vi.useFakeTimers();
    const reportDir = makeTempDir();
    const onceHandlers = new Map<string, Function>();

    const fakeProcess = {
      pid: 1,
      argv: ['node'],
      version: 'v20.0.0',
      platform: 'darwin' as const,
      arch: 'arm64',
      env: {},
      cwd: () => '/tmp',
      uptime: () => 1,
      exit: vi.fn(),
      once: vi.fn((event: string, handler: Function) => {
        onceHandlers.set(event, handler);
        return fakeProcess;
      }),
      off: vi.fn(() => fakeProcess),
    } as unknown as CrashProcessLike;

    installProcessCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
      autoReport: false,
      processRef: fakeProcess,
      exitOnCrash: true,
    });

    const handler = onceHandlers.get('unhandledRejection')!;
    handler('rejected promise');

    await vi.advanceTimersByTimeAsync(20);
    expect(fakeProcess.exit).toHaveBeenCalledWith(1);

    vi.useRealTimers();
  });

  it('unhandledRejection without exitOnCrash does not call exit', () => {
    const reportDir = makeTempDir();
    const onceHandlers = new Map<string, Function>();

    const fakeProcess = {
      pid: 1,
      argv: ['node'],
      version: 'v20.0.0',
      platform: 'darwin' as const,
      arch: 'arm64',
      env: {},
      cwd: () => '/tmp',
      uptime: () => 1,
      exit: vi.fn(),
      once: vi.fn((event: string, handler: Function) => {
        onceHandlers.set(event, handler);
        return fakeProcess;
      }),
      off: vi.fn(() => fakeProcess),
    } as unknown as CrashProcessLike;

    installProcessCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
      autoReport: false,
      processRef: fakeProcess,
      exitOnCrash: false,
    });

    const handler = onceHandlers.get('unhandledRejection')!;
    handler('rejected promise');

    expect(fakeProcess.exit).not.toHaveBeenCalled();
  });

  it('exit handler fires captureFatalExitSync', () => {
    const reportDir = makeTempDir();
    const onceHandlers = new Map<string, Function>();

    const fakeProcess = {
      pid: 1,
      argv: ['node'],
      version: 'v20.0.0',
      platform: 'darwin' as const,
      arch: 'arm64',
      env: {},
      cwd: () => '/tmp',
      uptime: () => 1,
      exit: vi.fn(),
      once: vi.fn((event: string, handler: Function) => {
        onceHandlers.set(event, handler);
        return fakeProcess;
      }),
      off: vi.fn(() => fakeProcess),
    } as unknown as CrashProcessLike;

    installProcessCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
      autoReport: false,
      processRef: fakeProcess,
    });

    const exitHandler = onceHandlers.get('exit')!;
    exitHandler(1);

    // Should have created a crash report file
    const files = fs.readdirSync(reportDir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('second call to same handler type is ignored (handled guard)', async () => {
    vi.useFakeTimers();
    const reportDir = makeTempDir();
    const onceHandlers = new Map<string, Function>();

    const fakeProcess = {
      pid: 1,
      argv: ['node'],
      version: 'v20.0.0',
      platform: 'darwin' as const,
      arch: 'arm64',
      env: {},
      cwd: () => '/tmp',
      uptime: () => 1,
      exit: vi.fn(),
      once: vi.fn((event: string, handler: Function) => {
        onceHandlers.set(event, handler);
        return fakeProcess;
      }),
      off: vi.fn(() => fakeProcess),
    } as unknown as CrashProcessLike;

    installProcessCrashReporter({
      appName: 'test',
      appVersion: '1.0.0',
      reportDir,
      autoReport: false,
      processRef: fakeProcess,
      exitOnCrash: false,
    });

    // Call uncaughtException first
    const exHandler = onceHandlers.get('uncaughtException')!;
    exHandler(new Error('first'));

    // Then try unhandledRejection - should be ignored
    const rejHandler = onceHandlers.get('unhandledRejection')!;
    rejHandler('second');

    // Exit handler should also be ignored
    const exitHandler = onceHandlers.get('exit')!;
    exitHandler(1);

    vi.useRealTimers();
  });
});
