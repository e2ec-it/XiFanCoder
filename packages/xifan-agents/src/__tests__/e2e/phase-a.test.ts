import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';

import { runMigration } from '../../db/migrate.js';
import { recordEvent, flushQueue } from '../../observer/event-store.js';
import { getReplay } from '../../observer/replay.js';
import { endSession, startSession } from '../../observer/session.js';

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

describe('Phase A: complete session lifecycle', () => {
  it('records full tool call sequence and supports replay', async () => {
    // Simulate: xifancoder "修复登录 bug"
    const sessionId = await startSession(pool, {
      project: '/workspace/my-app',
      userInput: '修复登录 bug',
      model: 'qwen2.5-coder-32b',
    });

    // Simulate 3 tool calls
    recordEvent(pool, { sessionId, type: 'tool_call', toolName: 'read_file', durationMs: 15 });
    recordEvent(pool, { sessionId, type: 'tool_call', toolName: 'str_replace', durationMs: 8 });
    recordEvent(pool, { sessionId, type: 'tool_call', toolName: 'run_tests', durationMs: 1200 });
    await flushQueue();

    await endSession(pool, { sessionId, status: 'completed', rounds: 3, toolCount: 3 });

    // Verify session record
    const { rows: sessions } = await pool.query<{
      id: string;
      status: string;
      rounds: number;
      tool_count: number;
    }>('SELECT id, status, rounds, tool_count FROM xifan_obs.sessions WHERE id = $1', [sessionId]);
    expect(sessions[0]).toMatchObject({ status: 'completed', rounds: 3, tool_count: 3 });

    // Verify replay
    const events = await getReplay(pool, sessionId);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.tool_name)).toEqual(['read_file', 'str_replace', 'run_tests']);
  });
});
