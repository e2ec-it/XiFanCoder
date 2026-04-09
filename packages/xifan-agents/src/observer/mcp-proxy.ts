// packages/xifan-agents/src/observer/mcp-proxy.ts
import { spawn } from 'node:child_process';
import { Pool } from 'pg';

export interface McpProxyOptions {
  readonly targetCmd: string;
  readonly sessionId: string;
  readonly databaseUrl: string;
  readonly onError?: 'bypass' | 'fail';
}

/**
 * Parse LSP-style frames (Content-Length: N\r\n\r\n<body>).
 * Returns an AsyncGenerator yielding each complete frame body as Buffer.
 */
export async function* parseFrames(
  readable: NodeJS.ReadableStream
): AsyncGenerator<Buffer> {
  let buf = Buffer.alloc(0);

  for await (const chunk of readable) {
    buf = Buffer.concat([buf, chunk instanceof Buffer ? chunk : Buffer.from(chunk as string)]);

    // Process as many complete frames as possible
    while (true) {
      // Find the header separator \r\n\r\n
      const sep = Buffer.from('\r\n\r\n', 'ascii');
      const sepIdx = buf.indexOf(sep);
      if (sepIdx === -1) break;

      // Parse Content-Length from header
      const headerStr = buf.subarray(0, sepIdx).toString('ascii');
      const match = /Content-Length:\s*(\S+)/i.exec(headerStr);
      if (!match || !match[1]) break;

      const contentLength = parseInt(match[1], 10);
      if (isNaN(contentLength) || contentLength < 0) {
        throw new Error(`[xifan-mcp-proxy] Invalid Content-Length: ${match[1]}`);
      }
      const bodyStart = sepIdx + sep.length;
      const bodyEnd = bodyStart + contentLength;

      if (buf.length < bodyEnd) break; // Need more data

      const body = buf.subarray(bodyStart, bodyEnd);
      yield body;

      // Advance buffer past this frame
      buf = buf.subarray(bodyEnd);
    }
  }
}

/**
 * Wrap content Buffer in LSP frame format.
 */
export function makeFrame(content: Buffer): Buffer {
  const header = `Content-Length: ${content.length}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, 'ascii'), content]);
}

/**
 * Whether to record a given JSON-RPC method (only 'tools/call').
 */
export function shouldRecord(method: string | undefined): boolean {
  return method === 'tools/call';
}

/** Maximum number of in-flight pending request IDs tracked before evicting oldest. */
const MAX_PENDING = 10_000;

/**
 * Main proxy: reads from process.stdin, forwards to target, records to DB.
 */
export async function runMcpProxy(opts: McpProxyOptions): Promise<void> {
  const { targetCmd, sessionId, databaseUrl, onError = 'bypass' } = opts;

  // Initialize DB pool
  const pool = new Pool({ connectionString: databaseUrl });

  // DB insert helper — returns the promise for caller to handle
  function recordToDb(type: 'mcp_request' | 'mcp_response', payload: unknown): Promise<void> {
    return pool
      .query(
        `INSERT INTO xifan_obs.events (session_id, type, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [sessionId, type, JSON.stringify(payload)]
      )
      .then(() => undefined);
  }

  // Fire-and-forget wrapper: swallows or escalates DB errors based on onError mode
  function fireRecord(type: 'mcp_request' | 'mcp_response', payload: unknown): void {
    const p = recordToDb(type, payload);
    if (onError === 'fail') {
      /* v8 ignore next 3 -- emitting uncaughtException crashes the test runner */
      p.catch((err: unknown) => {
        process.emit('uncaughtException', err instanceof Error ? err : new Error(String(err)));
      });
    } else {
      p.catch((err: unknown) => console.error('[xifan-mcp-proxy] DB write error (bypass):', err));
    }
  }

  // Parse targetCmd into command + args
  if (targetCmd.includes('"') || targetCmd.includes("'")) {
    throw new Error(
      `[xifan-mcp-proxy] targetCmd contains quotes; pass pre-split args instead: "${targetCmd}"`
    );
  }
  const parts = targetCmd.split(/\s+/).filter(Boolean);
  const cmd = parts[0];
  if (!cmd) throw new Error('targetCmd must not be empty');
  const args = parts.slice(1);

  // Spawn target process
  const target = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  // Track pending tools/call requests by id for response correlation
  const pendingRequests = new Set<string | number>();

  // stdin -> target.stdin
  const stdinToTarget = async (): Promise<void> => {
    for await (const body of parseFrames(process.stdin)) {
      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
      } catch {
        // Not valid JSON — forward as-is without recording
      }

      if (parsed && shouldRecord(parsed['method'] as string | undefined)) {
        const id = parsed['id'] as string | number | undefined;
        if (id !== undefined) {
          /* v8 ignore next 6 -- eviction guard for 10k+ in-flight requests; impractical to unit-test */
          if (pendingRequests.size >= MAX_PENDING) {
            const oldest = pendingRequests.values().next().value;
            if (oldest !== undefined) {
              pendingRequests.delete(oldest);
            }
          }
          pendingRequests.add(id);
        }
        fireRecord('mcp_request', parsed);
      }

      if (target.stdin && !target.stdin.destroyed) {
        target.stdin.write(makeFrame(body));
      }
    }
    target.stdin?.end();
  };

  // target.stdout -> stdout
  const targetToStdout = async (): Promise<void> => {
    if (!target.stdout) return;

    for await (const body of parseFrames(target.stdout)) {
      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
      } catch {
        // Not valid JSON
      }

      if (parsed) {
        const id = parsed['id'] as string | number | undefined;
        if (id !== undefined && pendingRequests.has(id)) {
          pendingRequests.delete(id);
          fireRecord('mcp_response', parsed);
        }
      }

      process.stdout.write(makeFrame(body));
    }
  };

  // Run both directions concurrently
  await Promise.all([stdinToTarget(), targetToStdout()]);

  // Wait for target to exit and propagate exit code
  await new Promise<void>((resolve) => {
    target.on('close', (code) => {
      pool.end().catch(() => {});
      process.exit(code ?? 0);
      resolve();
    });
    target.on('error', (err) => {
      console.error('[xifan-mcp-proxy] target process error:', err);
      pool.end().catch(() => {});
      process.exit(1);
      resolve();
    });
  });
}
