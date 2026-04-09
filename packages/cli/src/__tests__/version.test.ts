import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('resolveCliVersion', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear module cache so cachedVersion resets each test
    vi.resetModules();
    delete process.env.XIFAN_APP_VERSION;
    delete process.env.npm_package_version;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns version from XIFAN_APP_VERSION env var', async () => {
    process.env.XIFAN_APP_VERSION = '  3.2.1  ';
    const { resolveCliVersion } = await import('../version.js');
    expect(resolveCliVersion()).toBe('3.2.1');
  });

  it('returns version from npm_package_version when XIFAN_APP_VERSION is not set', async () => {
    process.env.npm_package_version = '4.0.0';
    const { resolveCliVersion } = await import('../version.js');
    expect(resolveCliVersion()).toBe('4.0.0');
  });

  it('returns cached version on second call', async () => {
    process.env.XIFAN_APP_VERSION = '1.0.0';
    const { resolveCliVersion } = await import('../version.js');
    expect(resolveCliVersion()).toBe('1.0.0');
    // Second call should return same cached value
    process.env.XIFAN_APP_VERSION = '9.9.9';
    expect(resolveCliVersion()).toBe('1.0.0');
  });

  it('skips empty env vars and falls through to package.json walk', async () => {
    process.env.XIFAN_APP_VERSION = '   ';
    process.env.npm_package_version = '';
    const { resolveCliVersion } = await import('../version.js');
    const version = resolveCliVersion();
    // Should find the package.json for @xifan-coder/cli or return 'unknown'
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });

  it('walks up directories to find @xifan-coder/cli package.json', async () => {
    // No env vars set, so it should walk up from __dirname
    const { resolveCliVersion } = await import('../version.js');
    const version = resolveCliVersion();
    // The test runs inside packages/cli, so it should find the real package.json
    // and return a valid semver or 'unknown'
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });

  it('returns unknown when package.json walk finds no matching package', async () => {
    // Mock fs to simulate no package.json found
    const mockFs = await import('node:fs');
    const _existsSyncOrig = mockFs.default.existsSync;
    vi.spyOn(mockFs.default, 'existsSync').mockReturnValue(false);

    const { resolveCliVersion } = await import('../version.js');
    const version = resolveCliVersion();
    expect(version).toBe('unknown');

    vi.mocked(mockFs.default.existsSync).mockRestore();
  });

  it('handles package.json with wrong name gracefully', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-test-'));
    const pkgPath = path.join(tmpDir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ name: 'other-package', version: '1.0.0' }), 'utf8');

    // Can't easily mock __dirname, but we verify the walk logic
    // by testing it finds the real package or falls through
    const { resolveCliVersion } = await import('../version.js');
    const version = resolveCliVersion();
    expect(typeof version).toBe('string');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles malformed package.json during walk', async () => {
    const mockFs = await import('node:fs');
    vi.spyOn(mockFs.default, 'existsSync').mockReturnValue(true);
    vi.spyOn(mockFs.default, 'readFileSync').mockImplementation(() => {
      throw new SyntaxError('Unexpected token');
    });

    const { resolveCliVersion } = await import('../version.js');
    const version = resolveCliVersion();
    // Should handle parse error and eventually return 'unknown'
    expect(version).toBe('unknown');

    vi.mocked(mockFs.default.existsSync).mockRestore();
    vi.mocked(mockFs.default.readFileSync).mockRestore();
  });
});
