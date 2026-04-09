import { describe, expect, it, vi } from 'vitest';

import { XifanMemoryMcpServer } from '../mcp-server.js';

describe('XifanMemoryMcpServer tool mapping', () => {
  it('maps search/timeline/get_observations/save to memory manager', async () => {
    const manager = {
      search: vi.fn().mockReturnValue([{ id: 'o1' }]),
      timeline: vi.fn().mockReturnValue([{ id: 'o1' }, { id: 'o2' }]),
      getObservations: vi.fn().mockReturnValue([{ id: 'o1', title: 'a' }]),
      save: vi.fn().mockReturnValue({ id: 'saved-1' }),
    };

    const server = new XifanMemoryMcpServer({
      memoryManager: manager,
    });

    expect(server.listTools().map((tool) => tool.name)).toEqual([
      'search',
      'timeline',
      'get_observations',
      'save',
    ]);

    const search = await server.callTool('search', {
      query: 'auth',
      filters: {
        project: '/repo/demo',
        limit: 5,
      },
    });
    expect(search).toEqual([{ id: 'o1' }]);
    expect(manager.search).toHaveBeenCalledWith('auth', {
      project: '/repo/demo',
      type: undefined,
      filePath: undefined,
      limit: 5,
    });

    const timeline = await server.callTool('timeline', {
      anchorId: 'o1',
      depth: 2,
    });
    expect(timeline).toEqual([{ id: 'o1' }, { id: 'o2' }]);
    expect(manager.timeline).toHaveBeenCalledWith('o1', 2);

    const observations = await server.callTool('get_observations', {
      ids: ['o1'],
    });
    expect(observations).toEqual([{ id: 'o1', title: 'a' }]);
    expect(manager.getObservations).toHaveBeenCalledWith(['o1']);

    const saved = await server.callTool('save', {
      text: 'manual memory',
      title: 'note',
      project: '/repo/demo',
      type: 'discovery',
      filesRead: ['a.ts'],
      filesModified: ['b.ts'],
    });
    expect(saved).toEqual({ id: 'saved-1' });
    expect(manager.save).toHaveBeenCalledWith('manual memory', 'note', {
      project: '/repo/demo',
      type: 'discovery',
      filesRead: ['a.ts'],
      filesModified: ['b.ts'],
    });
  });

  it('throws on invalid tool arguments', async () => {
    const server = new XifanMemoryMcpServer({
      memoryManager: {
        search: vi.fn(),
        timeline: vi.fn(),
        getObservations: vi.fn(),
        save: vi.fn(),
      },
    });

    await expect(server.callTool('search', {})).rejects.toThrowError(
      'search.query must be a non-empty string',
    );
    await expect(server.callTool('timeline', {})).rejects.toThrowError(
      'timeline.anchorId must be a non-empty string',
    );
    await expect(server.callTool('get_observations', {})).rejects.toThrowError(
      'get_observations.ids must be a non-empty string array',
    );
    await expect(server.callTool('save', { text: '', title: '' })).rejects.toThrowError(
      'save.text and save.title must be non-empty strings',
    );
  });
});
