import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';

import { runMigration } from '../../db/migrate.js';
import { getMemory, saveMemory } from '../../memory/store.js';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigration(pool);
}, 60_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
});

describe('saveMemory + getMemory', () => {
  it('saves and retrieves episodic memory', async () => {
    const id = await saveMemory(pool, {
      type: 'episodic',
      summary: '修复 JWT 过期处理：在 middleware 捕获 TokenExpiredError',
      payload: { sessionId: 'sess-test', toolCount: 5 },
      project: '/workspace/myapp',
    });

    const mem = await getMemory(pool, id);
    expect(mem?.type).toBe('episodic');
    expect(mem?.summary).toContain('JWT');
  });
});
