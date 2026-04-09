import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Pool } from 'pg';

import { hybridSearch } from '../memory/retriever.js';
import { saveMemory } from '../memory/store.js';
import { recordEvent } from '../observer/event-store.js';
import { getReplay } from '../observer/replay.js';

const PORT_FILE = join(homedir(), '.xifan', 'coder', 'agents.port');

export async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.once('listening', () => {
        s.close();
        resolve(true);
      });
      s.listen(port);
    });
    if (available) return port;
  }
  throw new Error(`No available port in range ${startPort}-${startPort + 100}`);
}

export async function resolvePort(): Promise<number> {
  const explicit = process.env['XIFAN_AGENTS_API_PORT'];
  if (explicit) return Number(explicit);
  return findAvailablePort(8090);
}

export async function startMemoryApi(pool: Pool): Promise<{ port: number; server: http.Server }> {
  const port = await resolvePort();
  const apiKey = process.env['XIFAN_AGENTS_API_KEY'];

  const server = http.createServer(async (req, res) => {
    // Auth check
    if (apiKey) {
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${apiKey}`) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }

    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const path = url.pathname;

    try {
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'POST' && path === '/api/v1/events') {
        const body = await readBody(req);
        let data: {
          sessionId?: string;
          eventType?: string;
          toolName?: string;
          payload?: { input?: unknown; response?: unknown };
          cwd?: string;
          model?: string;
        };
        try {
          data = JSON.parse(body) as typeof data;
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'invalid json' }));
          return;
        }
        if (!data.sessionId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'sessionId required' }));
          return;
        }
        if (data.eventType === 'session_end') {
          await pool.query(
            `UPDATE xifan_obs.sessions SET status = 'completed', completed_at = $1 WHERE id = $2`,
            [Date.now(), data.sessionId],
          );
        } else {
          await pool.query(
            `INSERT INTO xifan_obs.sessions (id, project, user_input, model, started_at)
             VALUES ($1, $2, '', $3, $4)
             ON CONFLICT (id) DO NOTHING`,
            [data.sessionId, data.cwd ?? '', data.model ?? null, Date.now()],
          );
          recordEvent(pool, {
            sessionId: data.sessionId,
            type: 'tool_call',
            toolName: data.toolName,
            payload: data.payload,
          });
        }
        res.end(JSON.stringify({ ok: true }));
      } else if (req.method === 'GET' && path === '/api/v1/experiences') {
        const q = url.searchParams.get('q') ?? '';
        const topK = Number(url.searchParams.get('topK') ?? '5');
        const results = await hybridSearch(pool, q, { topK });
        res.end(JSON.stringify({ results }));
      } else if (req.method === 'POST' && path === '/api/v1/observations') {
        const body = await readBody(req);
        const data = JSON.parse(body) as Parameters<typeof saveMemory>[1];
        const id = await saveMemory(pool, data);
        res.end(JSON.stringify({ id }));
      } else if (req.method === 'GET' && path.startsWith('/api/v1/sessions/')) {
        const sessionId = path.split('/')[4] ?? '';
        const events = await getReplay(pool, sessionId);
        res.end(JSON.stringify({ events }));
      } else if (req.method === 'GET' && path === '/api/v1/health') {
        res.end(JSON.stringify({ status: 'ok', port }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'not found' }));
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'internal error' }));
    }
  });

  await new Promise<void>((resolve, reject) =>
    server.listen(port, resolve).on('error', reject),
  );

  // Read the actual bound port (handles port=0 for random-port binding in tests)
  const actualPort = (server.address() as net.AddressInfo).port;

  // Write port to file for discovery
  mkdirSync(join(homedir(), '.xifan', 'coder'), { recursive: true });
  writeFileSync(PORT_FILE, String(actualPort));

  return { port: actualPort, server };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
