/**
 * Phase A-D 量化验收测试
 * 使用真实 PostgreSQL 容器（pgvector/pgvector:pg16）
 * 不依赖外部 LiteLLM — embedder 使用 vi.mock
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import http from 'node:http';

// Mock embedder so tests don't need the LiteLLM server
vi.mock('../../memory/embedder.js', () => ({
  embed: vi.fn().mockResolvedValue(new Array(768).fill(0.1) as number[]),
}));

import { runMigration } from '../../db/migrate.js';
import { startSession, endSession } from '../../observer/session.js';
import { recordEvent, flushQueue } from '../../observer/event-store.js';
import { getReplay } from '../../observer/replay.js';
import { saveMemory } from '../../memory/store.js';
import { hybridSearch } from '../../memory/retriever.js';
import { assembleContext } from '../../memory/assembler.js';
import { scoreTrajectory } from '../../evolution/quality-scorer.js';
import { extractSkillIfWorthy } from '../../evolution/sage.js';
import { startMemoryApi } from '../../integration/memory-api.js';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigration(pool);
}, 120_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
}, 30_000);

// ── Phase A ──────────────────────────────────────────────────────────────────

describe('Phase A: Observer MVP', () => {
  it('A-1: full session lifecycle — write + replay', async () => {
    const sessionId = await startSession(pool, {
      project: '/workspace/test-app',
      userInput: '修复登录 bug',
      model: 'qwen2.5-coder-32b',
    });

    recordEvent(pool, { sessionId, type: 'tool_call', toolName: 'read_file', durationMs: 10 });
    recordEvent(pool, { sessionId, type: 'tool_call', toolName: 'str_replace', durationMs: 8 });
    recordEvent(pool, { sessionId, type: 'tool_call', toolName: 'run_tests', durationMs: 1200 });
    await flushQueue();

    await endSession(pool, { sessionId, status: 'completed', rounds: 3, toolCount: 3 });

    const events = await getReplay(pool, sessionId);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.tool_name)).toEqual(['read_file', 'str_replace', 'run_tests']);

    const { rows } = await pool.query<{ status: string; rounds: number }>(
      'SELECT status, rounds FROM xifan_obs.sessions WHERE id = $1',
      [sessionId],
    );
    expect(rows[0]).toMatchObject({ status: 'completed', rounds: 3 });
  });

  it('A-2: event write + flush is non-blocking (<100ms for 10 events)', async () => {
    const sessionId = await startSession(pool, {
      project: '/workspace/perf',
      userInput: 'performance test',
    });

    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      recordEvent(pool, { sessionId, type: 'tool_call', toolName: `tool_${i}`, durationMs: 5 });
    }
    const elapsed = Date.now() - start;
    // recordEvent is sync (queues into memory), should be <10ms
    expect(elapsed).toBeLessThan(10);

    await flushQueue();
    const events = await getReplay(pool, sessionId);
    expect(events).toHaveLength(10);
  });
});

// ── Phase B ──────────────────────────────────────────────────────────────────

describe('Phase B: Memory & Retrieval', () => {
  it('B-1: save 5 memories, hybridSearch returns results', async () => {
    await saveMemory(pool, {
      type: 'episodic',
      summary: '修复了 PostgreSQL 连接池泄漏问题，通过检查 pool.end() 调用',
      payload: { project: 'api-server' },
      salience: 0.9,
      embedding: new Array(768).fill(0.1) as number[],
    });
    await saveMemory(pool, {
      type: 'semantic',
      summary: 'PostgreSQL 连接池最佳实践：使用 pool.end() 而非 client.release()',
      payload: {},
      salience: 0.8,
      embedding: new Array(768).fill(0.1) as number[],
    });

    const results = await hybridSearch(pool, 'PostgreSQL 连接池', { topK: 5 });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('B-2: assembleContext respects 1800-token budget', async () => {
    // Seed 10 memories with long summaries
    for (let i = 0; i < 10; i++) {
      await saveMemory(pool, {
        type: 'episodic',
        summary: `经验${i}: ${'x'.repeat(500)}`,
        payload: {},
        salience: 1.0 - i * 0.05,
        embedding: new Array(768).fill(0.1 + i * 0.001) as number[],
      });
    }

    const results = await hybridSearch(pool, '经验', { topK: 10 });
    const context = assembleContext(results);

    // 1800 tokens * 4 chars/token = 7200 chars max
    const MAX_CHARS = 1800 * 4;
    expect(context.length).toBeLessThanOrEqual(MAX_CHARS + 100); // +100 for XML tags
  });

  it('B-3: hybridSearch P99 latency <100ms with 1000 rows', async () => {
    // Seed 1000 memories in batches
    const batchSize = 100;
    for (let b = 0; b < 10; b++) {
      const values = Array.from({ length: batchSize }, (_, i) => {
        const idx = b * batchSize + i;
        const vec = `[${new Array(768).fill(0).map((_, j) => ((idx * j) % 100) / 100).join(',')}]`;
        return `(gen_random_uuid()::text, 'episodic', 'seed memory ${idx}', ${Date.now()}, ${Date.now()}, ${1.0 - idx * 0.0001}, '${vec}'::vector)`;
      }).join(',');
      await pool.query(
        `INSERT INTO xifan_mem.memories (id, type, summary, created_at, accessed_at, salience, embedding) VALUES ${values}`,
      );
    }

    // Measure P99 over 50 queries
    const latencies: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t = Date.now();
      await hybridSearch(pool, `test query ${i}`, { topK: 5 });
      latencies.push(Date.now() - t);
    }
    latencies.sort((a, b) => a - b);
    const p99 = latencies[Math.floor(latencies.length * 0.99)]!;
    expect(p99).toBeLessThan(100);
  }, 30_000);
});

// ── Phase C ──────────────────────────────────────────────────────────────────

describe('Phase C: Skill Evolution', () => {
  it('C-1: scoreTrajectory returns correct values', () => {
    expect(scoreTrajectory({ status: 'completed', toolCount: 5, filesModified: 1 })).toBeCloseTo(1.0 * 0.5 + 1.0 * 0.3 + 1.0 * 0.2, 2);
    expect(scoreTrajectory({ status: 'error', toolCount: 10, filesModified: 0 })).toBeLessThan(0.3);
  });

  it('C-2: extractSkillIfWorthy extracts procedural memory for high-quality session', async () => {
    // Create a completed session with tool calls
    const sessionId = await startSession(pool, {
      project: '/workspace/skill-test',
      userInput: '实现用户注册功能',
    });
    recordEvent(pool, { sessionId, type: 'tool_call', toolName: 'read_file', durationMs: 10 });
    recordEvent(pool, { sessionId, type: 'tool_call', toolName: 'str_replace', durationMs: 8 });
    await flushQueue();
    await endSession(pool, { sessionId, status: 'completed', rounds: 2, toolCount: 2 });

    const skillId = await extractSkillIfWorthy(pool, sessionId, {
      userInput: '实现用户注册功能',
      status: 'completed',
      toolCount: 2,
      filesModified: 1,
    });

    // High quality session (completed, 2 tools, 1 file) should produce a skill
    expect(skillId).toBeDefined();
    const { rows } = await pool.query<{ type: string; summary: string }>(
      'SELECT type, summary FROM xifan_mem.memories WHERE id = $1',
      [skillId],
    );
    expect(rows[0]?.type).toBe('procedural');
    expect(rows[0]?.summary).toContain('技能');
  });

  it('C-3: extractSkillIfWorthy skips low-quality sessions', async () => {
    const sessionId = await startSession(pool, {
      project: '/workspace/low-quality',
      userInput: '失败任务',
    });
    await endSession(pool, { sessionId, status: 'error', rounds: 50, toolCount: 30 });

    const skillId = await extractSkillIfWorthy(pool, sessionId, {
      userInput: '失败任务',
      status: 'error',
      toolCount: 30,
      filesModified: 0,
    });

    expect(skillId).toBeUndefined();
  });
});

// ── Phase D ──────────────────────────────────────────────────────────────────

describe('Phase D: Memory API', () => {
  let server: http.Server;
  let apiPort: number;

  beforeAll(async () => {
    process.env['XIFAN_AGENTS_API_PORT'] = '0'; // use random port
    const result = await startMemoryApi(pool);
    server = result.server;
    apiPort = result.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('D-1: /api/v1/health responds <200ms', async () => {
    const start = Date.now();
    const res = await fetch(`http://localhost:${apiPort}/api/v1/health`);
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
    expect(elapsed).toBeLessThan(200);
  });

  it('D-2: POST /api/v1/observations saves a memory', async () => {
    const res = await fetch(`http://localhost:${apiPort}/api/v1/observations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'semantic',
        summary: 'API test memory',
        payload: { source: 'acceptance-test' },
        salience: 0.8,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('D-3: GET /api/v1/experiences returns results', async () => {
    const res = await fetch(`http://localhost:${apiPort}/api/v1/experiences?q=API+test&topK=3`);
    expect(res.status).toBe(200);
    const body = await res.json() as { results: unknown[] };
    expect(Array.isArray(body.results)).toBe(true);
  });
});
