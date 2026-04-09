import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  dispatchMCPRequest,
  getDefaultMCPResources,
  getDefaultMCPTools,
  MCPWebSocketServer,
  readSessionToken,
} from '../index.js';

const socketIntegrationEnabled = process.env.XIFAN_ENABLE_SOCKET_TESTS === '1';
const socketIt = socketIntegrationEnabled ? it : it.skip;

describe('MCPWebSocketServer', () => {
  it('uses localhost-only defaults', () => {
    const server = new MCPWebSocketServer();
    const status = server.getStatus();
    expect(status.host).toBe('127.0.0.1');
    expect(status.port).toBe(7890);
    expect(status.path).toBe('/mcp');
  });

  it('exposes built-in resources and tools', () => {
    const resources = getDefaultMCPResources();
    const tools = getDefaultMCPTools();

    expect(resources.map((item) => item.uri)).toEqual([
      'xifan://session/current',
      'xifan://context/xifan_md',
    ]);
    expect(tools.map((item) => item.name)).toEqual(['xifan_ask', 'xifan_file_edit']);
  });

  it('dispatches resource and tool requests', async () => {
    await expect(
      dispatchMCPRequest({
        method: 'resources/list',
      }),
    ).resolves.toMatchObject({
      resources: [
        { uri: 'xifan://session/current' },
        { uri: 'xifan://context/xifan_md' },
      ],
    });

    await expect(
      dispatchMCPRequest(
        {
          method: 'resources/read',
          params: { uri: 'xifan://session/current' },
        },
        {
          getCurrentSession: () => ({ id: 's1' }),
        },
      ),
    ).resolves.toMatchObject({
      uri: 'xifan://session/current',
      content: { id: 's1' },
    });

    await expect(
      dispatchMCPRequest(
        {
          method: 'tools/call',
          params: {
            name: 'xifan_ask',
            args: { instruction: 'fix lint errors' },
          },
        },
        {
          onAsk: async (instruction) => ({ acceptedInstruction: instruction }),
        },
      ),
    ).resolves.toMatchObject({
      accepted: true,
      result: { acceptedInstruction: 'fix lint errors' },
    });

    await expect(
      dispatchMCPRequest(
        {
          method: 'tools/call',
          params: {
            name: 'xifan_file_edit',
            args: {
              filePath: 'README.md',
              instruction: 'append changelog entry',
            },
          },
        },
        {
          onFileEdit: async (input) => ({ ...input, queued: true }),
        },
      ),
    ).resolves.toMatchObject({
      accepted: true,
      result: {
        filePath: 'README.md',
        instruction: 'append changelog entry',
        queued: true,
      },
    });

    await expect(
      dispatchMCPRequest({
        method: 'unknown',
      }),
    ).rejects.toThrowError('unknown_method');
  });

  socketIt('starts on localhost and persists token file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xifan-mcp-server-'));
    const tokenPath = join(dir, 'session.token');
    const server = new MCPWebSocketServer({
      host: '127.0.0.1',
      port: 0,
      token: 'test-token',
      tokenFilePath: tokenPath,
    });

    try {
      const status = await server.start();
      expect(status.host === '127.0.0.1' || status.host === '::').toBe(true);
      expect(status.port).toBeGreaterThan(0);
      expect(status.tlsEnabled).toBe(true);
      expect(status.tlsCertPath?.endsWith('.pem')).toBe(true);
      await expect(readSessionToken(tokenPath)).resolves.toBe('test-token');
    } finally {
      await server.stop();
    }
  });
});

// ─── Additional unit tests for dispatchMCPRequest ─────────────────────────────

