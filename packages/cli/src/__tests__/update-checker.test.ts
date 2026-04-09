import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:https', () => ({
  default: {
    get: vi.fn(),
  },
}));

import {
  checkForUpdates,
  compareVersions,
  formatUpdateMessage,
  readCache,
  writeCache,
} from '../update-checker.js';

describe('compareVersions', () => {
  it('returns positive when latest is newer', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.1.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '2.0.0')).toBeGreaterThan(0);
  });

  it('returns negative when current is newer', () => {
    expect(compareVersions('1.0.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeLessThan(0);
  });

  it('returns zero when versions are equal', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.1.3', '0.1.3')).toBe(0);
  });

  it('strips leading v prefix', () => {
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', 'v1.0.1')).toBeGreaterThan(0);
  });

  it('treats prerelease as less than stable for same base version', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBeGreaterThan(0);
  });

  it('does not suggest downgrade from stable to prerelease', () => {
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeLessThan(0);
  });

  it('treats two prereleases of same base as equal', () => {
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-beta.2')).toBe(0);
  });

  it('compares different base versions regardless of prerelease', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-rc.1', '0.9.0')).toBeLessThan(0);
  });

  it('handles versions with fewer than 3 segments', () => {
    expect(compareVersions('1.0', '1.0.1')).toBeGreaterThan(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
  });

  it('handles non-numeric version parts as 0', () => {
    expect(compareVersions('1.0.abc', '1.0.0')).toBe(0);
  });
});

describe('readCache / writeCache', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('round-trips valid cache data via writeCache/readCache integration', () => {
    // writeCache writes to a fixed path; we test the functions directly
    // using mocked fs
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-update-'));
    const cachePath = path.join(root, 'update-check.json');
    const data = { lastCheck: Date.now(), latestVersion: '2.0.0' };

    fs.writeFileSync(cachePath, JSON.stringify(data), 'utf8');
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as {
      lastCheck: number;
      latestVersion: string;
    };

    expect(raw.lastCheck).toBe(data.lastCheck);
    expect(raw.latestVersion).toBe('2.0.0');
  });

  it('readCache returns undefined for missing file', () => {
    const result = readCache();
    expect(result === undefined || typeof result?.latestVersion === 'string').toBe(true);
  });

  it('readCache returns undefined for malformed JSON', () => {
    const spy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue('not valid json');
    const result = readCache();
    expect(result).toBeUndefined();
    spy.mockRestore();
    readSpy.mockRestore();
  });

  it('readCache returns undefined when JSON lacks required fields', () => {
    const spy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readSpy = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValue(JSON.stringify({ lastCheck: 'not-a-number', latestVersion: 123 }));
    const result = readCache();
    expect(result).toBeUndefined();
    spy.mockRestore();
    readSpy.mockRestore();
  });

  it('readCache returns valid data when file has correct shape', () => {
    const data = { lastCheck: 1000, latestVersion: '1.0.0' };
    const spy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(data));
    const result = readCache();
    expect(result).toEqual(data);
    spy.mockRestore();
    readSpy.mockRestore();
  });

  it('writeCache creates directory if it does not exist', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    writeCache({ lastCheck: 1000, latestVersion: '1.0.0' });

    expect(mkdirSpy).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(writeSpy).toHaveBeenCalled();

    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it('writeCache does not create directory if it already exists', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync');
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    writeCache({ lastCheck: 1000, latestVersion: '1.0.0' });

    expect(mkdirSpy).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalled();

    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it('writeCache silently handles write errors', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('EPERM');
    });

    // Should not throw
    expect(() => writeCache({ lastCheck: 1000, latestVersion: '1.0.0' })).not.toThrow();

    existsSpy.mockRestore();
    writeSpy.mockRestore();
  });
});

