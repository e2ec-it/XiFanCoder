import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { sanitizeLogValue } from '../logger/sanitizer.js';

export type CrashTriggerKind = 'uncaughtException' | 'unhandledRejection' | 'fatalExit';
export type CrashDeliveryStatus = 'disabled' | 'sent' | 'queued';

export interface CrashErrorPayload {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export interface CrashRuntimeSnapshot {
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly pid: number;
  readonly cwd: string;
  readonly uptimeSec: number;
}

export interface CrashReport {
  readonly schemaVersion: '1.0';
  readonly reportId: string;
  readonly createdAt: string;
  readonly app: {
    readonly name: string;
    readonly version: string;
  };
  readonly trigger: {
    readonly kind: CrashTriggerKind;
    readonly error: CrashErrorPayload;
  };
  readonly runtime: CrashRuntimeSnapshot;
  readonly context: {
    readonly argv: readonly string[];
    readonly recentOperation?: unknown;
  };
  readonly delivery: {
    readonly enabled: boolean;
    readonly target?: string;
    readonly status: CrashDeliveryStatus;
  };
}

export interface CrashCaptureResult {
  readonly report: CrashReport;
  readonly reportPath: string;
  readonly deliveryStatus: CrashDeliveryStatus;
  readonly attempts: number;
  readonly pendingPath?: string;
}

export interface CrashReporterOptions {
  readonly appName: string;
  readonly appVersion: string;
  readonly reportDir?: string;
  readonly autoReport?: boolean;
  readonly reportEndpoint?: string;
  readonly maxSendRetries?: number;
  readonly initialRetryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly runtime?: CrashReporterRuntime;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly sendReport?: CrashReportSender;
}

export interface CrashCaptureOptions {
  readonly waitForDelivery?: boolean;
}

export interface CrashReporterRuntime {
  readonly pid: number;
  readonly argv: readonly string[];
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly env: NodeJS.ProcessEnv;
  cwd(): string;
  uptime(): number;
}

export interface CrashReportSender {
  (report: CrashReport, endpoint: string): Promise<void>;
}

export interface CrashReporter {
  setRecentContext(context: unknown): void;
  capture(
    kind: CrashTriggerKind,
    reason: unknown,
    options?: CrashCaptureOptions,
  ): Promise<CrashCaptureResult>;
  captureFatalExitSync(exitCode: number): CrashCaptureResult | undefined;
  flushPendingReports(): Promise<{
    readonly processed: number;
    readonly sent: number;
    readonly failed: number;
  }>;
}

export interface InstalledCrashReporter {
  setRecentContext(context: unknown): void;
  dispose(): void;
}

export interface CrashReporterEnvConfig {
  readonly autoReport: boolean;
  readonly reportEndpoint?: string;
  readonly reportDir?: string;
  readonly maxSendRetries?: number;
  readonly initialRetryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
}

interface DeliveryAttemptResult {
  readonly status: CrashDeliveryStatus;
  readonly attempts: number;
  readonly pendingPath?: string;
}

interface RetryResult {
  readonly ok: boolean;
  readonly attempts: number;
  readonly errorMessage?: string;
}

export interface CrashProcessLike {
  readonly pid: number;
  readonly argv: readonly string[];
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly env: NodeJS.ProcessEnv;
  readonly exitCode?: number;
  cwd(): string;
  uptime(): number;
  exit(code?: number): never;
  once(event: 'uncaughtException', listener: (error: Error) => void): this;
  once(event: 'unhandledRejection', listener: (reason: unknown) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
  off(event: 'uncaughtException', listener: (error: Error) => void): this;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): this;
  off(event: 'exit', listener: (code: number) => void): this;
}

const DEFAULT_REPORT_DIR = path.join(homedir(), '.xifan', 'coder', 'crashes');
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 5_000;

class CrashReporterImpl implements CrashReporter {
  private readonly appName: string;
  private readonly appVersion: string;
  private readonly reportDir: string;
  private readonly pendingDir: string;
  private readonly auditLogPath: string;
  private readonly autoReport: boolean;
  private readonly reportEndpoint?: string;
  private readonly maxSendRetries: number;
  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly runtime: CrashReporterRuntime;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly sendReport: CrashReportSender;

  private recentContext?: unknown;