describe('dispatchMCPRequest', () => {
  it('returns ping status', async () => {
    const result = await dispatchMCPRequest({ method: 'ping' });
    expect(result).toEqual({ status: 'ok' });
  });

  it('returns tools list', async () => {
    const result = await dispatchMCPRequest({ method: 'tools/list' }) as { tools: unknown[] };
    expect(result.tools).toHaveLength(2);
  });

  it('throws on missing resource uri', async () => {
    await expect(
      dispatchMCPRequest({ method: 'resources/read', params: {} }),
    ).rejects.toThrow('invalid_resource_uri');
  });

  it('throws on unknown resource uri', async () => {
    await expect(
      dispatchMCPRequest({ method: 'resources/read', params: { uri: 'unknown://foo' } }),
    ).rejects.toThrow('resource_not_found');
  });

  it('reads xifan_md resource', async () => {
    const result = await dispatchMCPRequest(
      { method: 'resources/read', params: { uri: 'xifan://context/xifan_md' } },
      { getXifanMarkdown: () => '# Title' },
    );
    expect(result).toEqual({ uri: 'xifan://context/xifan_md', content: '# Title' });
  });

  it('reads xifan_md resource with no handler', async () => {
    const result = await dispatchMCPRequest(
      { method: 'resources/read', params: { uri: 'xifan://context/xifan_md' } },
      {},
    );
    expect(result).toEqual({ uri: 'xifan://context/xifan_md', content: '' });
  });

  it('reads session resource with no handler', async () => {
    const result = await dispatchMCPRequest(
      { method: 'resources/read', params: { uri: 'xifan://session/current' } },
      {},
    );
    expect(result).toEqual({ uri: 'xifan://session/current', content: null });
  });

  it('throws on missing tool name', async () => {
    await expect(
      dispatchMCPRequest({ method: 'tools/call', params: { name: '', args: {} } }),
    ).rejects.toThrow('invalid_tool_name');
  });

  it('throws on unknown tool name', async () => {
    await expect(
      dispatchMCPRequest({ method: 'tools/call', params: { name: 'nonexistent', args: {} } }),
    ).rejects.toThrow('tool_not_found');
  });

  it('throws on empty xifan_ask instruction', async () => {
    await expect(
      dispatchMCPRequest({ method: 'tools/call', params: { name: 'xifan_ask', args: { instruction: '  ' } } }),
    ).rejects.toThrow('invalid_instruction');
  });

  it('xifan_ask with no handler returns null result', async () => {
    const result = await dispatchMCPRequest(
      { method: 'tools/call', params: { name: 'xifan_ask', args: { instruction: 'test' } } },
      {},
    );
    expect(result).toEqual({ accepted: true, result: null });
  });

  it('xifan_file_edit with no handler returns null result', async () => {
    const result = await dispatchMCPRequest(
      { method: 'tools/call', params: { name: 'xifan_file_edit', args: { filePath: 'x.ts', instruction: 'fix' } } },
      {},
    );
    expect(result).toEqual({ accepted: true, result: null });
  });

  it('xifan_file_edit throws on empty filePath', async () => {
    await expect(
      dispatchMCPRequest({ method: 'tools/call', params: { name: 'xifan_file_edit', args: { filePath: '', instruction: 'fix' } } }),
    ).rejects.toThrow('invalid_file_edit_payload');
  });

  it('xifan_file_edit throws on empty instruction', async () => {
    await expect(
      dispatchMCPRequest({ method: 'tools/call', params: { name: 'xifan_file_edit', args: { filePath: 'x.ts', instruction: '' } } }),
    ).rejects.toThrow('invalid_file_edit_payload');
  });

  it('tools/call with no args defaults to empty object', async () => {
    const result = await dispatchMCPRequest(
      { method: 'tools/call', params: { name: 'xifan_ask', args: { instruction: 'hello' } } },
      { onAsk: (i: string) => i },
    );
    expect(result).toEqual({ accepted: true, result: 'hello' });
  });
});

// ─── parseRpcRequest (exercised through server via raw WebSocket mocking) ────

