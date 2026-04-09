import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ConnectionLimiter,
  ensureLocalhostTlsCertificate,
  extractTokenFromRequest,
  getDefaultMcpTlsCertPath,
  getDefaultMcpTlsKeyPath,
  getDefaultSessionTokenPath,
  generateSessionToken,
  getHeaderValue,
  isHostAllowed,
  isOriginAllowed,
  isTokenAuthorized,
  persistSessionToken,
  readSessionToken,
  validateMCPUpgradeRequest,
} from '../security.js';

describe('mcp security', () => {
  it('validates localhost host headers and blocks remote hosts', () => {
    expect(isHostAllowed('localhost:7890')).toBe(true);
    expect(isHostAllowed('127.0.0.1:7890')).toBe(true);
    expect(isHostAllowed('[::1]:7890')).toBe(true);
    expect(isHostAllowed('evil.example.com:7890')).toBe(false);
  });

  it('allows local origins and blocks non-whitelisted origins', () => {
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed('null')).toBe(true);
    expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    expect(isOriginAllowed('https://127.0.0.1:3000')).toBe(true);
    expect(isOriginAllowed('https://evil.example.com')).toBe(false);
  });

  it('extracts token from x-xifan-token, bearer auth, and query param', () => {
    expect(
      extractTokenFromRequest({
        'x-xifan-token': 'header-token',
      }),
    ).toBe('header-token');

    expect(
      extractTokenFromRequest({
        authorization: 'Bearer bearer-token',
      }),
    ).toBe('bearer-token');

    expect(
      extractTokenFromRequest(
        {
          host: '127.0.0.1:7890',
        },
        '/mcp?token=query-token',
      ),
    ).toBe('query-token');
  });

  it('uses timing-safe token compare semantics', () => {
    expect(isTokenAuthorized('same-token', 'same-token')).toBe(true);
    expect(isTokenAuthorized('same-token', 'other-token')).toBe(false);
    expect(isTokenAuthorized('short', 'longer')).toBe(false);
  });

  it('validates upgrade requests and returns specific failures', () => {
    const success = validateMCPUpgradeRequest({
      headers: {
        host: '127.0.0.1:7890',
        origin: 'null',
        'x-xifan-token': 'secret',
      },
      url: '/mcp',
      isSecureTransport: false,
      policy: {
        expectedToken: 'secret',
      },
    });
    expect(success).toEqual({ ok: true });

    const missingToken = validateMCPUpgradeRequest({
      headers: {
        host: '127.0.0.1:7890',
        origin: 'null',
      },
      url: '/mcp',
      isSecureTransport: false,
      policy: {
        expectedToken: 'secret',
      },
    });
    expect(missingToken).toMatchObject({ ok: false, reason: 'missing_token', statusCode: 401 });

    const invalidOrigin = validateMCPUpgradeRequest({
      headers: {
        host: '127.0.0.1:7890',
        origin: 'https://evil.example.com',
        'x-xifan-token': 'secret',
      },
      url: '/mcp',
      isSecureTransport: false,
      policy: {
        expectedToken: 'secret',
      },
    });
    expect(invalidOrigin).toMatchObject({ ok: false, reason: 'invalid_origin', statusCode: 403 });

    const invalidToken = validateMCPUpgradeRequest({
      headers: {
        host: '127.0.0.1:7890',
        origin: 'null',
        'x-xifan-token': 'wrong-secret',
      },
      url: '/mcp',
      isSecureTransport: false,
      policy: {
        expectedToken: 'secret',
      },
    });
    expect(invalidToken).toMatchObject({ ok: false, reason: 'invalid_token', statusCode: 401 });

    const invalidHost = validateMCPUpgradeRequest({
      headers: {
        host: '0.0.0.0:7890',
        origin: 'null',
        'x-xifan-token': 'secret',
      },
      url: '/mcp',
      isSecureTransport: false,
      policy: {
        expectedToken: 'secret',
      },
    });
    expect(invalidHost).toMatchObject({ ok: false, reason: 'invalid_host', statusCode: 403 });

    const insecureTransport = validateMCPUpgradeRequest({
      headers: {
        host: '127.0.0.1:7890',
        origin: 'null',
        'x-xifan-token': 'secret',
      },
      url: '/mcp',
      isSecureTransport: false,
      policy: {
        expectedToken: 'secret',
        requireTls: true,
      },
    });
    expect(insecureTransport).toMatchObject({
      ok: false,
      reason: 'insecure_transport',
      statusCode: 426,
    });
  });

  it('creates and reads session token file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xifan-mcp-token-'));
    const tokenPath = join(dir, 'session.token');
    const token = generateSessionToken();

    await persistSessionToken(token, tokenPath);
    await expect(readSessionToken(tokenPath)).resolves.toBe(token);
  });

  it('creates localhost tls certificate pair and reuses existing files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xifan-mcp-tls-'));
    const keyPath = join(dir, 'dev.key.pem');
    const certPath = join(dir, 'dev.cert.pem');

    const first = await ensureLocalhostTlsCertificate({
      keyPath,
      certPath,
    });
    expect(first.generated).toBe(true);
    expect(first.keyPath).toBe(keyPath);
    expect(first.certPath).toBe(certPath);

    const cert = await readFile(certPath, 'utf8');
    expect(cert).toContain('BEGIN CERTIFICATE');

    const second = await ensureLocalhostTlsCertificate({
      keyPath,
      certPath,
    });
    expect(second.generated).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('returns stable default tls paths', () => {
    expect(getDefaultMcpTlsKeyPath()).toContain('.xifan/coder/tls/mcp-dev.key.pem');
    expect(getDefaultMcpTlsCertPath()).toContain('.xifan/coder/tls/mcp-dev.cert.pem');
  });

  it('getHeaderValue returns undefined for missing, empty, whitespace-only headers', () => {
    expect(getHeaderValue({}, 'x-custom')).toBeUndefined();
    expect(getHeaderValue({ 'x-custom': '' }, 'x-custom')).toBeUndefined();
    expect(getHeaderValue({ 'x-custom': '  ' }, 'x-custom')).toBeUndefined();
  });

  it('getHeaderValue handles array header values', () => {
    expect(getHeaderValue({ 'x-custom': ['first', 'second'] }, 'x-custom')).toBe('first');
  });

  it('normalizeHost handles edge cases for host headers', () => {
    expect(isHostAllowed(undefined)).toBe(false);
    expect(isHostAllowed('')).toBe(false);
    expect(isHostAllowed('  ')).toBe(false);
    expect(isHostAllowed('host1, host2')).toBe(false); // comma-separated
    expect(isHostAllowed('::1')).toBe(true); // bare IPv6
  });

  it('isOriginAllowed rejects empty-string origin', () => {
    expect(isOriginAllowed('')).toBe(false);
    expect(isOriginAllowed('   ')).toBe(false);
  });

  it('isOriginAllowed supports string patterns in allowedOrigins', () => {
    expect(
      isOriginAllowed('https://myapp.com', {
        allowedOrigins: ['https://myapp.com'],
      }),
    ).toBe(true);
    expect(
      isOriginAllowed('https://other.com', {
        allowedOrigins: ['https://myapp.com'],
      }),
    ).toBe(false);
  });

  it('isOriginAllowed denies missing origin when allowMissingOrigin is false', () => {
    expect(
      isOriginAllowed(undefined, { allowMissingOrigin: false }),
    ).toBe(false);
  });

  it('extractBearerToken handles edge cases', () => {
    // Not a bearer token
    expect(extractTokenFromRequest({ authorization: 'Basic abc123' })).toBeUndefined();
    // Bearer without whitespace
    expect(extractTokenFromRequest({ authorization: 'BearerNoSpace' })).toBeUndefined();
    // Bearer with empty token after whitespace
    expect(extractTokenFromRequest({ authorization: 'Bearer   ' })).toBeUndefined();
  });

  it('extractTokenFromRequest returns undefined for no headers and no url', () => {
    expect(extractTokenFromRequest({})).toBeUndefined();
  });

  it('extractTokenFromRequest returns undefined for invalid URL', () => {
    expect(extractTokenFromRequest({}, '://invalid')).toBeUndefined();
  });

  it('extractTokenFromRequest returns undefined when query token is empty', () => {
    expect(extractTokenFromRequest({}, '/path?token=')).toBeUndefined();
  });

  it('getDefaultSessionTokenPath returns a path containing .xifan', () => {
    const tokenPath = getDefaultSessionTokenPath();
    expect(tokenPath).toContain('.xifan');
    expect(tokenPath).toContain('session.token');
  });

  it('ConnectionLimiter release does not go below zero', () => {
    const limiter = new ConnectionLimiter(2);
    limiter.release(); // Already at 0
    expect(limiter.activeConnections).toBe(0);
  });

  it('ConnectionLimiter exposes limit property', () => {
    const limiter = new ConnectionLimiter(5);
    expect(limiter.limit).toBe(5);
  });

  it('ConnectionLimiter floors to minimum 1', () => {
    const limiter = new ConnectionLimiter(0);
    expect(limiter.limit).toBe(1);
  });

  it('normalizeHost returns undefined for URL-unparseable host', () => {
    // A host value that URL constructor fails on
    expect(isHostAllowed('[invalid')).toBe(false);
    // Empty hostname after parse attempt
    expect(isHostAllowed(':8080')).toBe(false);
  });

  it('isHostAllowed with custom hosts list', () => {
    expect(isHostAllowed('myhost:8080', ['myhost'])).toBe(true);
    expect(isHostAllowed('otherhost:8080', ['myhost'])).toBe(false);
  });

  it('enforces connection limits', () => {
    const limiter = new ConnectionLimiter(2);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    limiter.release();
    expect(limiter.activeConnections).toBe(1);
    expect(limiter.tryAcquire()).toBe(true);
  });
});
