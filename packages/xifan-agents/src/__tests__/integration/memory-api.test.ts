import { describe, it, expect, vi } from 'vitest';

import type { Pool } from 'pg';
import { findAvailablePort, resolvePort, startMemoryApi } from '../../integration/memory-api.js';

describe('findAvailablePort', () => {
  it('returns the start port when available', async () => {
    const port = await findAvailablePort(19000);
    expect(port).toBeGreaterThanOrEqual(19000);
    expect(port).toBeLessThan(19100);
  });

  it('throws when no port available in range', async () => {
    // Spy on net.createServer to always emit error (port unavailable)
    const net = await import('node:net');
    const spy = vi.spyOn(net.default, 'createServer').mockImplementation(
      () => {
        const server = {
          once: (event: string, cb: () => void) => {
            if (event === 'error') setTimeout(cb, 0);
            return server;
          },
          listen: () => server,
          close: () => {},
        } as unknown as ReturnType<typeof net.default.createServer>;
        return server;
      },
    );

    await expect(findAvailablePort(20000)).rejects.toThrow('No available port');
    spy.mockRestore();
  });
});

describe('resolvePort', () => {
  it('uses XIFAN_AGENTS_API_PORT env var when set', async () => {
    process.env['XIFAN_AGENTS_API_PORT'] = '9999';
    const port = await resolvePort();
    expect(port).toBe(9999);
    delete process.env['XIFAN_AGENTS_API_PORT'];
  });

  it('auto-discovers port when env var not set', async () => {
    delete process.env['XIFAN_AGENTS_API_PORT'];
    const port = await resolvePort();
    expect(port).toBeGreaterThanOrEqual(8090);
  });
});

describe('POST /api/v1/events', () => {
  it('records tool_call event and returns { ok: true }', async () => {
    process.env['XIFAN_AGENTS_API_PORT'] = '0';
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;
    const { port, server } = await startMemoryApi(mockPool);
    delete process.env['XIFAN_AGENTS_API_PORT'];

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'sess-tool-1',
          eventType: 'tool_call',
          toolName: 'Read',
          payload: { input: { file_path: '/foo.ts' }, response: { content: 'ok' } },
          cwd: '/project',
          model: 'claude-sonnet',
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true });
      // session upsert was called
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO xifan_obs.sessions'),
        expect.arrayContaining(['sess-tool-1']),
      );
    } finally {
      server.close();
    }
  });

  it('marks session completed on session_end', async () => {
    process.env['XIFAN_AGENTS_API_PORT'] = '0';
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;
    const { port, server } = await startMemoryApi(mockPool);
    delete process.env['XIFAN_AGENTS_API_PORT'];

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess-end-1', eventType: 'session_end' }),
      });
      expect(res.status).toBe(200);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("status = 'completed'"),
        expect.arrayContaining(['sess-end-1']),
      );
    } finally {
      server.close();
    }
  });

  it('returns 400 when sessionId is missing', async () => {
    process.env['XIFAN_AGENTS_API_PORT'] = '0';
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;
    const { port, server } = await startMemoryApi(mockPool);
    delete process.env['XIFAN_AGENTS_API_PORT'];

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'tool_call' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    } finally {
      server.close();
    }
  });

  it('returns 401 when API key is required but not provided', async () => {
    process.env['XIFAN_AGENTS_API_PORT'] = '0';
    process.env['XIFAN_AGENTS_API_KEY'] = 'secret-key';
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;
    const { port, server } = await startMemoryApi(mockPool);
    delete process.env['XIFAN_AGENTS_API_PORT'];
    delete process.env['XIFAN_AGENTS_API_KEY'];

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No Authorization header
        body: JSON.stringify({ sessionId: 'sess-auth', eventType: 'tool_call' }),
      });
      expect(res.status).toBe(401);
    } finally {
      server.close();
    }
  });
});
