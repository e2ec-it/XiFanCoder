// packages/xifan-agents/src/__tests__/db/migrate.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigration } from '../../db/migrate.js';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
}, 60_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
});

describe('runMigration', () => {
  it('creates xifan_obs schema and tables', async () => {
    await runMigration(pool);
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'xifan_obs' ORDER BY table_name`
    );
    expect(rows.map((r: { table_name: string }) => r.table_name)).toEqual(['events', 'sessions']);
  });

  it('is idempotent - runs twice without error', async () => {
    await expect(runMigration(pool)).resolves.not.toThrow();
  });

  it('creates xifan_mem schema with pgvector extension', async () => {
    await runMigration(pool);
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'xifan_mem' ORDER BY table_name`
    );
    expect(rows.map((r: { table_name: string }) => r.table_name)).toContain('memories');
  });
});