  constructor(options: CrashReporterOptions) {
    this.appName = options.appName;
    this.appVersion = options.appVersion;
    this.reportDir = options.reportDir ?? DEFAULT_REPORT_DIR;
    this.pendingDir = path.join(this.reportDir, 'pending');
    this.auditLogPath = path.join(this.reportDir, 'delivery.log');
    this.autoReport = options.autoReport ?? false;
    this.reportEndpoint = options.reportEndpoint;
    this.maxSendRetries = Math.max(1, options.maxSendRetries ?? DEFAULT_RETRY_COUNT);
    this.initialRetryDelayMs = Math.max(0, options.initialRetryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    this.maxRetryDelayMs = Math.max(this.initialRetryDelayMs, options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS);
    this.runtime = options.runtime ?? process;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.sendReport = options.sendReport ?? defaultCrashReportSender;
  }

  setRecentContext(context: unknown): void {
    this.recentContext = sanitizeLogValue(context);
  }

  async capture(
    kind: CrashTriggerKind,
    reason: unknown,
    options: CrashCaptureOptions = {},
  ): Promise<CrashCaptureResult> {
    const report = this.createReport(kind, reason, this.autoReport ? 'queued' : 'disabled');
    const reportPath = this.writeReport(report);

    if (!this.canDeliver()) {
      this.appendAudit({
        reportId: report.reportId,
        status: 'disabled',
        attempts: 0,
      });
      return {
        report,
        reportPath,
        deliveryStatus: 'disabled',
        attempts: 0,
      };
    }

    if (options.waitForDelivery) {
      const delivery = await this.deliverOrQueue(report);
      return {
        report,
        reportPath,
        deliveryStatus: delivery.status,
        attempts: delivery.attempts,
        pendingPath: delivery.pendingPath,
      };
    }

    void this.deliverOrQueue(report);
    return {
      report,
      reportPath,
      deliveryStatus: 'queued',
      attempts: 0,
    };
  }

  captureFatalExitSync(exitCode: number): CrashCaptureResult | undefined {
    if (exitCode === 0) {
      return undefined;
    }

    const report = this.createReport(
      'fatalExit',
      new Error(`Process exited with code ${exitCode}`),
      this.canDeliver() ? 'queued' : 'disabled',
    );
    const reportPath = this.writeReport(report);
    if (!this.canDeliver()) {
      this.appendAudit({
        reportId: report.reportId,
        status: 'disabled',
        attempts: 0,
      });
      return {
        report,
        reportPath,
        deliveryStatus: 'disabled',
        attempts: 0,
      };
    }

    const pendingPath = this.writePendingReport(report);
    this.appendAudit({
      reportId: report.reportId,
      status: 'queued',
      attempts: 0,
      error: 'captured during process exit',
    });
    return {
      report,
      reportPath,
      deliveryStatus: 'queued',
      attempts: 0,
      pendingPath,
    };
  }

  async flushPendingReports(): Promise<{ readonly processed: number; readonly sent: number; readonly failed: number }> {
    if (!this.canDeliver()) {
      return {
        processed: 0,
        sent: 0,
        failed: 0,
      };
    }

    if (!fs.existsSync(this.pendingDir)) {
      return {
        processed: 0,
        sent: 0,
        failed: 0,
      };
    }

    let processed = 0;
    let sent = 0;
    let failed = 0;

    for (const fileName of fs.readdirSync(this.pendingDir)) {
      if (!fileName.endsWith('.json')) {
        continue;
      }
      processed += 1;
      const pendingPath = path.join(this.pendingDir, fileName);
      try {
        const payload = JSON.parse(fs.readFileSync(pendingPath, 'utf8')) as CrashReport;
        const delivery = await this.attemptDelivery(payload);
        if (delivery.status === 'sent') {
          fs.rmSync(pendingPath, { force: true });
          sent += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        failed += 1;
        this.appendAudit({
          reportId: fileName.replace(/\.json$/u, ''),
          status: 'queued',
          attempts: 0,
          error: `invalid pending report: ${toSafeErrorMessage(error)}`,
        });
      }
    }

    return {
      processed,
      sent,
      failed,
    };
  }

  private canDeliver(): boolean {
    return this.autoReport && Boolean(this.reportEndpoint);
  }

  private createReport(kind: CrashTriggerKind, reason: unknown, status: CrashDeliveryStatus): CrashReport {
    const timestamp = this.now().toISOString();
    const errorPayload = normalizeErrorPayload(reason);
    const runtimeSnapshot: CrashRuntimeSnapshot = {
      nodeVersion: this.runtime.version,
      platform: this.runtime.platform,
      arch: this.runtime.arch,
      pid: this.runtime.pid,
      cwd: this.runtime.cwd(),
      uptimeSec: Number(this.runtime.uptime().toFixed(3)),
    };

    return sanitizeLogValue({
      schemaVersion: '1.0',
      reportId: randomUUID(),
      createdAt: timestamp,
      app: {
        name: this.appName,
        version: this.appVersion,
      },
      trigger: {
        kind,
        error: errorPayload,
      },
      runtime: runtimeSnapshot,
      context: {
        argv: redactArgvSecrets([...this.runtime.argv]),
        ...(this.recentContext === undefined ? {} : { recentOperation: this.recentContext }),
      },
      delivery: {
        enabled: this.canDeliver(),
        ...(this.reportEndpoint ? { target: this.reportEndpoint } : {}),
        status,
      },
    }) as CrashReport;
  }

  private writeReport(report: CrashReport): string {
    const reportPath = path.join(this.reportDir, `${report.reportId}.json`);
    writeJsonFile(reportPath, report);
    return reportPath;
  }

  private writePendingReport(report: CrashReport): string {
    const pendingPath = path.join(this.pendingDir, `${report.reportId}.json`);
    writeJsonFile(pendingPath, report);
    return pendingPath;
  }

  private async deliverOrQueue(report: CrashReport): Promise<DeliveryAttemptResult> {
    const delivery = await this.attemptDelivery(report);
    if (delivery.status === 'sent') {
      return delivery;
    }
    const pendingPath = this.writePendingReport(report);
    return {
      ...delivery,
      pendingPath,
    };
  }

  private async attemptDelivery(report: CrashReport): Promise<DeliveryAttemptResult> {
    const target = this.reportEndpoint;
    /* v8 ignore next 6 -- defensive guard: callers check endpoint before calling */
    if (!target) {
      return {
        status: 'disabled',
        attempts: 0,
      };
    }

    const retried = await retryWithBackoff({
      attempts: this.maxSendRetries,
      initialDelayMs: this.initialRetryDelayMs,
      maxDelayMs: this.maxRetryDelayMs,
      sleep: this.sleep,
      run: async () => {
        await this.sendReport(report, target);
      },
    });

    if (retried.ok) {
      this.appendAudit({
        reportId: report.reportId,
        status: 'sent',
        attempts: retried.attempts,
      });
      return {
        status: 'sent',
        attempts: retried.attempts,
      };
    }

    this.appendAudit({
      reportId: report.reportId,
      status: 'queued',
      attempts: retried.attempts,
      error: retried.errorMessage,
    });
    return {
      status: 'queued',
      attempts: retried.attempts,
    };
  }

  private appendAudit(entry: {
    readonly reportId: string;
    readonly status: CrashDeliveryStatus;
    readonly attempts: number;
    readonly error?: string;
  }): void {
    const line = JSON.stringify(
      sanitizeLogValue({
        timestamp: this.now().toISOString(),
        reportId: entry.reportId,
        status: entry.status,
        attempts: entry.attempts,
        ...(entry.error ? { error: entry.error } : {}),
      }),
    );
    fs.mkdirSync(this.reportDir, { recursive: true });
    fs.appendFileSync(this.auditLogPath, `${line}\n`, 'utf8');
  }
}

export function createCrashReporter(options: CrashReporterOptions): CrashReporter {
  return new CrashReporterImpl(options);
}

export function installProcessCrashReporter(
  options: CrashReporterOptions & {
    readonly processRef?: CrashProcessLike;
    readonly exitOnCrash?: boolean;
  },
): InstalledCrashReporter {
  const processRef = options.processRef ?? process;
  const reporter = createCrashReporter({
    ...options,
    runtime: processRef,
  });
  void reporter.flushPendingReports();

  const exitOnCrash = options.exitOnCrash ?? true;
  let handled = false;

  const onUncaughtException = (error: Error): void => {
    /* v8 ignore next 3 -- re-entrancy guard for concurrent crash signals */
    if (handled) {
      return;
    }
    handled = true;
    void reporter.capture('uncaughtException', error);
    if (!exitOnCrash) {
      return;
    }
    setTimeout(() => {
      processRef.exit(1);
    }, 10);
  };

  const onUnhandledRejection = (reason: unknown): void => {
    if (handled) {
      return;
    }
    handled = true;
    void reporter.capture('unhandledRejection', reason);
    if (!exitOnCrash) {
      return;
    }
    setTimeout(() => {
      processRef.exit(1);
    }, 10);
  };

  const onExit = (code: number): void => {
    if (handled) {
      return;
    }
    reporter.captureFatalExitSync(code);
  };

  processRef.once('uncaughtException', onUncaughtException);
  processRef.once('unhandledRejection', onUnhandledRejection);
  processRef.once('exit', onExit);

  return {
    setRecentContext: (context: unknown): void => {
      reporter.setRecentContext(context);
    },
    dispose: (): void => {
      processRef.off('uncaughtException', onUncaughtException);
      processRef.off('unhandledRejection', onUnhandledRejection);
      processRef.off('exit', onExit);
    },
  };
}

export function parseCrashReporterEnv(env: NodeJS.ProcessEnv = process.env): CrashReporterEnvConfig {
  return {
    autoReport: parseBooleanEnv(env.XIFAN_CRASH_AUTO_REPORT) ?? false,
    reportEndpoint: env.XIFAN_CRASH_REPORT_ENDPOINT,
    reportDir: env.XIFAN_CRASH_REPORT_DIR,
    maxSendRetries: parseIntegerEnv(env.XIFAN_CRASH_REPORT_RETRIES),
    initialRetryDelayMs: parseIntegerEnv(env.XIFAN_CRASH_REPORT_RETRY_DELAY_MS),
    maxRetryDelayMs: parseIntegerEnv(env.XIFAN_CRASH_REPORT_RETRY_MAX_DELAY_MS),
  };
}

async function defaultCrashReportSender(report: CrashReport, endpoint: string): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': `${report.app.name}/${report.app.version}`,
    },
    body: JSON.stringify(report),
  });
  if (!response.ok) {
    throw new Error(`crash intake responded ${response.status}`);
  }
}

