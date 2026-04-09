import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';

import { runMigration } from '../../db/migrate.js';
import { saveMemory } from '../../memory/store.js';
import { hybridSearch } from '../../memory/retriever.js';

// Mock embedder to avoid real LiteLLM call in tests
vi.mock('../../memory/embedder.js', () => ({
  embed: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
}));

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigration(pool);

  // Seed test data
  await saveMemory(pool, {
    type: 'episodic',
    summary: '修复 JWT 过期处理：在 middleware 捕获 TokenExpiredError',
    embedding: new Array(768).fill(0.1),
  });
  await saveMemory(pool, {
    type: 'procedural',
    summary: 'PostgreSQL 连接池耗尽处理：设置 max=10 + 超时回退',
    embedding: new Array(768).fill(0.2),
  });
}, 60_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
});

describe('hybridSearch', () => {
  it('returns results for JWT query', async () => {
    // Use terms that appear as separate tokens in the JWT summary (BM25 determinism)
    // 'JWT middleware' → both present in '修复 JWT 过期处理：在 middleware 捕获 TokenExpiredError'
    const results = await hybridSearch(pool, 'JWT middleware', { topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.summary).toContain('JWT');
  });
});
