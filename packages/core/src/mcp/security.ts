import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import selfsigned from 'selfsigned';

const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1'] as const;
const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  /^null$/i,
  /^https?:\/\/localhost(?::\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^https?:\/\/\[::1\](?::\d+)?$/i,
  /^file:\/\//i,
  /^vscode-file:\/\//i,
  /^vscode-webview:\/\//i,
] as const;

const DEFAULT_TLS_DIRECTORY = resolve(homedir(), '.xifan', 'coder', 'tls');
const DEFAULT_TLS_KEY_PATH = resolve(DEFAULT_TLS_DIRECTORY, 'mcp-dev.key.pem');
const DEFAULT_TLS_CERT_PATH = resolve(DEFAULT_TLS_DIRECTORY, 'mcp-dev.cert.pem');

export type MCPUpgradeFailureReason =
  | 'missing_token'
  | 'invalid_token'
  | 'invalid_host'
  | 'invalid_origin'
  | 'insecure_transport';

export type MCPAllowedOriginPattern = string | RegExp;

export interface MCPUpgradeSecurityPolicy {
  readonly expectedToken: string;
  readonly requireTls?: boolean;
  readonly allowMissingOrigin?: boolean;
  readonly allowedHosts?: readonly string[];
  readonly allowedOrigins?: readonly MCPAllowedOriginPattern[];
}

export interface ValidateMCPUpgradeInput {
  readonly headers: IncomingHttpHeaders;
  readonly url?: string;
  readonly isSecureTransport: boolean;
  readonly policy: MCPUpgradeSecurityPolicy;
}

export type ValidateMCPUpgradeResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: MCPUpgradeFailureReason;
      readonly statusCode: number;
    };

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  return value[0];
}

export function getHeaderValue(headers: IncomingHttpHeaders, key: string): string | undefined {
  const value = firstHeaderValue(headers[key.toLowerCase()]);
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeHost(rawHostHeader: string | undefined): string | undefined {
  if (!rawHostHeader) {
    return undefined;
  }
  const hostValue = rawHostHeader.trim();
  if (!hostValue || hostValue.includes(',')) {
    return undefined;
  }

  if (hostValue === '::1') {
    return '::1';
  }

  try {
    const parsed = new URL(`http://${hostValue}`);
    const hostname = parsed.hostname;
    /* v8 ignore next 3 -- defensive guard: URL always produces a hostname from Host header */
    if (!hostname) {
      return undefined;
    }
    const normalized = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
    return normalized.toLowerCase();
  } catch {
    return undefined;
  }
}

export function isHostAllowed(
  hostHeader: string | undefined,
  allowedHosts: readonly string[] = DEFAULT_ALLOWED_HOSTS,
): boolean {
  const normalizedHost = normalizeHost(hostHeader);
  if (!normalizedHost) {
    return false;
  }
  const allowed = new Set(
    allowedHosts.map((host) =>
      host.trim().replace(/^\[/, '').replace(/\]$/, '').toLowerCase(),
    ),
  );
  return allowed.has(normalizedHost);
}

export function isOriginAllowed(
  originHeader: string | undefined,
  options?: {
    readonly allowMissingOrigin?: boolean;
    readonly allowedOrigins?: readonly MCPAllowedOriginPattern[];
  },
): boolean {
  const allowMissingOrigin = options?.allowMissingOrigin ?? true;
  const allowedOrigins = options?.allowedOrigins ?? DEFAULT_ALLOWED_ORIGIN_PATTERNS;
  if (originHeader === undefined) {
    return allowMissingOrigin;
  }

  const normalized = originHeader.trim();
  if (!normalized) {
    return false;
  }

  return allowedOrigins.some((item) => {
    if (typeof item === 'string') {
      return item.toLowerCase() === normalized.toLowerCase();
    }
    return item.test(normalized);
  });
}

export function isTokenAuthorized(providedToken: string, expectedToken: string): boolean {
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}

function isHttpWhitespace(charCode: number): boolean {
  return (
    charCode === 0x20 ||
    charCode === 0x09 ||
    charCode === 0x0a ||
    charCode === 0x0d
  );
}

function extractBearerToken(authHeader: string): string | undefined {
  const normalized = authHeader.trim();
  if (normalized.length <= 6 || normalized.slice(0, 6).toLowerCase() !== 'bearer') {
    return undefined;
  }

  let cursor = 6;
  let hasWhitespace = false;
  while (cursor < normalized.length && isHttpWhitespace(normalized.charCodeAt(cursor))) {
    hasWhitespace = true;
    cursor += 1;
  }
  if (!hasWhitespace) {
    return undefined;
  }
  const token = normalized.slice(cursor).trim();
  return token || undefined;
}

export function extractTokenFromRequest(headers: IncomingHttpHeaders, url?: string): string | undefined {
  const tokenHeader = getHeaderValue(headers, 'x-xifan-token');
  if (tokenHeader) {
    return tokenHeader;
  }

  const authHeader = getHeaderValue(headers, 'authorization');
  if (authHeader) {
    const bearerToken = extractBearerToken(authHeader);
    if (bearerToken) {
      return bearerToken;
    }
  }

  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url, 'http://localhost');
    const queryToken = parsed.searchParams.get('token');
    return queryToken?.trim() || undefined;
  /* v8 ignore next 3 -- defensive guard: URL constructor on valid req.url */
  } catch {
    return undefined;
  }
}

