import { describe, expect, it, vi } from 'vitest';

import { XifanMemoryMcpServer } from '../mcp-server.js';

describe('XifanMemoryMcpServer branch coverage', () => {
  it('throws on unknown tool name', async () => {
    const server = new XifanMemoryMcpServer({
      memoryManager: {
        search: vi.fn(),
        timeline: vi.fn(),
        getObservations: vi.fn(),
        save: vi.fn(),
      },
    });

    await expect(
      server.callTool('nonexistent' as any, {}),
    ).rejects.toThrow('unknown_tool_nonexistent');
  });

  it('handles args that are not objects', async () => {
    const manager = {
      search: vi.fn().mockReturnValue([]),
      timeline: vi.fn().mockReturnValue([]),
      getObservations: vi.fn().mockReturnValue([]),
      save: vi.fn(),
    };
    const server = new XifanMemoryMcpServer({ memoryManager: manager });

    // Calling with null/primitive args should not crash (asRecord handles it)
    await expect(server.callTool('search', null)).rejects.toThrow(
      'search.query must be a non-empty string',
    );
  });

  it('search handles missing filters gracefully', async () => {
    const manager = {
      search: vi.fn().mockReturnValue([{ id: 'o1' }]),
      timeline: vi.fn(),
      getObservations: vi.fn(),
      save: vi.fn(),
    };
    const server = new XifanMemoryMcpServer({ memoryManager: manager });

    const result = await server.callTool('search', { query: 'test' });
    expect(result).toEqual([{ id: 'o1' }]);
    expect(manager.search).toHaveBeenCalledWith('test', {
      project: undefined,
      type: undefined,
      filePath: undefined,
      limit: undefined,
    });
  });

  it('save with missing optional fields', async () => {
    const manager = {
      search: vi.fn(),
      timeline: vi.fn(),
      getObservations: vi.fn(),
      save: vi.fn().mockReturnValue({ id: 'saved-1' }),
    };
    const server = new XifanMemoryMcpServer({ memoryManager: manager });

    const result = await server.callTool('save', {
      text: 'content',
      title: 'title',
    });
    expect(result).toEqual({ id: 'saved-1' });
    expect(manager.save).toHaveBeenCalledWith('content', 'title', {
      project: undefined,
      type: undefined,
      filesRead: [],
      filesModified: [],
    });
  });

  it('get_observations with non-array ids throws', async () => {
    const server = new XifanMemoryMcpServer({
      memoryManager: {
        search: vi.fn(),
        timeline: vi.fn(),
        getObservations: vi.fn(),
        save: vi.fn(),
      },
    });

    await expect(
      server.callTool('get_observations', { ids: 'not-array' }),
    ).rejects.toThrow('get_observations.ids must be a non-empty string array');
  });

  it('timeline without explicit depth uses default', async () => {
    const manager = {
      search: vi.fn(),
      timeline: vi.fn().mockReturnValue([]),
      getObservations: vi.fn(),
      save: vi.fn(),
    };
    const server = new XifanMemoryMcpServer({ memoryManager: manager });

    await server.callTool('timeline', { anchorId: 'abc' });
    expect(manager.timeline).toHaveBeenCalledWith('abc', 2);
  });
});
