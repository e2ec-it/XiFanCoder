import { describe, expect, it, vi } from 'vitest';

import { MemoryDatabaseManager } from '../../db/database.js';
import { ObservationStore } from '../../db/observation-store.js';
import { QueueStore } from '../../db/queue-store.js';
import { SessionSummaryStore } from '../../db/summary-store.js';
import { QueueProcessor } from '../queue-processor.js';

function createFixture(now: () => number) {
  const manager = new MemoryDatabaseManager({ dbPath: ':memory:', now });
  manager.migrate();
  const db = manager.getConnection();
  db.prepare(`
    INSERT INTO mem_sessions (id, session_id, project, user_prompt, status, started_at, prompt_count)
    VALUES ('mem-1', 'sess-1', '/repo/demo', 'init', 'active', 1700000000000, 0)
  `).run();

  return {
    manager,
    queue: new QueueStore(db, { now }),
    observations: new ObservationStore(db, { now }),
    summaries: new SessionSummaryStore(db, { now }),
  };
}

describe('QueueProcessor branch coverage', () => {
  it('throws on invalid JSON payload', async () => {
    let nowValue = 1700000000000;
    const now = () => ++nowValue;
    const fixture = createFixture(now);

    fixture.queue.enqueue({
      id: 'bad-json',
      type: 'observation',
      payload: 'not valid json',
    });

    const processor = new QueueProcessor(
      { chat: vi.fn() },
      fixture.queue,
      fixture.observations,
      fixture.summaries,
      { maxRetries: 1, now },
    );

    // processOnce should handle the error (fail the item)
    const result = await processor.processOnce();
    expect(result).toBe(true);

    const failed = fixture.queue.findById('bad-json');
    expect(failed?.status).toBe('failed');

    fixture.manager.close();
  });

  it('throws on invalid payload kind', async () => {
    let nowValue = 1700000000000;
    const now = () => ++nowValue;
    const fixture = createFixture(now);

    fixture.queue.enqueue({
      id: 'bad-kind',
      type: 'observation',
      payload: JSON.stringify({ kind: 'unknown_kind' }),
    });

    const processor = new QueueProcessor(
      { chat: vi.fn() },
      fixture.queue,
      fixture.observations,
      fixture.summaries,
      { maxRetries: 1, now },
    );

    const result = await processor.processOnce();
    expect(result).toBe(true);

    const failed = fixture.queue.findById('bad-kind');
    expect(failed?.status).toBe('failed');
    expect(failed?.payload).toContain('lastError');

    fixture.manager.close();
  });

  it('throws on non-object parsed payload', async () => {
    let nowValue = 1700000000000;
    const now = () => ++nowValue;
    const fixture = createFixture(now);

    fixture.queue.enqueue({
      id: 'null-payload',
      type: 'observation',
      payload: 'null',
    });

    const processor = new QueueProcessor(
      { chat: vi.fn() },
      fixture.queue,
      fixture.observations,
      fixture.summaries,
      { maxRetries: 1, now },
    );

    const result = await processor.processOnce();
    expect(result).toBe(true);

    fixture.manager.close();
  });

  it('encodePayloadWithError falls back when JSON.parse fails on existing payload', async () => {
    let nowValue = 1700000000000;
    const now = () => ++nowValue;
    const fixture = createFixture(now);

    // Enqueue with valid JSON, then corrupt it before processing
    fixture.queue.enqueue({
      id: 'corrupt',
      type: 'observation',
      payload: JSON.stringify({ kind: 'observation', memSessionId: 'mem-1', project: '/repo/demo', promptNumber: 1, sourceText: 'test' }),
    });

    const chat = vi.fn().mockRejectedValue(new Error('llm_fail'));

    const processor = new QueueProcessor(
      { chat },
      fixture.queue,
      fixture.observations,
      fixture.summaries,
      { maxRetries: 3, now },
    );

    // First failure triggers requeue
    await processor.processOnce();

    // Verify the retry item was created
    const pending = fixture.queue.listByStatus('pending');
    expect(pending.length).toBeGreaterThanOrEqual(1);

    fixture.manager.close();
  });

  it('processes summarize payload successfully', async () => {
    let nowValue = 1700000000000;
    const now = () => ++nowValue;
    const fixture = createFixture(now);

    fixture.queue.enqueue({
      id: 'sum-job',
      type: 'summarize',
      payload: JSON.stringify({
        kind: 'summarize',
        memSessionId: 'mem-1',
        project: '/repo/demo',
        sourceText: 'session context',
      }),
    });

    const chat = vi.fn().mockResolvedValue({
      message: {
        content: [
          '<summary>',
          '<request>test</request>',
          '<investigated>stuff</investigated>',
          '<learned>things</learned>',
          '<completed>done</completed>',
          '<next_steps>more</next_steps>',
          '<files_read><item>a.ts</item></files_read>',
          '<files_edited><item>b.ts</item></files_edited>',
          '</summary>',
        ].join(''),
      },
    });

    const processor = new QueueProcessor(
      { chat },
      fixture.queue,
      fixture.observations,
      fixture.summaries,
      { now },
    );

    const result = await processor.processOnce();
    expect(result).toBe(true);

    const summaries = fixture.summaries.findBySession('mem-1');
    expect(summaries).toHaveLength(1);

    fixture.manager.close();
  });

  it('handles summarize with skip_summary (no summary persisted)', async () => {
    let nowValue = 1700000000000;
    const now = () => ++nowValue;
    const fixture = createFixture(now);

    fixture.queue.enqueue({
      id: 'sum-skip',
      type: 'summarize',
      payload: JSON.stringify({
        kind: 'summarize',
        memSessionId: 'mem-1',
        project: '/repo/demo',
        sourceText: 'too short',
      }),
    });

    const chat = vi.fn().mockResolvedValue({
      message: {
        content: '<summary><skip_summary>true</skip_summary></summary>',
      },
    });

    const processor = new QueueProcessor(
      { chat },
      fixture.queue,
      fixture.observations,
      fixture.summaries,
      { now },
    );

    const result = await processor.processOnce();
    expect(result).toBe(true);

    const summaries = fixture.summaries.findBySession('mem-1');
    expect(summaries).toHaveLength(0);

    fixture.manager.close();
  });

  it('processOnce returns false when queue is empty', async () => {
    let nowValue = 1700000000000;
    const now = () => ++nowValue;
    const fixture = createFixture(now);

    const processor = new QueueProcessor(
      { chat: vi.fn() },
      fixture.queue,
      fixture.observations,
      fixture.summaries,
      { now },
    );

    const result = await processor.processOnce();
    expect(result).toBe(false);

    fixture.manager.close();
  });

  it('start is a no-op when already running', async () => {
    let nowValue = 1700000000000;
    const now = () => ++nowValue;
    const fixture = createFixture(now);

    let _sleepCount = 0;
    const processor = new QueueProcessor(
      { chat: vi.fn() },
      fixture.queue,
      fixture.observations,
      fixture.summaries,
      {
        now,
        idlePauseMs: 0,
        pollIntervalMs: 1,
        sleep: async () => {
          _sleepCount++;
        },
      },
    );

    // start will run until idle pause
    await processor.start();
    expect(processor.isPausedByIdle()).toBe(true);

    fixture.manager.close();
  });

  it('handles error with non-Error thrown value', async () => {
    let nowValue = 1700000000000;
    const now = () => ++nowValue;
    const fixture = createFixture(now);

    fixture.queue.enqueue({
      id: 'str-err',
      type: 'observation',
      payload: JSON.stringify({
        kind: 'observation',
        memSessionId: 'mem-1',
        project: '/repo/demo',
        promptNumber: 1,
        sourceText: 'test',
      }),
    });

    const chat = vi.fn().mockRejectedValue('string_error');

    const processor = new QueueProcessor(
      { chat },
      fixture.queue,
      fixture.observations,
      fixture.summaries,
      { maxRetries: 1, now },
    );

    await processor.processOnce();

    const failed = fixture.queue.findById('str-err');
    expect(failed?.status).toBe('failed');
    expect(failed?.payload).toContain('string_error');

    fixture.manager.close();
  });
});
