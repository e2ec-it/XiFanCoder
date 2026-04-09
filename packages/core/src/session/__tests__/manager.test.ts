import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BudgetExceededError } from '../../errors/index.js';
import { SessionManager } from '../manager.js';

function createTempDbPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-session-manager-'));
  return path.join(root, 'sessions.db');
}

describe('SessionManager', () => {
  it('creates/lists/resumes sessions with persisted messages', () => {
    const dbPath = createTempDbPath();
    const manager = new SessionManager({
      dbPath,
      allowExternalDbPath: true,
      idGenerator: () => 'sid-1',
    });

    const created = manager.createSession({
      projectPath: '/repo/demo',
      model: 'gpt-4o',
      provider: 'openai',
    });

    manager.appendMessage({
      id: 'm1',
      sessionId: created.id,
      role: 'user',
      content: 'hello',
    });
    manager.streamingAppend({
      messageId: 'm2',
      sessionId: created.id,
      role: 'assistant',
      chunk: 'stream ',
    });
    manager.streamingAppend({
      messageId: 'm2',
      sessionId: created.id,
      role: 'assistant',
      chunk: 'ok',
    });

    const listed = manager.listSessions({ projectPath: '/repo/demo' });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe('sid-1');

    const resumed = manager.resumeSession('sid-1');
    expect(resumed?.session.projectPath).toBe('/repo/demo');
    expect(resumed?.messages).toHaveLength(2);
    expect(resumed?.messages[1]?.content).toBe('stream ok');

    const updated = manager.updateContextSnapshot('sid-1', '{"outputStyle":"compact"}');
    expect(updated?.contextSnapshot).toBe('{"outputStyle":"compact"}');

    manager.close();
  });

  it('returns undefined when resuming unknown session', () => {
    const manager = new SessionManager({
      dbPath: ':memory:',
    });

    expect(manager.resumeSession('missing')).toBeUndefined();
    manager.close();
  });

  it('records token usage, aggregates cost, and enforces budget checks', () => {
    const dbPath = createTempDbPath();
    const manager = new SessionManager({
      dbPath,
      allowExternalDbPath: true,
      idGenerator: () => 'sid-2',
    });
    const session = manager.createSession({
      projectPath: '/repo/demo',
      model: 'gpt-4o',
      provider: 'openai',
    });

    manager.recordTokenUsage({
      id: 'u1',
      sessionId: session.id,
      role: 'assistant',
      promptTokens: 1000,
      completionTokens: 2000,
    });
    manager.recordTokenUsage({
      id: 'u2',
      sessionId: session.id,
      role: 'assistant',
      promptTokens: 500,
      completionTokens: 500,
    });

    const sessionAgg = manager.getSessionCost(session.id);
    expect(sessionAgg.totalTokens).toBe(4000);
    expect(sessionAgg.costUsd).toBeGreaterThan(0);

    const listed = manager.listSessions({ projectPath: '/repo/demo' });
    expect(listed[0]?.totalTokens).toBe(4000);
    expect((listed[0]?.totalCostUsd ?? 0)).toBeGreaterThan(0);

    expect(() =>
      manager.checkBudget({
        sessionId: session.id,
        sessionBudgetUsd: 0.000001,
      }),
    ).toThrow(BudgetExceededError);

    expect(() =>
      manager.checkBudget({
        dailyBudgetUsd: 0.000001,
      }),
    ).toThrow(BudgetExceededError);

    const ok = manager.checkBudget({
      sessionId: session.id,
      sessionBudgetUsd: 100,
      dailyBudgetUsd: 100,
    });
    expect((ok.sessionCostUsd ?? 0)).toBeGreaterThan(0);
    expect((ok.dailyCostUsd ?? 0)).toBeGreaterThan(0);

    manager.close();
  });

  it('lists all sessions without projectPath filter', () => {
    const dbPath = createTempDbPath();
    let counter = 0;
    const manager = new SessionManager({
      dbPath,
      allowExternalDbPath: true,
      idGenerator: () => `sid-all-${counter++}`,
    });

    manager.createSession({ projectPath: '/a', model: 'gpt-4o', provider: 'openai' });
    manager.createSession({ projectPath: '/b', model: 'gpt-4o', provider: 'openai' });

    const all = manager.listSessions();
    expect(all).toHaveLength(2);

    manager.close();
  });

  it('throws when recording token usage for unknown session', () => {
    const manager = new SessionManager({ dbPath: ':memory:' });

    expect(() =>
      manager.recordTokenUsage({
        sessionId: 'nonexistent',
        role: 'assistant',
        promptTokens: 100,
        completionTokens: 50,
      }),
    ).toThrowError('Session not found');

    manager.close();
  });

  it('aggregates cost by model', () => {
    const dbPath = createTempDbPath();
    const manager = new SessionManager({
      dbPath,
      allowExternalDbPath: true,
      idGenerator: () => 'sid-model',
    });
    const session = manager.createSession({
      projectPath: '/repo/demo',
      model: 'gpt-4o',
      provider: 'openai',
    });
    manager.recordTokenUsage({
      id: 'u-model',
      sessionId: session.id,
      role: 'assistant',
      promptTokens: 100,
      completionTokens: 200,
    });

    const modelCost = manager.getModelCost('gpt-4o');
    expect(modelCost.totalTokens).toBeGreaterThan(0);

    manager.close();
  });

  it('throws when sessionBudgetUsd specified without sessionId', () => {
    const manager = new SessionManager({ dbPath: ':memory:' });

    expect(() =>
      manager.checkBudget({ sessionBudgetUsd: 1.0 }),
    ).toThrowError('sessionBudgetUsd requires sessionId');

    manager.close();
  });
});
