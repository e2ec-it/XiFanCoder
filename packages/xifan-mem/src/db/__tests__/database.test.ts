import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemoryDatabaseManager } from '../database.js';

describe('MemoryDatabaseManager', () => {
  it('applies initial migration and creates memory schema tables', () => {
    const manager = new MemoryDatabaseManager({ dbPath: ':memory:' });
    const applied = manager.migrate();
    expect(applied.length).toBeGreaterThan(0);

    const db = manager.getConnection();
    const tableNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name ASC")
      .all() as Array<{ name: string }>;
    const names = tableNames.map((entry) => entry.name);

    expect(names).toContain('mem_sessions');
    expect(names).toContain('observations');
    expect(names).toContain('observations_fts');
    expect(names).toContain('session_summaries');
    expect(names).toContain('user_prompts');
    expect(names).toContain('user_prompts_fts');
    expect(names).toContain('pending_queue');
    expect(names).toContain('schema_migrations');

    manager.close();
  });

  it('is idempotent and records migration history once', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mem-migrations-'));
    const dbPath = path.join(root, 'memory.db');
    const manager = new MemoryDatabaseManager({ dbPath, allowExternalDbPath: true });

    const first = manager.migrate();
    const second = manager.migrate();

    expect(first.map((item) => item.version)).toEqual([1]);
    expect(second.map((item) => item.version)).toEqual([1]);

    const count = manager
      .getConnection()
      .prepare('SELECT COUNT(*) AS c FROM schema_migrations')
      .get() as { c: number };
    expect(count.c).toBe(1);

    manager.close();
  });

  it.skipIf(process.platform === 'win32')('creates sqlite file with owner-only permissions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mem-perm-'));
    const dbPath = path.join(root, 'memory.db');
    const manager = new MemoryDatabaseManager({ dbPath, allowExternalDbPath: true });
    manager.migrate();
    manager.close();

    const mode = fs.statSync(dbPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
