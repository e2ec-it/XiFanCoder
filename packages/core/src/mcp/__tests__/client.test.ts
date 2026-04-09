import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { WebSocketServer } from 'ws';
import { describe, expect, it } from 'vitest';

import { MCPClient } from '../client.js';
import { MCPWebSocketServer } from '../server.js';

const socketIntegrationEnabled = process.env.XIFAN_ENABLE_SOCKET_TESTS === '1';
const socketIt = socketIntegrationEnabled ? it : it.skip;

describe('MCPClient', () => {
  socketIt('connects to websocket MCP server and performs ping/tool/resource calls', async () => {
    const server = new MCPWebSocketServer({
      host: '127.0.0.1',
      port: 0,
      path: '/mcp',
      token: 'token-123',
      persistToken: false,
      requireTls: false,
      handlers: {
        onAsk: async (instruction: string) => `handled:${instruction}`,
        getCurrentSession: async () => ({ id: 's1' }),
      },
    });
    const status = await server.start();
    const client = new MCPClient({
      transport: 'websocket',
      url: `ws://${status.host}:${status.port}${status.path}`,
      token: 'token-123',
    });

    try {
      await client.connect();
      await expect(client.ping()).resolves.toEqual({ status: 'ok' });

      const tools = await client.listTools();
      expect(tools.some((tool) => tool.name === 'xifan_ask')).toBe(true);

      const toolResult = await client.callTool('xifan_ask', {
        instruction: 'hello',
      });
      expect(toolResult).toEqual({
        accepted: true,
        result: 'handled:hello',
      });

      const resources = await client.listResources();
      expect(resources.some((resource) => resource.uri === 'xifan://session/current')).toBe(true);

      const resource = await client.readResource('xifan://session/current');
      expect(resource).toEqual({
        uri: 'xifan://session/current',
        content: { id: 's1' },
      });
    } finally {
      await client.disconnect();
      await server.stop();
    }
  });

  it('supports stdio transport for mcp requests', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mcp-stdio-'));
    const scriptPath = path.join(root, 'stdio-server.mjs');
    fs.writeFileSync(
      scriptPath,
      [
        "import { createInterface } from 'node:readline';",
        "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'rl.on(\'line\', (line) => {',
        '  const req = JSON.parse(line);',
        '  let result = {};',
        '  if (req.method === "ping") result = { status: "ok" };',
        '  if (req.method === "tools/list") result = { tools: [{ name: "mock_tool", description: "x", inputSchema: {} }] };',
        '  if (req.method === "tools/call") result = { accepted: true, echoed: req.params };',
        '  if (req.method === "resources/list") result = { resources: [{ uri: "test://r", description: "r" }] };',
        '  if (req.method === "resources/read") result = { uri: req.params.uri, content: "data" };',
        '  process.stdout.write(JSON.stringify({ id: req.id, ok: true, result }) + "\\n");',
        '});',
      ].join('\n'),
      'utf8',
    );

    const client = new MCPClient({
      transport: 'stdio',
      command: process.execPath,
      args: [scriptPath],
    });

    try {
      await client.connect();
      await expect(client.ping()).resolves.toEqual({ status: 'ok' });
      const tools = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe('mock_tool');

      const toolResult = await client.callTool('mock_tool', { k: 'v' });
      expect(toolResult).toEqual({
        accepted: true,
        echoed: {
          name: 'mock_tool',
          args: { k: 'v' },
        },
      });

      const resources = await client.listResources();
      expect(resources).toHaveLength(1);

      const resource = await client.readResource('test://r');
      expect(resource).toEqual({ uri: 'test://r', content: 'data' });
    } finally {
      await client.disconnect();
    }
  });

  it('connect is idempotent when already connected', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mcp-stdio-idem-'));
    const scriptPath = path.join(root, 'stdio-noop.mjs');
    fs.writeFileSync(
      scriptPath,
      [
        "import { createInterface } from 'node:readline';",
        "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'rl.on(\'line\', (line) => {',
        '  const req = JSON.parse(line);',
        '  process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: {} }) + "\\n");',
        '});',
      ].join('\n'),
      'utf8',
    );

    const client = new MCPClient({
      transport: 'stdio',
      command: process.execPath,
      args: [scriptPath],
    });

    try {
      await client.connect();
      // Second connect should be idempotent
      await client.connect();
    } finally {
      await client.disconnect();
    }
  });

  it('disconnect is idempotent when not connected', async () => {
    const client = new MCPClient({
      transport: 'stdio',
      command: 'echo',
      args: ['hello'],
    });
    // Should not throw
    await client.disconnect();
  });

  it('request throws when not connected', async () => {
    const client = new MCPClient({
      transport: 'stdio',
      command: 'echo',
    });

    await expect(client.request('ping')).rejects.toThrow('mcp_client_not_connected');
  });

  it('handleMessage ignores invalid JSON', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mcp-stdio-badjson-'));
    const scriptPath = path.join(root, 'bad-json.mjs');
    fs.writeFileSync(
      scriptPath,
      [
        'process.stdout.write("not-json\\n");',
        "import { createInterface } from 'node:readline';",
        "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'rl.on(\'line\', (line) => {',
        '  const req = JSON.parse(line);',
        '  process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: { status: "ok" } }) + "\\n");',
        '});',
      ].join('\n'),
      'utf8',
    );

    const client = new MCPClient({
      transport: 'stdio',
      command: process.execPath,
      args: [scriptPath],
    });

    try {
      await client.connect();
      // Should still work after receiving invalid JSON
      const result = await client.ping();
      expect(result).toEqual({ status: 'ok' });
    } finally {
      await client.disconnect();
    }
  });

  it('handleMessage rejects error responses', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mcp-stdio-err-'));
    const scriptPath = path.join(root, 'error-server.mjs');
    fs.writeFileSync(
      scriptPath,
      [
        "import { createInterface } from 'node:readline';",
        "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'rl.on(\'line\', (line) => {',
        '  const req = JSON.parse(line);',
        '  process.stdout.write(JSON.stringify({ id: req.id, ok: false, error: "custom_error" }) + "\\n");',
        '});',
      ].join('\n'),
      'utf8',
    );

    const client = new MCPClient({
      transport: 'stdio',
      command: process.execPath,
      args: [scriptPath],
    });

    try {
      await client.connect();
      await expect(client.ping()).rejects.toThrow('custom_error');
    } finally {
      await client.disconnect();
    }
  });

  it('handleMessage rejects with default error when error field is missing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mcp-stdio-noerr-'));
    const scriptPath = path.join(root, 'noerr-server.mjs');
    fs.writeFileSync(
      scriptPath,
      [
        "import { createInterface } from 'node:readline';",
        "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'rl.on(\'line\', (line) => {',
        '  const req = JSON.parse(line);',
        '  process.stdout.write(JSON.stringify({ id: req.id, ok: false }) + "\\n");',
        '});',
      ].join('\n'),
      'utf8',
    );

    const client = new MCPClient({
      transport: 'stdio',
      command: process.execPath,
      args: [scriptPath],
    });

    try {
      await client.connect();
      await expect(client.ping()).rejects.toThrow('mcp_request_failed');
    } finally {
      await client.disconnect();
    }
  });

  it('handleMessage ignores responses with no matching pending id', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mcp-stdio-nomatch-'));
    const scriptPath = path.join(root, 'nomatch-server.mjs');
    fs.writeFileSync(
      scriptPath,
      [
        'process.stdout.write(JSON.stringify({ id: 99999, ok: true, result: {} }) + "\\n");',
        "import { createInterface } from 'node:readline';",
        "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'rl.on(\'line\', (line) => {',
        '  const req = JSON.parse(line);',
        '  process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: { status: "ok" } }) + "\\n");',
        '});',
      ].join('\n'),
      'utf8',
    );

    const client = new MCPClient({
      transport: 'stdio',
      command: process.execPath,
      args: [scriptPath],
    });

    try {
      await client.connect();
      const result = await client.ping();
      expect(result).toEqual({ status: 'ok' });
    } finally {
      await client.disconnect();
    }
  });

  it('handleMessage ignores responses with non-number id', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mcp-stdio-strid-'));
    const scriptPath = path.join(root, 'strid-server.mjs');
    fs.writeFileSync(
      scriptPath,
      [
        'process.stdout.write(JSON.stringify({ id: "not-a-number", ok: true, result: {} }) + "\\n");',
        "import { createInterface } from 'node:readline';",
        "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'rl.on(\'line\', (line) => {',
        '  const req = JSON.parse(line);',
        '  process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: { status: "ok" } }) + "\\n");',
        '});',
      ].join('\n'),
      'utf8',
    );

    const client = new MCPClient({
      transport: 'stdio',
      command: process.execPath,
      args: [scriptPath],
    });

    try {
      await client.connect();
      const result = await client.ping();
      expect(result).toEqual({ status: 'ok' });
    } finally {
      await client.disconnect();
    }
  });

  it('stdio transport with env option', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mcp-stdio-env-'));
    const scriptPath = path.join(root, 'env-server.mjs');
    fs.writeFileSync(
      scriptPath,
      [
        "import { createInterface } from 'node:readline';",
        "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'rl.on(\'line\', (line) => {',
        '  const req = JSON.parse(line);',
        '  process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: { env: process.env.CUSTOM_VAR } }) + "\\n");',
        '});',
      ].join('\n'),
      'utf8',
    );

    const client = new MCPClient({
      transport: 'stdio',
      command: process.execPath,
      args: [scriptPath],
      env: { CUSTOM_VAR: 'custom_value' },
    });

    try {
      await client.connect();
      const result = await client.request('test') as { env: string };
      expect(result.env).toBe('custom_value');
    } finally {
      await client.disconnect();
    }
  });

  it('rejectAllPending fires on stdio process exit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mcp-stdio-exit-'));
    const scriptPath = path.join(root, 'exit-server.mjs');
    fs.writeFileSync(
      scriptPath,
      [
        '// exit immediately without responding',
        'process.exit(0);',
      ].join('\n'),
      'utf8',
    );

    const client = new MCPClient({
      transport: 'stdio',
      command: process.execPath,
      args: [scriptPath],
    });

    await client.connect();
    // process exits immediately, pending requests should be rejected
    await expect(client.ping()).rejects.toThrow();
  });

  it('listTools returns empty array when tools field is missing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mcp-stdio-notools-'));
    const scriptPath = path.join(root, 'notools-server.mjs');
    fs.writeFileSync(
      scriptPath,
      [
        "import { createInterface } from 'node:readline';",
        "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'rl.on(\'line\', (line) => {',
        '  const req = JSON.parse(line);',
        '  process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: {} }) + "\\n");',
        '});',
      ].join('\n'),
      'utf8',
    );

    const client = new MCPClient({
      transport: 'stdio',
      command: process.execPath,
      args: [scriptPath],
    });

    try {
      await client.connect();
      const tools = await client.listTools();
      expect(tools).toEqual([]);
    } finally {
      await client.disconnect();
    }
  });

  it('listResources returns empty array when resources field is missing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mcp-stdio-nores-'));
    const scriptPath = path.join(root, 'nores-server.mjs');
    fs.writeFileSync(
      scriptPath,
      [
        "import { createInterface } from 'node:readline';",
        "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'rl.on(\'line\', (line) => {',
        '  const req = JSON.parse(line);',
        '  process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: {} }) + "\\n");',
        '});',
      ].join('\n'),
      'utf8',
    );

    const client = new MCPClient({
      transport: 'stdio',
      command: process.execPath,
      args: [scriptPath],
    });

    try {
      await client.connect();
      const resources = await client.listResources();
      expect(resources).toEqual([]);
    } finally {
      await client.disconnect();
    }
  });
});

