import { describe, it, expect, vi } from 'vitest';
import { parseHookPayload, sendEvent } from '../../scripts/hook-recorder-core.js';

describe('parseHookPayload', () => {
  it('parses PostToolUse payload', () => {
    const raw = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/foo.ts' },
      tool_response: { content: 'file content' },
    });
    const result = parseHookPayload(raw);
    expect(result.toolName).toBe('Read');
    expect(result.eventType).toBe('tool_call');
  });

  it('parses Stop payload', () => {
    const raw = JSON.stringify({ hook_event_name: 'Stop' });
    const result = parseHookPayload(raw);
    expect(result.eventType).toBe('session_end');
  });
});

describe('sendEvent', () => {
  it('calls fetch with correct URL, body, and Authorization header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', mockFetch);

    await sendEvent('http://localhost:8090', 'my-api-key', {
      sessionId: 'sess-1',
      eventType: 'tool_call',
      toolName: 'Read',
      payload: { input: { file_path: '/foo.ts' }, response: { content: 'ok' } },
      cwd: '/project',
      model: 'claude-sonnet',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8090/api/v1/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer my-api-key',
        }),
      }),
    );
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(opts.body as string);
    expect(sent.sessionId).toBe('sess-1');
    expect(sent.eventType).toBe('tool_call');
    expect(sent.toolName).toBe('Read');

    vi.unstubAllGlobals();
  });

  it('omits Authorization header when apiKey is undefined', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', mockFetch);

    await sendEvent('http://localhost:8090', undefined, {
      sessionId: 'sess-2',
      eventType: 'session_end',
    });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('propagates fetch errors to caller', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      sendEvent('http://localhost:8090', undefined, {
        sessionId: 'sess-3',
        eventType: 'tool_call',
      }),
    ).rejects.toThrow('network error');

    vi.unstubAllGlobals();
  });

  it('throws when Memory API returns non-ok HTTP status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      sendEvent('http://localhost:8090', undefined, {
        sessionId: 'sess-4',
        eventType: 'tool_call',
      }),
    ).rejects.toThrow('401');

    vi.unstubAllGlobals();
  });
});
