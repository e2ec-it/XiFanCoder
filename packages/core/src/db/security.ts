import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB_ENCRYPTION_SALT = 'xifan-db-message-content-v1';
const ENCRYPTED_PREFIX = 'enc:v1';

export interface ResolveDbPathOptions {
  readonly dbPath?: string;
  readonly defaultFileName: string;
  readonly baseDir?: string;
  readonly allowExternalDbPath?: boolean;
}

function getBaseDir(baseDir?: string): string {
  return path.resolve(baseDir ?? path.join(os.homedir(), '.xifan', 'coder'));
}

function isUnderBaseDir(candidate: string, baseDir: string): boolean {
  return candidate === baseDir || candidate.startsWith(`${baseDir}${path.sep}`);
}

function deriveAesKey(secret: string): Buffer {
  if (!secret.trim()) {
    throw new Error('database encryption key must be non-empty');
  }
  return scryptSync(secret, DB_ENCRYPTION_SALT, 32);
}

export function resolveSecureDbPath(options: ResolveDbPathOptions): string {
  const rawPath = options.dbPath;
  if (!rawPath) {
    return path.join(getBaseDir(options.baseDir), options.defaultFileName);
  }
  if (rawPath === ':memory:') {
    return ':memory:';
  }
  if (rawPath.includes('\0')) {
    throw new Error('database path contains invalid null byte');
  }

  const baseDir = getBaseDir(options.baseDir);
  const normalized = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(baseDir, rawPath);
  if (!options.allowExternalDbPath && !isUnderBaseDir(normalized, baseDir)) {
    throw new Error(`database path must stay under ${baseDir}`);
  }
  return normalized;
}

export function enforceDatabaseFilePermissions(dbPath: string): void {
  if (dbPath === ':memory:') {
    return;
  }
  try {
    fs.chmodSync(dbPath, 0o600);
  /* v8 ignore next 3 -- chmod failure on unsupported platforms */
  } catch {
    // Ignore unsupported chmod failures.
  }
}

export function isEncryptedPayload(input: string): boolean {
  return input.startsWith(`${ENCRYPTED_PREFIX}:`);
}

export function encryptJsonPayload(plaintext: string, secret: string): string {
  const key = deriveAesKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    ENCRYPTED_PREFIX,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptJsonPayload(payload: string, secret: string): string {
  if (!isEncryptedPayload(payload)) {
    return payload;
  }
  const parts = payload.split(':');
  if (parts.length !== 5) {
    throw new Error('invalid encrypted payload format');
  }

  const iv = Buffer.from(parts[2] ?? '', 'base64url');
  const authTag = Buffer.from(parts[3] ?? '', 'base64url');
  const encrypted = Buffer.from(parts[4] ?? '', 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', deriveAesKey(secret), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
