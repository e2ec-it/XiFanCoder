import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import {
  enforceDatabaseFilePermissions,
  resolveSecureDbPath,
} from './security.js';

export interface MigrationRecord {
  readonly version: number;
  readonly name: string;
  readonly appliedAt: number;
}

export interface DatabaseManagerOptions {
  readonly dbPath?: string;
  readonly migrationsDir?: string;
  readonly now?: () => number;
  readonly baseDir?: string;
  readonly allowExternalDbPath?: boolean;
}

interface MigrationFile {
  readonly version: number;
  readonly name: string;
  readonly filename: string;
  readonly fullPath: string;
}

const MIGRATION_FILENAME_PATTERN = /^(\d+)_([a-zA-Z0-9_.-]+)\.sql$/;

function resolveDefaultDbPath(): string {
  return path.join(os.homedir(), '.xifan', 'coder', 'sessions.db');
}

/* v8 ignore start -- module-resolution fallback depends on build layout */
function resolveDefaultMigrationsDir(): string {
  const moduleDir =
    typeof __dirname === 'string'
      ? __dirname
      : fileURLToPath(new URL('.', import.meta.url));

  const bundledDir = path.join(moduleDir, 'migrations');
  if (fs.existsSync(bundledDir)) {
    return bundledDir;
  }

  // Fallback for dist builds where SQL migrations are not copied.
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

function parseMigrationFile(migrationsDir: string, filename: string): MigrationFile | undefined {
  const match = MIGRATION_FILENAME_PATTERN.exec(filename);
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

export class DatabaseManager {
  private readonly dbPath: string;
  private readonly migrationsDir: string;
  private readonly now: () => number;
  private db?: Database.Database;

  constructor(options: DatabaseManagerOptions = {}) {
    this.dbPath = resolveSecureDbPath({
      dbPath: options.dbPath,
      defaultFileName: path.basename(resolveDefaultDbPath()),
      baseDir: options.baseDir,
      allowExternalDbPath: options.allowExternalDbPath,
    });
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
    enforceDatabaseFilePermissions(this.dbPath);
    this.applyPragmas(db);
    this.db = db;
    return db;
  }

  migrate(): readonly MigrationRecord[] {
    const db = this.getConnection();
    const migrationFiles = this.loadMigrationFiles();

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    const appliedRows = db
      .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC')
      .all() as Array<{ version: number; name: string; applied_at: number }>;
    const appliedVersions = new Set(appliedRows.map((row) => row.version));

    const insertMigration = db.prepare(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (@version, @name, @appliedAt)
    `);

    for (const migration of migrationFiles) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      const sql = fs.readFileSync(migration.fullPath, 'utf8');
      const appliedAt = this.now();
      const transaction = db.transaction(() => {
        db.exec(sql);
        insertMigration.run({
          version: migration.version,
          name: migration.name,
          appliedAt,
        });
      });
      transaction();
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
    const files = entries
      .map((filename) => parseMigrationFile(this.migrationsDir, filename))
      .filter((file): file is MigrationFile => file !== undefined)
      .sort((left, right) => left.version - right.version || left.filename.localeCompare(right.filename));
    return files;
  }
}
