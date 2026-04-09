import { describe, expect, it } from 'vitest';

import { MemoryDatabaseManager } from '../database.js';
import { ObservationStore } from '../observation-store.js';
import { QueueStore } from '../queue-store.js';
import { MemSessionStore } from '../session-store.js';
import { SessionSummaryStore } from '../summary-store.js';
import { UserPromptStore } from '../prompt-store.js';

function createTestStores(now: () => number): {
  manager: MemoryDatabaseManager;
  sessions: MemSessionStore;
  observations: ObservationStore;
  summaries: SessionSummaryStore;
  prompts: UserPromptStore;
  queue: QueueStore;
} {
  const manager = new MemoryDatabaseManager({
    dbPath: ':memory:',
    now,
  });
  manager.migrate();
  const db = manager.getConnection();
  return {
    manager,
    sessions: new MemSessionStore(db, { now }),
    observations: new ObservationStore(db, { now }),
    summaries: new SessionSummaryStore(db, { now }),
    prompts: new UserPromptStore(db, { now }),
    queue: new QueueStore(db, { now }),
  };
}

describe('xifan-mem stores', () => {
  it('supports session / prompt / observation / summary flow with FTS search', () => {
    let nowValue = 1700000000000;
    const now = (): number => nowValue++;
    const { manager, sessions, prompts, observations, summaries } = createTestStores(now);

    const session = sessions.create({
      id: 'mems-1',
      sessionId: 'sess-1',
      project: '/repo/demo',
      userPrompt: 'implement websocket auth',
    });
    expect(session.status).toBe('active');

    prompts.append({
      id: 'p-1',
      memSessionId: session.id,
      project: '/repo/demo',
      promptNumber: 1,
      content: 'Need robust websocket authentication',
    });
    sessions.incrementPromptCount(session.id);

    const promptSearch = prompts.searchByText('websocket', '/repo/demo');
    expect(promptSearch).toHaveLength(1);
    expect(promptSearch[0]?.id).toBe('p-1');

    observations.create({
      id: 'o-1',
      memSessionId: session.id,
      type: 'bugfix',
      title: 'Fix websocket auth bypass',
      narrative: 'added token and origin validation for websocket upgrade',
      facts: ['401 for missing token', '403 for bad origin'],
      concepts: ['websocket', 'auth', 'security'],
      filesRead: ['packages/core/src/mcp/server.ts'],
      filesModified: ['packages/core/src/mcp/security.ts'],
      project: '/repo/demo',
      promptNumber: 1,
    });

    const observationSearch = observations.searchByText('origin');
    expect(observationSearch).toHaveLength(1);
    expect(observationSearch[0]?.id).toBe('o-1');
    expect(observationSearch[0]?.facts).toContain('401 for missing token');
    expect(observations.findByProject('/repo/demo')).toHaveLength(1);
    expect(observations.findByFile('packages/core/src/mcp/security.ts')).toHaveLength(1);

    const summary = summaries.create({
      id: 's-1',
      memSessionId: session.id,
      request: 'harden websocket security',
      investigated: 'upgrade path and auth checks',
      learned: 'header validation and localhost binding matter',
      completed: 'implemented validation and tests',
      nextSteps: 'add integration tests',
      filesRead: ['packages/core/src/mcp/server.ts'],
      filesEdited: ['packages/core/src/mcp/security.ts'],
      project: '/repo/demo',
    });
    expect(summary.id).toBe('s-1');
    expect(summaries.findBySession(session.id)).toHaveLength(1);
    expect(summaries.findLatestByProject('/repo/demo')?.id).toBe('s-1');

    const completed = sessions.updateStatus(session.id, 'completed');
    expect(completed?.status).toBe('completed');
    expect(completed?.completedAt).toBeDefined();

    manager.close();
  });

  it('supports queue enqueue/claim/fail/reset/done lifecycle', () => {
    let nowValue = 1700000010000;
    const now = (): number => nowValue += 10;
    const { manager, queue } = createTestStores(now);

    queue.enqueue({
      id: 'q-1',
      type: 'observation',
      payload: JSON.stringify({ observationId: 'o-1' }),
    });
    queue.enqueue({
      id: 'q-2',
      type: 'summarize',
      payload: JSON.stringify({ memSessionId: 'mems-1' }),
    });

    const first = queue.claim();
    expect(first?.id).toBe('q-1');
    expect(first?.status).toBe('processing');

    const failed = queue.fail('q-1');
    expect(failed?.status).toBe('failed');
    expect(failed?.retryCount).toBe(1);

    const second = queue.claim();
    expect(second?.id).toBe('q-2');
    expect(second?.status).toBe('processing');

    const reset = queue.resetStale(0);
    expect(reset).toBe(1);

    const reclaimed = queue.claim();
    expect(reclaimed?.id).toBe('q-2');

    const done = queue.done('q-2');
    expect(done?.status).toBe('done');

    manager.close();
  });

  it('claims queue items atomically under concurrent calls', async () => {
    let nowValue = 1700000020000;
    const now = (): number => nowValue += 1;
    const { manager, queue } = createTestStores(now);

    queue.enqueue({
      id: 'q-a',
      type: 'observation',
      payload: '{}',
    });
    queue.enqueue({
      id: 'q-b',
      type: 'observation',
      payload: '{}',
    });

    const [a, b] = await Promise.all([
      Promise.resolve().then(() => queue.claim()),
      Promise.resolve().then(() => queue.claim()),
    ]);

    expect(a?.id).toBeDefined();
    expect(b?.id).toBeDefined();
    expect(a?.id).not.toBe(b?.id);
    expect(queue.listByStatus('processing')).toHaveLength(2);

    manager.close();
  });
});
