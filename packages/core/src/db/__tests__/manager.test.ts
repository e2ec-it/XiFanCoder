import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DatabaseManager } from '../manager.js';

describe('DatabaseManager', () => {
  it('applies migrations in ascending version order and records history', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-db-mgr-'));
    const migrationsDir = path.join(root, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });

    fs.writeFileSync(
      path.join(migrationsDir, '001_bootstrap.sql'),
      'CREATE TABLE IF NOT EXISTS t1(id INTEGER PRIMARY KEY);',
      'utf8',
    );
    fs.writeFileSync(
      path.join(migrationsDir, '002_extend.sql'),
      'ALTER TABLE t1 ADD COLUMN name TEXT;',
      'utf8',
    );

    const dbPath = path.join(root, 'sessions.db');
    const manager = new DatabaseManager({
      dbPath,
      migrationsDir,
      allowExternalDbPath: true,
      now: () => 1700000000000,
    });

    const first = manager.migrate();
    const second = manager.migrate();

    expect(first.map((item) => item.version)).toEqual([1, 2]);
    expect(second.map((item) => item.version)).toEqual([1, 2]);

    const db = manager.getConnection();
    const columns = db.prepare('PRAGMA table_info(t1)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('name');
    expect(
      db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get() as { c: number },
    ).toEqual({ c: 2 });

    manager.close();
  });

  it('uses default migrations to create core tables in memory database', () => {
    const manager = new DatabaseManager({ dbPath: ':memory:' });
    manager.migrate();
    const db = manager.getConnection();

    const hasSessions = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
      .get() as { name?: string } | undefined;
    const hasMessagesFts = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'")
      .get() as { name?: string } | undefined;

    expect(hasSessions?.name).toBe('sessions');
    expect(hasMessagesFts?.name).toBe('messages_fts');
    manager.close();
  });

  it('rolls back failed migration and keeps version history consistent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-db-mgr-rollback-'));
    const migrationsDir = path.join(root, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });

    fs.writeFileSync(
      path.join(migrationsDir, '001_base.sql'),
      'CREATE TABLE IF NOT EXISTS demo(id INTEGER PRIMARY KEY, value TEXT);',
      'utf8',
    );
    fs.writeFileSync(
      path.join(migrationsDir, '002_broken.sql'),
      'ALTER TABLE demo ADD COLUMN tag TEXT; SELECT * FROM non_existing_table;',
      'utf8',
    );

    const dbPath = path.join(root, 'sessions.db');
    const manager = new DatabaseManager({
      dbPath,
      migrationsDir,
      allowExternalDbPath: true,
    });

    expect(() => manager.migrate()).toThrowError();

    const db = manager.getConnection();
    const versions = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
      .all() as Array<{ version: number }>;
    expect(versions).toEqual([{ version: 1 }]);

    const columns = db.prepare('PRAGMA table_info(demo)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(['id', 'value']);

    manager.close();
  });

  it.skipIf(process.platform === 'win32')('enforces sqlite file mode 0600 for on-disk databases', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-db-mode-'));
    const dbPath = path.join(root, 'sessions.db');
    const manager = new DatabaseManager({
      dbPath,
      allowExternalDbPath: true,
    });

    manager.migrate();
    const mode = fs.statSync(dbPath).mode & 0o777;
    expect(mode).toBe(0o600);

    manager.close();
  });

  it('getDatabasePath returns the resolved path', () => {
    const manager = new DatabaseManager({ dbPath: ':memory:' });
    expect(manager.getDatabasePath()).toBe(':memory:');
    manager.close();
  });

  it('close is safe to call when no connection was opened', () => {
    const manager = new DatabaseManager({ dbPath: ':memory:' });
    // Should not throw
    manager.close();
    manager.close();
  });

  it('skips migration files with invalid name pattern', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-db-mgr-skip-'));
    const migrationsDir = path.join(root, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });

    fs.writeFileSync(
      path.join(migrationsDir, '001_bootstrap.sql'),
      'CREATE TABLE IF NOT EXISTS t1(id INTEGER PRIMARY KEY);',
      'utf8',
    );
    // Invalid migration file names
    fs.writeFileSync(path.join(migrationsDir, 'README.md'), '# docs', 'utf8');
    fs.writeFileSync(path.join(migrationsDir, 'not-a-migration.sql'), 'SELECT 1;', 'utf8');

    const dbPath = path.join(root, 'sessions.db');
    const manager = new DatabaseManager({
      dbPath,
      migrationsDir,
      allowExternalDbPath: true,
    });

    const records = manager.migrate();
    // Only the valid migration should be applied
    expect(records).toHaveLength(1);
    expect(records[0]?.version).toBe(1);

    manager.close();
  });

  it('rejects traversal/outside paths unless explicitly allowed', () => {
    expect(
      () =>
        new DatabaseManager({
          dbPath: '../escape.db',
        }),
    ).toThrowError('database path must stay under');

    expect(
      () =>
        new DatabaseManager({
          dbPath: path.join(os.tmpdir(), 'outside-sessions.db'),
        }),
    ).toThrowError('database path must stay under');
  });
});
