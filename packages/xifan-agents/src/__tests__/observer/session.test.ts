// packages/xifan-agents/src/__tests__/observer/session.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigration } from '../../db/migrate.js';
import { startSession, endSession } from '../../observer/session.js';
import { recordEvent, flushQueue } from '../../observer/event-store.js';
import { getReplay } from '../../observer/replay.js';

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

describe('session lifecycle', () => {
  it('creates and ends session', async () => {
    const sessionId = await startSession(pool, {
      project: '/test',
      userInput: 'fix bug',
      model: 'qwen2.5-coder-32b',
    });
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    recordEvent(pool, {
      sessionId,
      type: 'tool_call',
      toolName: 'read_file',
      payload: { path: '/foo.ts' },
      durationMs: 42,
    });
    await flushQueue();

    await endSession(pool, { sessionId, status: 'completed', rounds: 3, toolCount: 1 });

    const { rows } = await pool.query(
      'SELECT status, rounds, tool_count FROM xifan_obs.sessions WHERE id = $1',
      [sessionId]
    );
    expect(rows[0]).toEqual({ status: 'completed', rounds: 3, tool_count: 1 });

    const { rows: events } = await pool.query(
      'SELECT tool_name FROM xifan_obs.events WHERE session_id = $1',
      [sessionId]
    );
    expect(events[0]?.tool_name).toBe('read_file');
  });
});

describe('replay', () => {
  it('returns ordered events for a session', async () => {
    const sessionId = await startSession(pool, {
      project: '/p', userInput: 'test replay',
    });
    recordEvent(pool, { sessionId, type: 'tool_call', toolName: 'read_file', durationMs: 10 });
    recordEvent(pool, { sessionId, type: 'tool_call', toolName: 'write_file', durationMs: 20 });
    await flushQueue();

    const events = await getReplay(pool, sessionId);
    expect(events).toHaveLength(2);
    expect(events[0]?.tool_name).toBe('read_file');
    expect(events[1]?.tool_name).toBe('write_file');
  });
});
