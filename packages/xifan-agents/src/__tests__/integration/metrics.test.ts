import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

import { collectMetrics } from '../../integration/metrics.js';
import { runMigration } from '../../db/migrate.js';

describe('collectMetrics', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();

    pool = new pg.Pool({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runMigration(pool);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it('returns zero metrics for empty database', async () => {
    const metrics = await collectMetrics(pool);
    expect(metrics.totalSessions).toBe(0);
    expect(metrics.completedSessions).toBe(0);
    expect(metrics.totalMemories).toBe(0);
    expect(metrics.avgQualityScore).toBe(0);
    expect(metrics.topSkills).toEqual([]);
  });

  it('counts sessions correctly after insert', async () => {
    await pool.query(`
      INSERT INTO xifan_obs.sessions (id, project, user_input, status, started_at, completed_at, rounds, tool_count)
      VALUES ('s1', 'proj', 'test', 'completed', 0, 1, 1, 2),
             ('s2', 'proj', 'test', 'max_rounds', 0, 1, 5, 10)
    `);
    const metrics = await collectMetrics(pool);
    expect(metrics.totalSessions).toBe(2);
    expect(metrics.completedSessions).toBe(1);
  });
});
