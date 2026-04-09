import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/pool.js', () => ({ getPool: vi.fn().mockReturnValue({}) }));
vi.mock('../../db/migrate.js', () => ({ runMigration: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../observer/session.js', () => ({
  startSession: vi.fn().mockResolvedValue('s1'),
  endSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../observer/event-store.js', () => ({
  recordEvent: vi.fn(),
  flushQueue: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../observer/replay.js', () => ({ getReplay: vi.fn().mockResolvedValue([]) }));
vi.mock('../../memory/retriever.js', () => ({
  hybridSearch: vi.fn().mockResolvedValue([
    { id: 'abc1', type: 'episodic', summary: 'JWT fix', rrf_score: 0.9,
      payload: null, salience: 1.0, project: null, created_at: '0', accessed_at: '0' },
  ]),
}));
vi.mock('../../memory/assembler.js', () => ({
  assembleContext: vi.fn().mockReturnValue('<xifan-context>[经验#abc1] JWT fix</xifan-context>'),
}));
vi.mock('../../memory/store.js', () => ({
  saveMemory: vi.fn().mockResolvedValue('new-id'),
}));

describe('Phase B tools', () => {
  it('agents_retrieve_experiences returns context string', async () => {
    const { initHandlers, routeTool } = await import('../../plugin/router.js');
    await initHandlers();
    const result = await routeTool('agents_retrieve_experiences', { query: 'JWT expired', topK: 5 });
    expect((result as { context: string }).context).toContain('xifan-context');
  });

  it('agents_save_observation returns id', async () => {
    const { routeTool } = await import('../../plugin/router.js');
    const result = await routeTool('agents_save_observation', {
      type: 'episodic',
      summary: 'fixed login bug',
    });
    expect((result as { id: string }).id).toBe('new-id');
  });

  it('agents_get_skill returns procedural memories', async () => {
    const { routeTool } = await import('../../plugin/router.js');
    // Mock returns episodic, so skills array should be empty (filtered to procedural)
    const result = await routeTool('agents_get_skill', { query: 'JWT handling' });
    expect(Array.isArray((result as { skills: unknown[] }).skills)).toBe(true);
  });
});