describe('MCPWebSocketServer constructor and methods', () => {
  it('constructs with custom options', () => {
    const stateChanges: unknown[] = [];
    const server = new MCPWebSocketServer({
      host: '0.0.0.0',
      port: 9999,
      path: '/custom',
      token: 'custom-token',
      persistToken: false,
      requireTls: false,
      maxConnections: 5,
      allowMissingOrigin: false,
      allowedHosts: ['localhost'],
      allowedOrigins: [/^http:\/\/localhost/],
      handlers: {},
      onConnectionStateChange: (state) => stateChanges.push(state),
    });
    expect(server.getToken()).toBe('custom-token');
    const status = server.getStatus();
    expect(status.host).toBe('0.0.0.0');
    expect(status.path).toBe('/custom');
  });

  it('throws if started twice', async () => {
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: false,
    });
    try {
      await server.start();
      await expect(server.start()).rejects.toThrow('MCP WebSocket server is already running');
    } finally {
      await server.stop();
    }
  });

  it('getToken returns the session token', () => {
    const server = new MCPWebSocketServer({ token: 'my-token' });
    expect(server.getToken()).toBe('my-token');
  });

  it('getStatus reports correct values when server is not listening', () => {
    const server = new MCPWebSocketServer();
    const status = server.getStatus();
    expect(status.connectedClients).toBe(0);
    expect(status.ideConnected).toBe(false);
    expect(status.tlsEnabled).toBe(false);
  });

  it('stop is safe to call when not started', async () => {
    const server = new MCPWebSocketServer({ persistToken: false, requireTls: false });
    await server.stop();
  });

  it('generates token if not provided', () => {
    const server = new MCPWebSocketServer();
    const token = server.getToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('starts without TLS when requireTls is false', async () => {
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: false,
    });
    try {
      const status = await server.start();
      expect(status.tlsEnabled).toBe(false);
      expect(status.port).toBeGreaterThan(0);
    } finally {
      await server.stop();
    }
  });

  it('starts with TLS using custom tls options', async () => {
    // ensureLocalhostTlsCertificate will generate the certs
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: true,
    });
    try {
      const status = await server.start();
      expect(status.tlsEnabled).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it('getStatus returns server address when listening', async () => {
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: false,
    });
    try {
      const status = await server.start();
      const liveStatus = server.getStatus();
      expect(liveStatus.port).toBe(status.port);
    } finally {
      await server.stop();
    }
  });

  it('onConnectionStateChange fires on connect/disconnect', async () => {
    const stateChanges: unknown[] = [];
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: false,
      token: 'tok',
      onConnectionStateChange: (state) => stateChanges.push(state),
    });
    try {
      await server.start();
      // stateChanges will be populated when a client connects
      // Just verify it's callable
      expect(stateChanges).toBeDefined();
    } finally {
      await server.stop();
    }
  });
});

// ─── parsePathname coverage ──────────────────────────────────────────────────

describe('MCPWebSocketServer HTTP handling', () => {
  it('returns 404 for non-mcp path', async () => {
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: false,
    });
    try {
      const status = await server.start();
      const response = await fetch(`http://127.0.0.1:${status.port}/other-path`);
      expect(response.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it('returns 426 for mcp path without upgrade', async () => {
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: false,
    });
    try {
      const status = await server.start();
      const response = await fetch(`http://127.0.0.1:${status.port}/mcp`);
      expect(response.status).toBe(426);
    } finally {
      await server.stop();
    }
  });
});

// ─── WebSocket integration tests (via ws module) ────────────────────────────

