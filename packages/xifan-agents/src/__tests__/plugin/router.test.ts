import { describe, it, expect, vi } from 'vitest';
import { registerHandler, routeTool } from '../../plugin/router.js';

describe('routeTool', () => {
  it('calls registered handler', async () => {
    const handler = vi.fn().mockResolvedValue({ sessionId: 'test-123' });
    registerHandler('agents_session_start', handler);
    const result = await routeTool('agents_session_start', { userInput: 'test' });
    expect(handler).toHaveBeenCalledWith({ userInput: 'test' });
    expect(result).toEqual({ sessionId: 'test-123' });
  });

  it('throws for unknown tool', async () => {
    await expect(routeTool('unknown_tool', {})).rejects.toThrow('Unknown tool: unknown_tool');
  });
});
