import { describe, expect, it } from 'vitest';

import { MemoryDatabaseManager } from '../database.js';
import { ObservationStore } from '../observation-store.js';
import { QueueStore } from '../queue-store.js';
import { MemSessionStore } from '../session-store.js';
import { SessionSummaryStore } from '../summary-store.js';
import { UserPromptStore } from '../prompt-store.js';

function createTestDb(now: () => number) {
  const manager = new MemoryDatabaseManager({ dbPath: ':memory:', now });
  manager.migrate();
  const db = manager.getConnection();
  return {
    manager,
    db,
    sessions: new MemSessionStore(db, { now }),
    observations: new ObservationStore(db, { now }),
    summaries: new SessionSummaryStore(db, { now }),
    prompts: new UserPromptStore(db, { now }),
    queue: new QueueStore(db, { now }),
  };
}

describe('MemSessionStore branch coverage', () => {
  it('listByProject returns sessions ordered by started_at DESC', () => {
    let nowValue = 1700000000000;
    const now = () => nowValue++;
    const { manager, sessions } = createTestDb(now);

    sessions.create({
      id: 'ses-1',
      sessionId: 'sid-1',
      project: '/repo/a',
      userPrompt: 'first',
    });
    sessions.create({
      id: 'ses-2',
      sessionId: 'sid-2',
      project: '/repo/a',
      userPrompt: 'second',
    });
    sessions.create({
      id: 'ses-3',
      sessionId: 'sid-3',
      project: '/repo/b',
      userPrompt: 'other project',
    });

    const results = sessions.listByProject('/repo/a');
    expect(results).toHaveLength(2);
    expect(results[0]?.id).toBe('ses-2'); // more recent first
    expect(results[1]?.id).toBe('ses-1');

    manager.close();
  });

  it('listByProject respects limit parameter', () => {
    let nowValue = 1700000000000;
    const now = () => nowValue++;
    const { manager, sessions } = createTestDb(now);

    sessions.create({ id: 's1', sessionId: 'sid-1', project: '/p', userPrompt: 'a' });
    sessions.create({ id: 's2', sessionId: 'sid-2', project: '/p', userPrompt: 'b' });
    sessions.create({ id: 's3', sessionId: 'sid-3', project: '/p', userPrompt: 'c' });

    const limited = sessions.listByProject('/p', 2);
    expect(limited).toHaveLength(2);

    manager.close();
  });
});

describe('UserPromptStore branch coverage', () => {
  it('listBySession returns prompts ordered by created_at ASC', () => {
    let nowValue = 1700000000000;
    const now = () => nowValue++;
    const { manager, sessions, prompts } = createTestDb(now);

    sessions.create({
      id: 'ses-1',
      sessionId: 'sid-1',
      project: '/repo/a',
      userPrompt: 'init',
    });

    prompts.append({
      id: 'p-1',
      memSessionId: 'ses-1',
      content: 'first prompt',
      project: '/repo/a',
      promptNumber: 1,
    });
    prompts.append({
      id: 'p-2',
      memSessionId: 'ses-1',
      content: 'second prompt',
      project: '/repo/a',
      promptNumber: 2,
    });

    const results = prompts.listBySession('ses-1');
    expect(results).toHaveLength(2);
    expect(results[0]?.id).toBe('p-1');
    expect(results[1]?.id).toBe('p-2');

    manager.close();
  });

  it('listBySession respects limit', () => {
    let nowValue = 1700000000000;
    const now = () => nowValue++;
    const { manager, sessions, prompts } = createTestDb(now);

    sessions.create({
      id: 'ses-1',
      sessionId: 'sid-1',
      project: '/repo/a',
      userPrompt: 'init',
    });

    prompts.append({ id: 'p-1', memSessionId: 'ses-1', content: 'a', project: '/repo/a', promptNumber: 1 });
    prompts.append({ id: 'p-2', memSessionId: 'ses-1', content: 'b', project: '/repo/a', promptNumber: 2 });
    prompts.append({ id: 'p-3', memSessionId: 'ses-1', content: 'c', project: '/repo/a', promptNumber: 3 });

    const limited = prompts.listBySession('ses-1', 2);
    expect(limited).toHaveLength(2);

    manager.close();
  });

  it('searchByText without project filter', () => {
    let nowValue = 1700000000000;
    const now = () => nowValue++;
    const { manager, sessions, prompts } = createTestDb(now);

    sessions.create({
      id: 'ses-1',
      sessionId: 'sid-1',
      project: '/repo/a',
      userPrompt: 'init',
    });

    prompts.append({
      id: 'p-1',
      memSessionId: 'ses-1',
      content: 'websocket authentication logic',
      project: '/repo/a',
      promptNumber: 1,
    });

    const results = prompts.searchByText('websocket');
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('p-1');

    manager.close();
  });
});

describe('ObservationStore and SummaryStore branch coverage', () => {
  it('observation search with project filter', () => {
    let nowValue = 1700000000000;
    const now = () => nowValue++;
    const { manager, sessions, observations } = createTestDb(now);

    sessions.create({
      id: 'ses-1',
      sessionId: 'sid-1',
      project: '/repo/a',
      userPrompt: 'init',
    });

    observations.create({
      id: 'o-1',
      memSessionId: 'ses-1',
      type: 'bugfix',
      title: 'Fix auth logic',
      narrative: 'fixed websocket auth bypass vulnerability',
      facts: ['patched token check'],
      concepts: ['auth'],
      filesRead: [],
      filesModified: [],
      project: '/repo/a',
      promptNumber: 1,
    });

    const withProject = observations.search('auth', { project: '/repo/a' });
    expect(withProject).toHaveLength(1);

    const withoutProject = observations.search('auth');
    expect(withoutProject).toHaveLength(1);

    manager.close();
  });
});
