import { describe, expect, it } from 'vitest';

import { DatabaseManager } from '../manager.js';
import { MessageRepository } from '../message-repository.js';
import { SessionRepository } from '../session-repository.js';
import { TokenUsageRepository } from '../token-usage-repository.js';

function createInMemoryDb(now: () => number): {
  manager: DatabaseManager;
  sessions: SessionRepository;
  messages: MessageRepository;
  tokenUsage: TokenUsageRepository;
} {
  const manager = new DatabaseManager({
    dbPath: ':memory:',
    now,
  });
  manager.migrate();
  const db = manager.getConnection();
  return {
    manager,
    sessions: new SessionRepository(db, { now }),
    messages: new MessageRepository(db, { now }),
    tokenUsage: new TokenUsageRepository(db, { now }),
  };
}

describe('repositories', () => {
  it('supports session create/find/update/list/findByProject', () => {
    let nowValue = 1700000000000;
    const now = (): number => nowValue;
    const { manager, sessions } = createInMemoryDb(now);

    const s1 = sessions.create({
      id: 's1',
      projectPath: '/repo/a',
      model: 'gpt-4o',
      provider: 'openai',
    });
    nowValue += 10;
    sessions.create({
      id: 's2',
      projectPath: '/repo/a',
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
    });

    expect(s1.status).toBe('active');
    expect(sessions.findById('s1')?.projectPath).toBe('/repo/a');

    const updated = sessions.update('s1', {
      status: 'completed',
      messageCount: 3,
      totalTokens: 100,
      totalCostUsd: 0.12,
      completedAt: 1700000002222,
    });
    expect(updated?.status).toBe('completed');
    expect(updated?.messageCount).toBe(3);

    const projectSessions = sessions.findByProject('/repo/a');
    expect(projectSessions).toHaveLength(2);
    expect(projectSessions[0]?.id).toBe('s2');

    const completed = sessions.list({ status: 'completed' });
    expect(completed.map((item) => item.id)).toEqual(['s1']);

    manager.close();
  });

  it('supports message append, streamingAppend, session retrieval and FTS search', () => {
    let nowValue = 1700000010000;
    const now = (): number => nowValue++;
    const { manager, sessions, messages } = createInMemoryDb(now);

    sessions.create({
      id: 's1',
      projectPath: '/repo/a',
      model: 'gpt-4o',
      provider: 'openai',
    });

    messages.append({
      id: 'm1',
      sessionId: 's1',
      role: 'user',
      content: 'hello world from user',
    });

    messages.streamingAppend({
      id: 'm2',
      sessionId: 's1',
      role: 'assistant',
      chunk: 'stream ',
    });
    const streamed = messages.streamingAppend({
      id: 'm2',
      sessionId: 's1',
      role: 'assistant',
      chunk: 'response',
    });
    expect(streamed.content).toBe('stream response');

    const all = messages.findBySession('s1');
    expect(all).toHaveLength(2);
    expect(all[0]?.id).toBe('m1');
    expect(all[1]?.id).toBe('m2');

    const search = messages.searchByContent('hello', { sessionId: 's1' });
    expect(search.length).toBeGreaterThanOrEqual(1);
    expect(search[0]?.message.id).toBe('m1');

    manager.close();
  });

  it('keeps complete content under repeated streaming appends', async () => {
    let nowValue = 1700000020000;
    const now = (): number => nowValue++;
    const { manager, sessions, messages } = createInMemoryDb(now);

    sessions.create({
      id: 's1',
      projectPath: '/repo/a',
      model: 'gpt-4o',
      provider: 'openai',
    });

    const chunks = ['A', 'B', 'C', 'D', 'E'];
    await Promise.all(
      chunks.map(async (chunk) => {
        messages.streamingAppend({
          id: 'stream-1',
          sessionId: 's1',
          role: 'assistant',
          chunk,
        });
      }),
    );

    const final = messages.findById('stream-1');
    expect(typeof final?.content).toBe('string');
    expect((final?.content as string).length).toBe(5);
    expect((final?.content as string).split('').sort().join('')).toBe('ABCDE');

    manager.close();
  });

  it('supports token usage insert and aggregate queries', () => {
    let nowValue = Date.parse('2026-02-21T01:00:00.000Z');
    const now = (): number => nowValue;
    const { manager, sessions, tokenUsage } = createInMemoryDb(now);

    sessions.create({
      id: 's1',
      projectPath: '/repo/a',
      model: 'gpt-4o',
      provider: 'openai',
    });

    tokenUsage.insert({
      id: 'u1',
      sessionId: 's1',
      model: 'gpt-4o',
      provider: 'openai',
      role: 'assistant',
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      costUsd: 0.01,
    });

    nowValue = Date.parse('2026-02-21T02:00:00.000Z');
    tokenUsage.insert({
      id: 'u2',
      sessionId: 's1',
      model: 'gpt-4o',
      provider: 'openai',
      role: 'assistant',
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      costUsd: 0.001,
      toolCallCount: 1,
    });

    const sessionAgg = tokenUsage.sumBySession('s1');
    expect(sessionAgg.totalTokens).toBe(33);
    expect(sessionAgg.costUsd).toBeCloseTo(0.011);
    expect(sessionAgg.toolCallCount).toBe(1);

    const dayAgg = tokenUsage.sumByDay('2026-02-21');
    expect(dayAgg.totalTokens).toBe(33);

    const modelAgg = tokenUsage.sumByModel('gpt-4o');
    expect(modelAgg.promptTokens).toBe(11);

    manager.close();
  });

  it('throws on invalid day format in sumByDay', () => {
    const now = (): number => Date.now();
    const { manager, tokenUsage } = createInMemoryDb(now);

    expect(() => tokenUsage.sumByDay('not-a-date')).toThrowError('invalid day format');

    manager.close();
  });

  it('throws when inserted token usage row cannot be loaded back', () => {
    const now = (): number => Date.now();
    const { manager, sessions, tokenUsage } = createInMemoryDb(now);

    sessions.create({
      id: 's1',
      projectPath: '/repo/a',
      model: 'gpt-4o',
      provider: 'openai',
    });

    // Drop the table after prepare but before get by mocking findById
    // We need to make findById return undefined after insert
    const originalFindById = tokenUsage.findById.bind(tokenUsage);
    tokenUsage.findById = () => undefined;

    expect(() =>
      tokenUsage.insert({
        id: 'u-fail',
        sessionId: 's1',
        model: 'gpt-4o',
        provider: 'openai',
        role: 'assistant',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        costUsd: 0.001,
      }),
    ).toThrowError('failed to load inserted token usage');

    tokenUsage.findById = originalFindById;
    manager.close();
  });

  it('lists sessions without status filter', () => {
    let nowValue = 1700000050000;
    const now = (): number => nowValue++;
    const { manager, sessions } = createInMemoryDb(now);

    sessions.create({
      id: 's1',
      projectPath: '/repo/a',
      model: 'gpt-4o',
      provider: 'openai',
    });
    sessions.create({
      id: 's2',
      projectPath: '/repo/b',
      model: 'gpt-4o',
      provider: 'openai',
    });

    const all = sessions.list({ limit: 10, offset: 0 });
    expect(all.length).toBe(2);

    manager.close();
  });

  it('returns session when update has no meaningful fields', () => {
    let nowValue = 1700000060000;
    const now = (): number => nowValue++;
    const { manager, sessions } = createInMemoryDb(now);

    sessions.create({
      id: 's-noop',
      projectPath: '/repo/a',
      model: 'gpt-4o',
      provider: 'openai',
    });

    // Update with empty patch - only updatedAt from default
    const result = sessions.update('s-noop', {});
    expect(result?.id).toBe('s-noop');

    manager.close();
  });

  it('searches messages across all sessions without sessionId', () => {
    let nowValue = 1700000070000;
    const now = (): number => nowValue++;
    const { manager, sessions, messages } = createInMemoryDb(now);

    sessions.create({ id: 's1', projectPath: '/repo/a', model: 'gpt-4o', provider: 'openai' });
    messages.append({ id: 'm1', sessionId: 's1', role: 'user', content: 'keyword search test' });

    const results = messages.searchByContent('keyword');
    expect(results.length).toBeGreaterThanOrEqual(1);

    manager.close();
  });

  it('handles parseMessageContent fallback for non-JSON content', () => {
    let nowValue = 1700000080000;
    const now = (): number => nowValue++;
    const { manager, sessions, messages } = createInMemoryDb(now);

    sessions.create({ id: 's1', projectPath: '/repo/a', model: 'gpt-4o', provider: 'openai' });

    const db = manager.getConnection();
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at)
      VALUES ('m-raw', 's1', 'user', 'plain text not json', ${nowValue})
    `).run();

    const found = messages.findById('m-raw');
    expect(found?.content).toBe('plain text not json');

    manager.close();
  });

  it('stores encrypted message content when encryption key is configured', () => {
    let nowValue = 1700000030000;
    const now = (): number => nowValue++;
    const { manager, sessions } = createInMemoryDb(now);
    const db = manager.getConnection();
    const encryptedMessages = new MessageRepository(db, {
      now,
      encryptionKey: 'unit-test-encryption-key',
    });

    sessions.create({
      id: 's-encrypted',
      projectPath: '/repo/encrypted',
      model: 'gpt-4o',
      provider: 'openai',
    });

    encryptedMessages.append({
      id: 'm-encrypted',
      sessionId: 's-encrypted',
      role: 'user',
      content: { text: 'sensitive secret payload' },
    });

    const raw = db.prepare('SELECT content FROM messages WHERE id = ?').get('m-encrypted') as
      | { content: string }
      | undefined;
    expect(raw?.content.startsWith('enc:v1:')).toBe(true);
    expect(raw?.content.includes('sensitive secret payload')).toBe(false);

    const loaded = encryptedMessages.findById('m-encrypted');
    expect(loaded?.content).toEqual({ text: 'sensitive secret payload' });

    manager.close();
  });
});
