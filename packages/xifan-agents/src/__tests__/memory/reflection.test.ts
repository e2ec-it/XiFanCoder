import { describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: '反射摘要：JWT 处理模式总结' } }],
  }),
});
vi.stubGlobal('fetch', mockFetch);

describe('reflectOnEpisodics', () => {
  it('generates reflective memory from episodic cluster', async () => {
    const { reflectOnEpisodics } = await import('../../memory/reflection.js');

    const fakePool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            { id: '1', summary: 'JWT fix 1' },
            { id: '2', summary: 'JWT fix 2' },
          ],
        }) // fetchNewEpisodics
        .mockResolvedValue({ rows: [] }), // saveMemory inserts
    };

    await reflectOnEpisodics(fakePool as never, { minCount: 0 });
    expect(fakePool.query).toHaveBeenCalled();
  });
});
