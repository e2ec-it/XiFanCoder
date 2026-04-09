// packages/xifan-agents/src/db/migrate.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pool } from 'pg';

const __dir = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dir, '../../db/schema.sql');

export async function runMigration(pool: Pool): Promise<void> {
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  await pool.query(sql);
}