describe('MCPClient WebSocket transport', () => {
  it('connects to a WebSocket server and sends/receives messages', async () => {
    // Create a simple WebSocket server
    const httpServer = http.createServer();
    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const req = JSON.parse(raw.toString());
        if (req.method === 'ping') {
          ws.send(JSON.stringify({ id: req.id, ok: true, result: { status: 'ok' } }));
        } else if (req.method === 'tools/list') {
          ws.send(JSON.stringify({ id: req.id, ok: true, result: { tools: [{ name: 'ws_tool', description: 'test', inputSchema: {} }] } }));
        } else if (req.method === 'tools/call') {
          ws.send(JSON.stringify({ id: req.id, ok: true, result: { called: true } }));
        } else if (req.method === 'resources/list') {
          ws.send(JSON.stringify({ id: req.id, ok: true, result: { resources: [{ uri: 'test://x', description: 'x' }] } }));
        } else if (req.method === 'resources/read') {
          ws.send(JSON.stringify({ id: req.id, ok: true, result: { uri: req.params.uri, content: 'ws-data' } }));
        } else {
          ws.send(JSON.stringify({ id: req.id, ok: false, error: 'unknown_method' }));
        }
      });
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const address = httpServer.address() as { port: number };

    const client = new MCPClient({
      transport: 'websocket',
      url: `ws://127.0.0.1:${address.port}`,
    });

    try {
      await client.connect();

      // connect is idempotent
      await client.connect();

      const ping = await client.ping();
      expect(ping).toEqual({ status: 'ok' });

      const tools = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe('ws_tool');

      const toolResult = await client.callTool('ws_tool', {});
      expect(toolResult).toEqual({ called: true });

      const resources = await client.listResources();
      expect(resources).toHaveLength(1);

      const resource = await client.readResource('test://x');
      expect(resource).toEqual({ uri: 'test://x', content: 'ws-data' });
    } finally {
      await client.disconnect();
      wss.close();
      httpServer.close();
    }
  });

  it('connects with token header', async () => {
    const httpServer = http.createServer();
    const wss = new WebSocketServer({ server: httpServer });

    let receivedToken: string | undefined;
    wss.on('connection', (ws, req) => {
      receivedToken = req.headers['x-xifan-token'] as string | undefined;
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        ws.send(JSON.stringify({ id: msg.id, ok: true, result: { status: 'ok' } }));
      });
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const address = httpServer.address() as { port: number };

    const client = new MCPClient({
      transport: 'websocket',
      url: `ws://127.0.0.1:${address.port}`,
      token: 'my-token',
    });

    try {
      await client.connect();
      await client.ping();
      expect(receivedToken).toBe('my-token');
    } finally {
      await client.disconnect();
      wss.close();
      httpServer.close();
    }
  });

  it('disconnects WebSocket cleanly', async () => {
    const httpServer = http.createServer();
    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        ws.send(JSON.stringify({ id: msg.id, ok: true, result: {} }));
      });
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const address = httpServer.address() as { port: number };

    const client = new MCPClient({
      transport: 'websocket',
      url: `ws://127.0.0.1:${address.port}`,
    });

    await client.connect();
    await client.disconnect();

    // Subsequent requests should fail
    await expect(client.request('ping')).rejects.toThrow('mcp_client_not_connected');

    wss.close();
    httpServer.close();
  });

  it('rejectAllPending fires on WebSocket close', async () => {
    const httpServer = http.createServer();
    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
      // Don't respond - just close after a bit
      setTimeout(() => ws.close(), 50);
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const address = httpServer.address() as { port: number };

    const client = new MCPClient({
      transport: 'websocket',
      url: `ws://127.0.0.1:${address.port}`,
    });

    await client.connect();
    await expect(client.ping()).rejects.toThrow();

    wss.close();
    httpServer.close();
  });

  it('rejectAllPending fires on WebSocket error', async () => {
    const httpServer = http.createServer();
    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
      // Force terminate from server side
      ws.terminate();
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const address = httpServer.address() as { port: number };

    const client = new MCPClient({
      transport: 'websocket',
      url: `ws://127.0.0.1:${address.port}`,
    });

    await client.connect();
    await expect(client.ping()).rejects.toThrow();

    wss.close();
    httpServer.close();
  });

  it('handles invalid JSON from WebSocket', async () => {
    const httpServer = http.createServer();
    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        // Send invalid JSON first, then valid response
        ws.send('not-json');
        ws.send(JSON.stringify({ id: msg.id, ok: true, result: { status: 'ok' } }));
      });
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const address = httpServer.address() as { port: number };

    const client = new MCPClient({
      transport: 'websocket',
      url: `ws://127.0.0.1:${address.port}`,
    });

    try {
      await client.connect();
      const result = await client.ping();
      expect(result).toEqual({ status: 'ok' });
    } finally {
      await client.disconnect();
      wss.close();
      httpServer.close();
    }
  });
});