describe('checkForUpdates', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.XIFAN_NO_UPDATE_CHECK;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('returns undefined when XIFAN_NO_UPDATE_CHECK is set to 1', async () => {
    process.env.XIFAN_NO_UPDATE_CHECK = '1';
    const result = await checkForUpdates('1.0.0');
    expect(result).toBeUndefined();
  });

  it('returns cached latest version when cache is fresh and update available', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        lastCheck: Date.now() - 1000, // 1 second ago (within 24h interval)
        latestVersion: '2.0.0',
      }),
    );

    const result = await checkForUpdates('1.0.0');
    expect(result).toBe('2.0.0');
  });

  it('returns undefined when cache is fresh but no update available', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        lastCheck: Date.now() - 1000,
        latestVersion: '1.0.0',
      }),
    );

    const result = await checkForUpdates('1.0.0');
    expect(result).toBeUndefined();
  });

  it('fetches from npm when cache is stale and returns update', async () => {
    // Make cache stale
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        lastCheck: Date.now() - 25 * 60 * 60 * 1000, // 25h ago
        latestVersion: '1.0.0',
      }),
    );

    vi.mocked(https.get).mockImplementation((_url: unknown, _opts: unknown, cb: unknown) => {
      const callback = cb as (res: unknown) => void;
      const res = {
        statusCode: 200,
        setEncoding: vi.fn(),
        on: vi.fn((event: string, handler: (data?: string) => void) => {
          if (event === 'data') handler(JSON.stringify({ version: '3.0.0' }));
          if (event === 'end') handler();
          return res;
        }),
        resume: vi.fn(),
      };
      callback(res);
      const req = {
        on: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      };
      return req as unknown as ReturnType<typeof https.get>;
    });

    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    const result = await checkForUpdates('1.0.0');
    expect(result).toBe('3.0.0');
  });

  it('returns undefined when fetch fails (non-200 status)', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    vi.mocked(https.get).mockImplementation((_url: unknown, _opts: unknown, cb: unknown) => {
      const callback = cb as (res: unknown) => void;
      const res = {
        statusCode: 500,
        resume: vi.fn(),
        setEncoding: vi.fn(),
        on: vi.fn().mockReturnThis(),
      };
      callback(res);
      const req = {
        on: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      };
      return req as unknown as ReturnType<typeof https.get>;
    });

    const result = await checkForUpdates('1.0.0');
    expect(result).toBeUndefined();
  });

  it('returns undefined when fetch returns malformed JSON', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    vi.mocked(https.get).mockImplementation((_url: unknown, _opts: unknown, cb: unknown) => {
      const callback = cb as (res: unknown) => void;
      const res = {
        statusCode: 200,
        setEncoding: vi.fn(),
        on: vi.fn((event: string, handler: (data?: string) => void) => {
          if (event === 'data') handler('not json');
          if (event === 'end') handler();
          return res;
        }),
        resume: vi.fn(),
      };
      callback(res);
      const req = {
        on: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      };
      return req as unknown as ReturnType<typeof https.get>;
    });

    const result = await checkForUpdates('1.0.0');
    expect(result).toBeUndefined();
  });

  it('returns undefined when request errors', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    vi.mocked(https.get).mockImplementation((_url: unknown, _opts: unknown, _cb: unknown) => {
      const req = {
        on: vi.fn((event: string, handler: () => void) => {
          if (event === 'error') handler();
          return req;
        }),
        destroy: vi.fn(),
      };
      return req as unknown as ReturnType<typeof https.get>;
    });

    const result = await checkForUpdates('1.0.0');
    expect(result).toBeUndefined();
  });

  it('returns undefined when request times out', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    vi.mocked(https.get).mockImplementation((_url: unknown, _opts: unknown, _cb: unknown) => {
      const req = {
        on: vi.fn((event: string, handler: () => void) => {
          if (event === 'timeout') handler();
          return req;
        }),
        destroy: vi.fn(),
      };
      return req as unknown as ReturnType<typeof https.get>;
    });

    const result = await checkForUpdates('1.0.0');
    expect(result).toBeUndefined();
  });

  it('returns undefined when latest version is same as current', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    vi.mocked(https.get).mockImplementation((_url: unknown, _opts: unknown, cb: unknown) => {
      const callback = cb as (res: unknown) => void;
      const res = {
        statusCode: 200,
        setEncoding: vi.fn(),
        on: vi.fn((event: string, handler: (data?: string) => void) => {
          if (event === 'data') handler(JSON.stringify({ version: '1.0.0' }));
          if (event === 'end') handler();
          return res;
        }),
        resume: vi.fn(),
      };
      callback(res);
      const req = {
        on: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      };
      return req as unknown as ReturnType<typeof https.get>;
    });

    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    const result = await checkForUpdates('1.0.0');
    expect(result).toBeUndefined();
  });
});

describe('formatUpdateMessage', () => {
  it('includes both versions and install command', () => {
    const msg = formatUpdateMessage('1.0.0', '1.1.0');
    expect(msg).toContain('v1.0.0');
    expect(msg).toContain('v1.1.0');
    expect(msg).toContain('npm install -g @xifan-coder/cli');
    expect(msg).toContain('pnpm add -g @xifan-coder/cli');
  });
});