function mapReasonToStatusCode(reason: MCPUpgradeFailureReason): number {
  switch (reason) {
    case 'missing_token':
    case 'invalid_token':
      return 401;
    case 'invalid_host':
    case 'invalid_origin':
      return 403;
    case 'insecure_transport':
      return 426;
    /* v8 ignore next 2 -- exhaustive switch: all MCPUpgradeFailureReason values covered */
    default:
      return 400;
  }
}

function failed(reason: MCPUpgradeFailureReason): ValidateMCPUpgradeResult {
  return {
    ok: false,
    reason,
    statusCode: mapReasonToStatusCode(reason),
  };
}

export function validateMCPUpgradeRequest(input: ValidateMCPUpgradeInput): ValidateMCPUpgradeResult {
  const requireTls = input.policy.requireTls ?? false;
  if (requireTls && !input.isSecureTransport) {
    return failed('insecure_transport');
  }

  const hostHeader = getHeaderValue(input.headers, 'host');
  if (!isHostAllowed(hostHeader, input.policy.allowedHosts)) {
    return failed('invalid_host');
  }

  const originHeader = getHeaderValue(input.headers, 'origin');
  if (
    !isOriginAllowed(originHeader, {
      allowMissingOrigin: input.policy.allowMissingOrigin,
      allowedOrigins: input.policy.allowedOrigins,
    })
  ) {
    return failed('invalid_origin');
  }

  const token = extractTokenFromRequest(input.headers, input.url);
  if (!token) {
    return failed('missing_token');
  }
  if (!isTokenAuthorized(token, input.policy.expectedToken)) {
    return failed('invalid_token');
  }

  return { ok: true };
}

export function generateSessionToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function getDefaultSessionTokenPath(): string {
  return resolve(homedir(), '.xifan', 'coder', 'session.token');
}

export function getDefaultMcpTlsKeyPath(): string {
  return DEFAULT_TLS_KEY_PATH;
}

export function getDefaultMcpTlsCertPath(): string {
  return DEFAULT_TLS_CERT_PATH;
}

export async function persistSessionToken(token: string, tokenPath = getDefaultSessionTokenPath()): Promise<string> {
  const resolvedPath = resolve(tokenPath);
  await mkdir(dirname(resolvedPath), { recursive: true, mode: 0o700 });
  await writeFile(resolvedPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  return resolvedPath;
}

export async function readSessionToken(tokenPath = getDefaultSessionTokenPath()): Promise<string> {
  return (await readFile(resolve(tokenPath), 'utf8')).trim();
}

async function fileHasContent(path: string): Promise<boolean> {
  try {
    return (await readFile(path, 'utf8')).trim().length > 0;
  } catch {
    return false;
  }
}

export interface EnsureTlsCertificateOptions {
  readonly keyPath?: string;
  readonly certPath?: string;
  readonly commonName?: string;
  readonly daysValid?: number;
}

export interface EnsureTlsCertificateResult {
  readonly keyPath: string;
  readonly certPath: string;
  readonly generated: boolean;
}

export async function ensureLocalhostTlsCertificate(
  options: EnsureTlsCertificateOptions = {},
): Promise<EnsureTlsCertificateResult> {
  const keyPath = resolve(options.keyPath ?? getDefaultMcpTlsKeyPath());
  const certPath = resolve(options.certPath ?? getDefaultMcpTlsCertPath());

  const keyReady = await fileHasContent(keyPath);
  const certReady = await fileHasContent(certPath);
  if (keyReady && certReady) {
    return {
      keyPath,
      certPath,
      generated: false,
    };
  }

  const commonName = options.commonName ?? 'localhost';
  const daysValid = Math.max(1, Math.floor(options.daysValid ?? 365));
  const pems = selfsigned.generate(
    [{ name: 'commonName', value: commonName }],
    {
      algorithm: 'sha256',
      keySize: 2048,
      days: daysValid,
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '::1' },
          ],
        },
      ],
    },
  );

  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
  await mkdir(dirname(certPath), { recursive: true, mode: 0o700 });
  await writeFile(keyPath, pems.private, { encoding: 'utf8', mode: 0o600 });
  await writeFile(certPath, pems.cert, { encoding: 'utf8', mode: 0o644 });

  return {
    keyPath,
    certPath,
    generated: true,
  };
}

export class ConnectionLimiter {
  private current = 0;
  private readonly maxConnections: number;

  constructor(maxConnections = 10) {
    this.maxConnections = Math.max(1, Math.floor(maxConnections));
  }

  get activeConnections(): number {
    return this.current;
  }

  get limit(): number {
    return this.maxConnections;
  }

  tryAcquire(): boolean {
    if (this.current >= this.maxConnections) {
      return false;
    }
    this.current += 1;
    return true;
  }

  release(): void {
    if (this.current > 0) {
      this.current -= 1;
    }
  }
}
