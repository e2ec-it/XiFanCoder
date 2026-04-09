import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

export interface MemoryMigrationRecord {
  readonly version: number;
  readonly name: string;
  readonly appliedAt: number;
}

export interface MemoryDatabaseOptions {
  readonly dbPath?: string;
  readonly migrationsDir?: string;
  readonly now?: () => number;
  readonly allowExternalDbPath?: boolean;
}

interface MigrationFile {
  readonly version: number;
  readonly name: string;
  readonly filename: string;
  readonly fullPath: string;
}

const MIGRATION_FILE_PATTERN = /^(\d+)_([a-zA-Z0-9_.-]+)\.sql$/;

/* v8 ignore next 3 -- default path resolution uses homedir; tests always override dbPath */
function resolveDefaultDbPath(): string {
  return path.join(os.homedir(), '.xifan', 'coder', 'memory.db');
}

/* v8 ignore start -- migration dir resolution depends on build layout; tests always override migrationsDir */
function resolveDefaultMigrationsDir(): string {
  const moduleDir =
    typeof __dirname === 'string'
      ? __dirname
      : fileURLToPath(new URL('.', import.meta.url));
  const bundledDir = path.join(moduleDir, 'migrations');
  if (fs.existsSync(bundledDir)) {
    return bundledDir;
  }

  const sourceDir = path.resolve(moduleDir, '../src/db/migrations');
  if (fs.existsSync(sourceDir)) {
    return sourceDir;
  }

  return bundledDir;
}
/* v8 ignore stop */

function ensureParentDir(dbPath: string): void {
  if (dbPath === ':memory:') {
    return;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

function enforceDbFilePermissions(dbPath: string): void {
  if (dbPath === ':memory:') {
    return;
  }
  try {
    fs.chmodSync(dbPath, 0o600);
  } catch {
    /* v8 ignore next 2 -- platform-dependent: chmod may not be supported */
    // Ignore permission adjustment failures on unsupported platforms.
  }
}

function parseMigrationFile(migrationsDir: string, filename: string): MigrationFile | undefined {
  const match = MIGRATION_FILE_PATTERN.exec(filename);
  /* v8 ignore next 3 -- filters non-migration files (e.g. .DS_Store) */
  if (!match) {
    return undefined;
  }
  return {
    version: Number(match[1]),
    name: match[2] ?? 'migration',
    filename,
    fullPath: path.join(migrationsDir, filename),
  };
}

export class MemoryDatabaseManager {
  private readonly dbPath: string;
  private readonly migrationsDir: string;
  private readonly now: () => number;
  private db?: Database.Database;

  constructor(options: MemoryDatabaseOptions = {}) {
    const requestedPath = options.dbPath ?? resolveDefaultDbPath();
    if (!options.allowExternalDbPath && requestedPath !== ':memory:') {
      const xifanRoot = path.join(os.homedir(), '.xifan', 'coder');
      if (!path.resolve(requestedPath).startsWith(xifanRoot)) {
        throw new Error(`Database path must be under ${xifanRoot}, got: ${requestedPath}`);
      }
    }
    this.dbPath = requestedPath;
    this.migrationsDir = options.migrationsDir ?? resolveDefaultMigrationsDir();
    this.now = options.now ?? (() => Date.now());
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  getConnection(): Database.Database {
    if (this.db) {
      return this.db;
    }

    ensureParentDir(this.dbPath);
    const db = new Database(this.dbPath);
    enforceDbFilePermissions(this.dbPath);
    this.applyPragmas(db);
    this.db = db;
    return db;
  }

  migrate(): readonly MemoryMigrationRecord[] {
    const db = this.getConnection();
    const migrations = this.loadMigrationFiles();

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    const applied = db
      .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC')
      .all() as Array<{ version: number; name: string; applied_at: number }>;
    const appliedVersions = new Set(applied.map((entry) => entry.version));

    const insert = db.prepare(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (@version, @name, @appliedAt)
    `);

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      const sql = fs.readFileSync(migration.fullPath, 'utf8');
      const appliedAt = this.now();
      const tx = db.transaction(() => {
        db.exec(sql);
        insert.run({
          version: migration.version,
          name: migration.name,
          appliedAt,
        });
      });
      tx();
    }

    const rows = db
      .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC')
      .all() as Array<{ version: number; name: string; applied_at: number }>;
    return rows.map((row) => ({
      version: row.version,
      name: row.name,
      appliedAt: row.applied_at,
    }));
  }

  close(): void {
    if (!this.db) {
      return;
    }
    this.db.close();
    this.db = undefined;
  }

  private applyPragmas(db: Database.Database): void {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }

  private loadMigrationFiles(): readonly MigrationFile[] {
    const entries = fs.readdirSync(this.migrationsDir);
    return entries
      .map((entry) => parseMigrationFile(this.migrationsDir, entry))
      .filter((entry): entry is MigrationFile => entry !== undefined)
      .sort((left, right) => left.version - right.version || left.filename.localeCompare(right.filename));
  }
}
