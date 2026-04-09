import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MemoryManager } from '../manager/memory-manager.js';
import { MemoryDatabaseManager } from '../db/database.js';
import { ObservationStore } from '../db/observation-store.js';
import { QueueStore } from '../db/queue-store.js';
import { MemSessionStore } from '../db/session-store.js';
import { SessionSummaryStore } from '../db/summary-store.js';
import { QueueProcessor } from '../queue/queue-processor.js';

const tempDirs: string[] = [];

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mem-int-'));
  tempDirs.push(dir);
  return path.join(dir, 'memory.db');
}

function createMockDriver(): {
  chat: (request: {
    messages: readonly Array<{
      role: 'system' | 'user' | 'assistant';
      content: string | null;
    }>;
  }) => Promise<{ message: { content: string } }>;
} {
  return {
    chat: async (request) => {
      const system = request.messages[0]?.content ?? '';
      const user = request.messages[1]?.content ?? '';
      const source = typeof user === 'string' ? user.replace(/\s+/g, ' ').trim() : '';
      if (typeof system === 'string' && system.includes('memory extraction engine')) {
        const title = source.includes('oauth')
          ? 'Harden oauth callback gate'
          : 'Harden websocket token gate';
        const narrative = source.length > 0 ? `observed: ${source}` : 'observed: empty';
        return {
          message: {
            content: [
              '<observation>',
              '<type>bugfix</type>',
              `<title>${title}</title>`,
              `<narrative>${narrative}</narrative>`,
              `<facts><item>${narrative}</item></facts>`,
              '<concepts><item>websocket</item><item>security</item></concepts>',
              '<files_read><item>server.ts</item></files_read>',
              '<files_modified><item>security.ts</item></files_modified>',
              '</observation>',
            ].join(''),
          },
        };
      }

      return {
        message: {
          content: [
            '<summary>',
            `<request>${source}</request>`,
            '<investigated>queue processing</investigated>',
            '<learned>stale processing needs reset</learned>',
            '<completed>added integration tests</completed>',
            '<next_steps>hook into runtime</next_steps>',
            '</summary>',
          ].join(''),
        },
      };
    },
  };
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('xifan-mem integration flow', () => {
  it('processes PostToolUse queue item and makes observation searchable', async () => {
    const dbPath = makeTempDbPath();
    const manager = new MemoryManager({
      dbPath,
      allowExternalDbPath: true,
      defaultProject: '/repo/demo',
      llmDriver: createMockDriver(),
    });

    try {
      manager.logPrompt('please secure websocket', 'sess-A', '/repo/demo');
      manager.observe('bash_execute', 'patched security.ts', {
        sessionId: 'sess-A',
        project: '/repo/demo',
        promptNumber: 1,
      });

      expect(manager.search('websocket', { project: '/repo/demo' })).toHaveLength(0);
      await manager.processQueueOnce();

      const results = manager.search('websocket', { project: '/repo/demo' });
      expect(results).toHaveLength(1);
      expect(results[0]?.title).toContain('websocket');
    } finally {
      manager.close();
    }
  });

  it('supports cross-session recall in the same project', async () => {
    const dbPath = makeTempDbPath();
    const manager = new MemoryManager({
      dbPath,
      allowExternalDbPath: true,
      defaultProject: '/repo/demo',
      llmDriver: createMockDriver(),
      injectMaxTokens: 500,
    });

    try {
      manager.logPrompt('session A prompt', 'sess-A', '/repo/demo');
      manager.observe('bash_execute', 'websocket gate changed', {
        sessionId: 'sess-A',
        project: '/repo/demo',
        promptNumber: 1,
      });
      await manager.processQueueOnce();

      manager.logPrompt('session B prompt', 'sess-B', '/repo/demo');
      const injection = manager.recall('websocket', '/repo/demo', 5);

      expect(injection).toContain('<xifan-memory project="/repo/demo">');
      expect(injection).toContain('Harden websocket token gate');
    } finally {
      manager.close();
    }
  });

  it('recovers stale processing jobs on restart and finishes them', async () => {
    const dbPath = makeTempDbPath();
    const nowBase = Date.now();
    let nowValue = nowBase;
    const now = (): number => ++nowValue;

    const dbManager = new MemoryDatabaseManager({ dbPath, now, allowExternalDbPath: true });
    dbManager.migrate();
    const db = dbManager.getConnection();
    const sessions = new MemSessionStore(db, { now });
    const queue = new QueueStore(db, { now });
    const observations = new ObservationStore(db, { now });
    const summaries = new SessionSummaryStore(db, { now });

    const memSession = sessions.create({
      id: 'mem-1',
      sessionId: 'sess-A',
      project: '/repo/demo',
      userPrompt: 'seed',
    });

    queue.enqueue({
      id: 'stale-observe-1',
      type: 'observation',
      status: 'processing',
      claimedAt: nowBase - 10 * 60 * 1000,
      payload: JSON.stringify({
        kind: 'observation',
        memSessionId: memSession.id,
        project: '/repo/demo',
        promptNumber: 1,
        sourceText: 'websocket result',
      }),
    });

    const processor = new QueueProcessor(
      createMockDriver(),
      queue,
      observations,
      summaries,
      {
        now,
        pollIntervalMs: 1,
        idlePauseMs: 0,
        sleep: async () => {},
      },
    );

    await processor.start();

    expect(queue.listByStatus('processing')).toHaveLength(0);
    expect(observations.findByProject('/repo/demo')).toHaveLength(1);

    dbManager.close();
  });

  it('persists Stop hook summary records and keeps private content out of summary payload', async () => {
    const dbPath = makeTempDbPath();
    const manager = new MemoryManager({
      dbPath,
      allowExternalDbPath: true,
      defaultProject: '/repo/demo',
      llmDriver: createMockDriver(),
    });

    try {
      manager.logPrompt('session stop test', 'sess-stop', '/repo/demo');
      manager.summarize('final note <private>token-123</private>', {
        sessionId: 'sess-stop',
        project: '/repo/demo',
      });
      await manager.processQueueOnce();
    } finally {
      manager.close();
    }

    const dbManager = new MemoryDatabaseManager({ dbPath, allowExternalDbPath: true });
    dbManager.migrate();
    const summaries = new SessionSummaryStore(dbManager.getConnection());
    const latest = summaries.findLatestByProject('/repo/demo');
    expect(latest).toBeDefined();
    expect(latest?.request).toContain('[REDACTED]');
    expect(latest?.request).not.toContain('token-123');
    dbManager.close();
  });

  it('keeps search timeline getObservations results consistent after queued observations', async () => {
    const dbPath = makeTempDbPath();
    const manager = new MemoryManager({
      dbPath,
      allowExternalDbPath: true,
      defaultProject: '/repo/demo',
      llmDriver: createMockDriver(),
    });

    try {
      manager.logPrompt('seed prompt', 'sess-consistency', '/repo/demo');
      manager.observe('bash_execute', 'websocket policy step one', {
        sessionId: 'sess-consistency',
        project: '/repo/demo',
        promptNumber: 1,
      });
      manager.observe('bash_execute', 'oauth policy step two', {
        sessionId: 'sess-consistency',
        project: '/repo/demo',
        promptNumber: 2,
      });
      await manager.processQueueOnce();
      await manager.processQueueOnce();

      const search = manager.search('policy', { project: '/repo/demo', limit: 10 });
      expect(search.length).toBeGreaterThanOrEqual(2);

      const anchor = search[0];
      expect(anchor).toBeDefined();
      const timeline = manager.timeline(anchor?.id ?? '', 2);
      expect(timeline.length).toBeGreaterThanOrEqual(2);
      expect(timeline.some((item) => item.id === anchor?.id)).toBe(true);

      const full = manager.getObservations(search.map((item) => item.id));
      const searchIds = [...search.map((item) => item.id)].sort();
      const fullIds = [...full.map((item) => item.id)].sort();
      expect(fullIds).toEqual(searchIds);
    } finally {
      manager.close();
    }
  });

  it('does not persist private tag secrets into observation records', async () => {
    const dbPath = makeTempDbPath();
    const manager = new MemoryManager({
      dbPath,
      allowExternalDbPath: true,
      defaultProject: '/repo/demo',
      llmDriver: createMockDriver(),
    });

    try {
      manager.logPrompt('private data test', 'sess-private', '/repo/demo');
      manager.observe('bash_execute', 'api_key=<private>topsecretkey</private>', {
        sessionId: 'sess-private',
        project: '/repo/demo',
        promptNumber: 1,
      });
      await manager.processQueueOnce();

      const bySecret = manager.search('topsecretkey', { project: '/repo/demo' });
      expect(bySecret).toHaveLength(0);

      const all = manager.search('', { project: '/repo/demo', limit: 20 });
      const observations = manager.getObservations(all.map((item) => item.id));
      expect(observations.length).toBeGreaterThan(0);
      expect(observations.some((item) => item.narrative.includes('[REDACTED]'))).toBe(true);
      expect(observations.some((item) => item.narrative.includes('topsecretkey'))).toBe(false);
    } finally {
      manager.close();
    }
  });
});
