import { describe, expect, it, vi } from 'vitest';

import { MemoryDatabaseManager } from '../../db/database.js';
import { ObservationStore } from '../../db/observation-store.js';
import { QueueStore } from '../../db/queue-store.js';
import { SessionSummaryStore } from '../../db/summary-store.js';
import { QueueProcessor } from '../queue-processor.js';

function createFixture(now: () => number): {
  manager: MemoryDatabaseManager;
  queue: QueueStore;
  observations: ObservationStore;
  summaries: SessionSummaryStore;
} {
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

describe('QueueProcessor', () => {
  it('can be stopped while polling an empty queue', async () => {
    let nowValue = 1700000005000;
    const now = (): number => ++nowValue;
    const fixture = createFixture(now);
    let stopCalls = 0;

    const processor = new QueueProcessor(
      {
        chat: vi.fn(),
      },
      fixture.queue,
      fixture.observations,
      fixture.summaries,
      {
        now,
        idlePauseMs: 60_000,
        pollIntervalMs: 1,
        sleep: async () => {
          stopCalls += 1;
          processor.stop();
        },
      },
    );

    expect(processor.isRunning()).toBe(false);
    await processor.start();
    expect(processor.isRunning()).toBe(false);
    expect(stopCalls).toBeGreaterThan(0);
    expect(processor.isPausedByIdle()).toBe(false);

    fixture.manager.close();
  });

  it('retries failed jobs and eventually succeeds before max retry cap', async () => {
    let nowValue = 1700000000000;
    const now = (): number => ++nowValue;
    const fixture = createFixture(now);

    const chat = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary_error_1'))
      .mockRejectedValueOnce(new Error('temporary_error_2'))
      .mockResolvedValue({
        message: {
          content: '<observation><type>bugfix</type><title>A</title><narrative>N</narrative><facts><item>f</item></facts><concepts><item>c</item></concepts><files_read></files_read><files_modified></files_modified></observation>',
        },
      });

    fixture.queue.enqueue({
      id: 'job-1',
      type: 'observation',
      payload: JSON.stringify({
        kind: 'observation',
        memSessionId: 'mem-1',
        project: '/repo/demo',
        promptNumber: 1,
        sourceText: 'tool output',
      }),
    });

    const processor = new QueueProcessor(
      { chat },
      fixture.queue,
      fixture.observations,
      fixture.summaries,
      { maxRetries: 3, now },
    );

    await processor.processOnce();
    await processor.processOnce();
    await processor.processOnce();

    expect(fixture.observations.findByProject('/repo/demo')).toHaveLength(1);
    expect(fixture.queue.listByStatus('pending')).toHaveLength(0);
    expect(fixture.queue.listByStatus('failed').length).toBeGreaterThanOrEqual(2);

    fixture.manager.close();
  });

  it('records error payload when max retries exceeded', async () => {
    let nowValue = 1700000010000;
    const now = (): number => ++nowValue;
    const fixture = createFixture(now);
    const chat = vi.fn().mockRejectedValue(new Error('permanent_error'));

    fixture.queue.enqueue({
      id: 'job-fail',
      type: 'summarize',
      payload: JSON.stringify({
        kind: 'summarize',
        memSessionId: 'mem-1',
        project: '/repo/demo',
        sourceText: 'summary context',
      }),
    });

    const processor = new QueueProcessor(
      { chat },
      fixture.queue,
      fixture.observations,
      fixture.summaries,
      { maxRetries: 1, now },
    );
    await processor.processOnce();

    const failed = fixture.queue.findById('job-fail');
    expect(failed?.status).toBe('failed');
    expect(failed?.payload).toContain('lastError');

    fixture.manager.close();
  });

  it('resets stale processing items when processor starts', async () => {
    let nowValue = 1700000020000;
    const now = (): number => ++nowValue;
    const fixture = createFixture(now);

    fixture.queue.enqueue({
      id: 'stale-1',
      type: 'observation',
      status: 'processing',
      claimedAt: nowValue - 10 * 60 * 1000,
      payload: JSON.stringify({
        kind: 'observation',
        memSessionId: 'mem-1',
        project: '/repo/demo',
        promptNumber: 1,
        sourceText: 'no-op',
      }),
    });

    const processor = new QueueProcessor(
      {
        chat: vi.fn().mockResolvedValue({
          message: {
            content: '<observation><type>change</type><title>T</title><narrative>N</narrative><facts></facts><concepts></concepts><files_read></files_read><files_modified></files_modified></observation>',
          },
        }),
      },
      fixture.queue,
      fixture.observations,
      fixture.summaries,
      {
        now,
        idlePauseMs: 0,
        pollIntervalMs: 1,
        sleep: async () => {},
      },
    );

    await processor.start();
    expect(processor.isPausedByIdle()).toBe(true);
    expect(fixture.queue.listByStatus('processing')).toHaveLength(0);

    fixture.manager.close();
  });
});