async function retryWithBackoff(options: {
  readonly attempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly run: () => Promise<void>;
}): Promise<RetryResult> {
  let delay = options.initialDelayMs;
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      await options.run();
      return {
        ok: true,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= options.attempts) {
        break;
      }
      if (delay > 0) {
        await options.sleep(delay);
      }
      delay = Math.min(options.maxDelayMs, Math.max(delay * 2, 1));
    }
  }

  return {
    ok: false,
    attempts: options.attempts,
    errorMessage: toSafeErrorMessage(lastError),
  };
}

const SENSITIVE_FLAGS = /^--(token|api-key|api_key|password|secret|credential)$/i;

function redactArgvSecrets(argv: string[]): string[] {
  const result = [...argv];
  for (let i = 0; i < result.length - 1; i++) {
    const flag = result[i];
    if (flag !== undefined && SENSITIVE_FLAGS.test(flag)) {
      result[i + 1] = '****';
    }
  }
  return result;
}

function normalizeErrorPayload(reason: unknown): CrashErrorPayload {
  if (reason instanceof Error) {
    return sanitizeLogValue({
      name: reason.name || 'Error',
      message: reason.message || 'unknown error',
      ...(reason.stack ? { stack: reason.stack } : {}),
    }) as CrashErrorPayload;
  }

  if (typeof reason === 'string') {
    return {
      name: 'Error',
      message: sanitizeLogValue(reason),
    };
  }

  if (reason && typeof reason === 'object') {
    const payload = reason as { name?: unknown; message?: unknown; stack?: unknown };
    return sanitizeLogValue({
      name: typeof payload.name === 'string' && payload.name ? payload.name : 'Error',
      message: typeof payload.message === 'string' && payload.message ? payload.message : toSafeErrorMessage(reason),
      ...(typeof payload.stack === 'string' ? { stack: payload.stack } : {}),
    }) as CrashErrorPayload;
  }

  return {
    name: 'Error',
    message: toSafeErrorMessage(reason),
  };
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return undefined;
}

function parseIntegerEnv(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function toSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeLogValue(error.message);
  }
  if (typeof error === 'string') {
    return sanitizeLogValue(error);
  }
  return sanitizeLogValue(String(error));
}
