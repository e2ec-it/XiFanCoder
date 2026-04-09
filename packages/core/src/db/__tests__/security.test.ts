import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  decryptJsonPayload,
  encryptJsonPayload,
  enforceDatabaseFilePermissions,
  isEncryptedPayload,
  resolveSecureDbPath,
} from '../security.js';

// Use platform-appropriate temp base for cross-platform tests
const tmpBase = path.join(os.tmpdir(), 'safe');

describe('resolveSecureDbPath', () => {
  it('returns default path when dbPath is not provided', () => {
    const result = resolveSecureDbPath({
      defaultFileName: 'sessions.db',
      baseDir: tmpBase,
    });
    expect(result).toBe(path.join(tmpBase, 'sessions.db'));
  });

  it('rejects path with null byte', () => {
    expect(() =>
      resolveSecureDbPath({
        dbPath: path.join(os.tmpdir(), 'test\0malicious.db'),
        defaultFileName: 'sessions.db',
      }),
    ).toThrowError('invalid null byte');
  });

  it('accepts :memory: as special path', () => {
    expect(
      resolveSecureDbPath({ dbPath: ':memory:', defaultFileName: 'sessions.db' }),
    ).toBe(':memory:');
  });

  it('rejects path outside base directory', () => {
    expect(() =>
      resolveSecureDbPath({
        dbPath: path.join(os.tmpdir(), 'outside.db'),
        defaultFileName: 'sessions.db',
        baseDir: tmpBase,
      }),
    ).toThrowError('database path must stay under');
  });

  it('accepts path inside base directory', () => {
    const result = resolveSecureDbPath({
      dbPath: 'sub/sessions.db',
      defaultFileName: 'sessions.db',
      baseDir: tmpBase,
    });
    expect(result).toContain(path.join(tmpBase, 'sub', 'sessions.db'));
  });

  it('accepts absolute path exactly equal to base directory', () => {
    const result = resolveSecureDbPath({
      dbPath: tmpBase,
      defaultFileName: 'sessions.db',
      baseDir: tmpBase,
    });
    expect(result).toBe(tmpBase);
  });

  it('accepts path equal to base directory file', () => {
    const expected = path.join(tmpBase, 'sessions.db');
    const result = resolveSecureDbPath({
      dbPath: expected,
      defaultFileName: 'sessions.db',
      baseDir: tmpBase,
    });
    expect(result).toBe(expected);
  });
});

describe('enforceDatabaseFilePermissions', () => {
  it('skips :memory: path silently', () => {
    // Should not throw
    enforceDatabaseFilePermissions(':memory:');
  });
});

describe('encryption helpers', () => {
  it('throws on empty encryption key', () => {
    expect(() => encryptJsonPayload('test', '')).toThrowError('non-empty');
    expect(() => encryptJsonPayload('test', '   ')).toThrowError('non-empty');
  });

  it('round-trips encrypt/decrypt', () => {
    const key = 'test-key-123';
    const plaintext = '{"hello":"world"}';
    const encrypted = encryptJsonPayload(plaintext, key);

    expect(isEncryptedPayload(encrypted)).toBe(true);
    expect(decryptJsonPayload(encrypted, key)).toBe(plaintext);
  });

  it('returns input when not encrypted', () => {
    expect(decryptJsonPayload('plain text', 'key')).toBe('plain text');
  });

  it('throws on invalid encrypted format (wrong part count)', () => {
    expect(() =>
      decryptJsonPayload('enc:v1:only-three-parts', 'key'),
    ).toThrowError('invalid encrypted payload format');
  });
});
