import { describe, expect, it } from 'vitest';

import { MemoryManager } from '../memory-manager.js';

function createManager(overrides: Partial<ConstructorParameters<typeof MemoryManager>[0]> = {}): MemoryManager {
  let counter = 0;
  let nowValue = 1700000000000;
  return new MemoryManager({
    dbPath: ':memory:',
    defaultProject: '/repo/demo',
    now: () => ++nowValue,
    idGenerator: () => `id-${++counter}`,
    ...overrides,
  });
}

describe('MemoryManager', () => {
  it('formats recall injection with xifan-memory tag and truncates by token budget', () => {
    const small = createManager({ injectMaxTokens: 40 });
    const large = createManager({ injectMaxTokens: 400 });
    try {
      const seed = (manager: MemoryManager): void => {
        manager.save(
          'websocket auth fix with long narrative '.repeat(12),
          'auth-entry',
          { project: '/repo/demo', type: 'bugfix' },
        );
        manager.save(
          'auth short',
          'auth-entry',
          { project: '/repo/demo', type: 'bugfix' },
        );
      };
      seed(small);
      seed(large);

      const smallInjection = small.recall('auth', '/repo/demo', 10);
      const largeInjection = large.recall('auth', '/repo/demo', 10);

      expect(largeInjection.startsWith('<xifan-memory project="/repo/demo">')).toBe(true);
      expect(largeInjection.endsWith('</xifan-memory>')).toBe(true);
      expect((largeInjection.match(/facts:/g) ?? []).length).toBeGreaterThan(0);
      expect(smallInjection.length).toBeLessThanOrEqual(largeInjection.length);
      expect((smallInjection.match(/facts:/g) ?? []).length).toBeLessThanOrEqual(
        (largeInjection.match(/facts:/g) ?? []).length,
      );
    } finally {
      small.close();
      large.close();
    }
  });

  it('enqueues observation job without blocking', () => {
    const manager = createManager();
    try {
      manager.logPrompt('initial prompt', 'sess-1', '/repo/demo');
      const queued = manager.observe('bash_execute', 'stdout=ok', {
        sessionId: 'sess-1',
        project: '/repo/demo',
        promptNumber: 1,
      });

      expect(queued.status).toBe('pending');
      expect(manager.listQueue('pending')).toHaveLength(1);
    } finally {
      manager.close();
    }
  });

  it('supports search filters, timeline, and getObservations three-step retrieval', () => {
    const manager = createManager({ injectMaxTokens: 500 });
    try {
      const o1 = manager.save('websocket intro', 'ws-1', {
        project: '/repo/demo',
        type: 'bugfix',
        filesModified: ['a.ts'],
      });
      const o2 = manager.save('websocket refined', 'ws-2', {
        project: '/repo/demo',
        type: 'bugfix',
        filesModified: ['a.ts'],
      });
      const o3 = manager.save('unrelated content', 'other', {
        project: '/repo/other',
        type: 'feature',
      });

      const search = manager.search('websocket', {
        project: '/repo/demo',
        type: 'bugfix',
        filePath: 'a.ts',
      });
      expect(search.length).toBeGreaterThanOrEqual(2);
      expect(search.every((item) => item.project === '/repo/demo')).toBe(true);

      const timeline = manager.timeline(o2.id, 1);
      expect(timeline.map((item) => item.id)).toContain(o1.id);
      expect(timeline.map((item) => item.id)).toContain(o2.id);
      expect(timeline.map((item) => item.id)).not.toContain(o3.id);

      const full = manager.getObservations(search.slice(0, 2).map((item) => item.id));
      expect(full).toHaveLength(2);
      expect(full[0]?.narrative.length).toBeGreaterThan(0);
    } finally {
      manager.close();
    }
  });
});