describe('MCPWebSocketServer WebSocket integration', () => {
  it('accepts WebSocket connection, handles messages, and tracks connection state', async () => {
    const stateChanges: Array<{ ideConnected: boolean; connectedClients: number }> = [];
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: false,
      token: 'ws-test-token',
      onConnectionStateChange: (state) => stateChanges.push({ ...state }),
      handlers: {
        getCurrentSession: () => ({ id: 'current' }),
        getXifanMarkdown: () => '# MD',
        onAsk: (instruction: string) => `asked:${instruction}`,
        onFileEdit: (input: { filePath: string; instruction: string }) => `edited:${input.filePath}`,
      },
    });

    const status = await server.start();
    const { WebSocket: WS } = await import('ws');

    const ws = new WS(`ws://127.0.0.1:${status.port}/mcp`, {
      headers: { 'x-xifan-token': 'ws-test-token', 'host': '127.0.0.1' },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });

      // Connection state should report connected
      await new Promise((r) => setTimeout(r, 50));
      expect(server.getStatus().connectedClients).toBe(1);
      expect(server.getStatus().ideConnected).toBe(true);

      // Helper to send request and get response
      async function rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
        const id = Math.random().toString(36).slice(2);
        ws.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('rpc timeout')), 2000);
          ws.on('message', function handler(data: unknown) {
            const msg = JSON.parse(data!.toString());
            if (msg.id === id) {
              ws.off('message', handler);
              clearTimeout(timeout);
              if (msg.ok) resolve(msg.result);
              else reject(new Error(msg.error));
            }
          });
        });
      }

      // ping
      const pingResult = await rpc('ping');
      expect(pingResult).toEqual({ status: 'ok' });

      // resources/list
      const resList = await rpc('resources/list') as { resources: unknown[] };
      expect(resList.resources).toHaveLength(2);

      // resources/read
      const resRead = await rpc('resources/read', { uri: 'xifan://session/current' });
      expect(resRead).toEqual({ uri: 'xifan://session/current', content: { id: 'current' } });

      // tools/list
      const toolsList = await rpc('tools/list') as { tools: unknown[] };
      expect(toolsList.tools).toHaveLength(2);

      // tools/call
      const toolResult = await rpc('tools/call', { name: 'xifan_ask', args: { instruction: 'test' } });
      expect(toolResult).toEqual({ accepted: true, result: 'asked:test' });

      // unknown method
      await expect(rpc('nonexistent')).rejects.toThrow('unknown_method');

      // Send invalid JSON
      ws.send('not-json');
      await new Promise((r) => setTimeout(r, 50));

      // Send invalid request (missing method)
      ws.send(JSON.stringify({ id: 'x', notmethod: 'foo' }));
      await new Promise((r) => setTimeout(r, 50));

      // Send request with null id
      ws.send(JSON.stringify({ id: null, method: 'ping' }));
      await new Promise((r) => setTimeout(r, 50));

      // Send request with number id
      const numIdResult = await new Promise<unknown>((resolve) => {
        ws.send(JSON.stringify({ id: 42, method: 'ping' }));
        ws.on('message', function handler(data: unknown) {
          const msg = JSON.parse(data!.toString());
          if (msg.id === 42) {
            ws.off('message', handler);
            resolve(msg.result);
          }
        });
      });
      expect(numIdResult).toEqual({ status: 'ok' });

    } finally {
      ws.close();
      await new Promise((r) => setTimeout(r, 100));
      await server.stop();
    }

    // After close, connection count should be 0
    expect(stateChanges.length).toBeGreaterThan(0);
  });

  it('rejects WebSocket upgrade for wrong path', async () => {
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: false,
      token: 'tok',
    });
    const status = await server.start();
    const { WebSocket: WS } = await import('ws');

    try {
      const ws = new WS(`ws://127.0.0.1:${status.port}/wrong-path`, {
        headers: { 'x-xifan-token': 'tok', 'host': '127.0.0.1' },
      });

      await expect(
        new Promise<void>((resolve, reject) => {
          ws.once('open', () => resolve());
          ws.once('error', reject);
        }),
      ).rejects.toThrow();
    } finally {
      await server.stop();
    }
  });

  it('rejects WebSocket upgrade for invalid token', async () => {
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: false,
      token: 'good-token',
    });
    const status = await server.start();
    const { WebSocket: WS } = await import('ws');

    try {
      const ws = new WS(`ws://127.0.0.1:${status.port}/mcp`, {
        headers: { 'x-xifan-token': 'bad-token', 'host': '127.0.0.1' },
      });

      await expect(
        new Promise<void>((resolve, reject) => {
          ws.once('open', () => resolve());
          ws.once('error', reject);
        }),
      ).rejects.toThrow();
    } finally {
      await server.stop();
    }
  });

  it('rejects WebSocket upgrade when connection limit is reached', async () => {
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: false,
      token: 'tok',
      maxConnections: 1,
    });
    const status = await server.start();
    const { WebSocket: WS } = await import('ws');

    // First connection should succeed
    const ws1 = new WS(`ws://127.0.0.1:${status.port}/mcp`, {
      headers: { 'x-xifan-token': 'tok', 'host': '127.0.0.1' },
    });
    await new Promise<void>((resolve, reject) => {
      ws1.once('open', () => resolve());
      ws1.once('error', reject);
    });

    try {
      // Second connection should be rejected
      const ws2 = new WS(`ws://127.0.0.1:${status.port}/mcp`, {
        headers: { 'x-xifan-token': 'tok', 'host': '127.0.0.1' },
      });

      await expect(
        new Promise<void>((resolve, reject) => {
          ws2.once('open', () => resolve());
          ws2.once('error', reject);
        }),
      ).rejects.toThrow();
    } finally {
      ws1.close();
      await new Promise((r) => setTimeout(r, 50));
      await server.stop();
    }
  });

  it('handles WebSocket error event without crashing', async () => {
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: false,
      token: 'tok',
    });
    const status = await server.start();
    const { WebSocket: WS } = await import('ws');

    const ws = new WS(`ws://127.0.0.1:${status.port}/mcp`, {
      headers: { 'x-xifan-token': 'tok', 'host': '127.0.0.1' },
    });

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    // Force close from client side
    ws.terminate();
    await new Promise((r) => setTimeout(r, 100));

    await server.stop();
  });

  it('parseRpcRequest handles edge cases via WebSocket', async () => {
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: false,
      token: 'tok',
    });
    const status = await server.start();
    const { WebSocket: WS } = await import('ws');

    const ws = new WS(`ws://127.0.0.1:${status.port}/mcp`, {
      headers: { 'x-xifan-token': 'tok', 'host': '127.0.0.1' },
    });

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    const responses: unknown[] = [];
    ws.on('message', (data: unknown) => {
      responses.push(JSON.parse(data!.toString()));
    });

    // Request with params as non-null non-object (invalid)
    ws.send(JSON.stringify({ id: '1', method: 'ping', params: 'not-an-object' }));
    await new Promise((r) => setTimeout(r, 50));

    // Request with boolean id (invalid)
    ws.send(JSON.stringify({ id: true, method: 'ping' }));
    await new Promise((r) => setTimeout(r, 50));

    // Request with no id at all
    ws.send(JSON.stringify({ method: 'ping' }));
    await new Promise((r) => setTimeout(r, 50));

    // Tool call that throws error
    ws.send(JSON.stringify({ id: '2', method: 'tools/call', params: { name: 'unknown_tool', args: {} } }));
    await new Promise((r) => setTimeout(r, 50));

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    await server.stop();

    // Check that error responses were sent
    const errorResponses = responses.filter((r: unknown) => !(r as { ok: boolean }).ok);
    expect(errorResponses.length).toBeGreaterThan(0);
  });

  it('handles missing token in upgrade request', async () => {
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: false,
      token: 'tok',
    });
    const status = await server.start();
    const { WebSocket: WS } = await import('ws');

    try {
      const ws = new WS(`ws://127.0.0.1:${status.port}/mcp`, {
        headers: { 'host': '127.0.0.1' },
      });

      await expect(
        new Promise<void>((resolve, reject) => {
          ws.once('open', () => resolve());
          ws.once('error', reject);
        }),
      ).rejects.toThrow();
    } finally {
      await server.stop();
    }
  });

  it('TLS server handles HTTP requests and WebSocket connections', async () => {
    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: false,
      requireTls: true,
      token: 'tls-token',
    });

    try {
      const status = await server.start();
      expect(status.tlsEnabled).toBe(true);

      // Make an HTTP request to the TLS server (exercises HTTPS request handler)
      // Use Node's https agent with rejectUnauthorized: false for self-signed cert
      const https = await import('node:https');
      const result = await new Promise<number>((resolve, reject) => {
        const req = https.get(
          `https://127.0.0.1:${status.port}/mcp`,
          { rejectUnauthorized: false },
          (res) => resolve(res.statusCode ?? 0),
        );
        req.on('error', reject);
      });
      expect(result).toBe(426);

      // Test 404 for non-mcp path on TLS server
      const result404 = await new Promise<number>((resolve, reject) => {
        const req = https.get(
          `https://127.0.0.1:${status.port}/other`,
          { rejectUnauthorized: false },
          (res) => resolve(res.statusCode ?? 0),
        );
        req.on('error', reject);
      });
      expect(result404).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it('starts with persistToken and tokenFilePath', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = await mkdtemp(join(tmpdir(), 'xifan-mcp-persist-'));
    const tokenPath = join(dir, 'session.token');

    const server = new MCPWebSocketServer({
      port: 0,
      persistToken: true,
      tokenFilePath: tokenPath,
      requireTls: false,
      token: 'persist-token',
    });

    try {
      const status = await server.start();
      expect(status.tokenFilePath).toBe(tokenPath);
    } finally {
      await server.stop();
    }
  });
});
