import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlerRegistry = new Map<symbol, (request: any) => Promise<unknown>>();
const connectSpy = vi.fn();
const closeSpy = vi.fn();

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  class MockServer {
    setRequestHandler(schema: symbol, handler: (request: any) => Promise<unknown>): void {
      handlerRegistry.set(schema, handler);
    }

    async connect(transport: unknown): Promise<void> {
      connectSpy(transport);
    }

    async close(): Promise<void> {
      closeSpy();
    }
  }

  return { Server: MockServer };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  class MockStdioServerTransport {}
  return { StdioServerTransport: MockStdioServerTransport };
});

vi.mock('@modelcontextprotocol/sdk/types.js', () => {
  return {
    ListToolsRequestSchema: Symbol.for('ListToolsRequestSchema'),
    CallToolRequestSchema: Symbol.for('CallToolRequestSchema'),
  };
});

import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { XifanMemoryMcpServer } from '../mcp-server.js';

describe('XifanMemoryMcpServer runtime handlers', () => {
  beforeEach(() => {
    handlerRegistry.clear();
    connectSpy.mockClear();
    closeSpy.mockClear();
  });

  it('starts once and handles list_tools/call_tool requests', async () => {
    const manager = {
      search: vi.fn().mockResolvedValue([{ id: 'obs-1' }]),
      timeline: vi.fn().mockResolvedValue([]),
      getObservations: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue({ id: 'saved-1' }),
    };
    const server = new XifanMemoryMcpServer({ memoryManager: manager });

    const status1 = await server.start();
    const status2 = await server.start();
    expect(status1.started).toBe(true);
    expect(status1.toolCount).toBe(4);
    expect(status2.transport).toBe('stdio');
    expect(connectSpy).toHaveBeenCalledTimes(1);

    const listHandler = handlerRegistry.get(ListToolsRequestSchema);
    expect(listHandler).toBeDefined();
    const listResponse = (await listHandler?.({})) as { tools: Array<{ name: string }> };
    expect(listResponse.tools.map((tool) => tool.name)).toEqual([
      'search',
      'timeline',
      'get_observations',
      'save',
    ]);

    const callHandler = handlerRegistry.get(CallToolRequestSchema);
    expect(callHandler).toBeDefined();
    const callResponse = (await callHandler?.({
      params: { name: 'search', arguments: { query: 'auth' } },
    })) as { content: Array<{ text: string }> };
    expect(callResponse.content[0]?.text).toBe(JSON.stringify([{ id: 'obs-1' }]));

    await server.stop();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
