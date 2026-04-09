import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

import { WebSocket } from 'ws';

interface MCPRpcResponse {
  readonly id: string | number | null;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

export interface MCPClientWebSocketOptions {
  readonly transport: 'websocket';
  readonly url: string;
  readonly token?: string;
}

export interface MCPClientStdioOptions {
  readonly transport: 'stdio';
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export type MCPClientOptions = MCPClientWebSocketOptions | MCPClientStdioOptions;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class MCPClient {
  private readonly options: MCPClientOptions;
  private socket?: WebSocket;
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(options: MCPClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    if (this.socket || this.child) {
      return;
    }

    if (this.options.transport === 'websocket') {
      await this.connectWebSocket();
      return;
    }

    await this.connectStdio();
  }

  async disconnect(): Promise<void> {
    this.rejectAllPending(new Error('mcp_client_disconnected'));

    if (this.socket) {
      const ws = this.socket;
      this.socket = undefined;
      await new Promise<void>((resolve) => {
        ws.once('close', () => resolve());
        ws.close();
      });
    }

    if (this.child) {
      const child = this.child;
      this.child = undefined;
      if (!child.killed) {
        child.kill('SIGTERM');
      }
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
      });
    }
  }

  async ping(): Promise<{ status: string }> {
    return (await this.request('ping')) as { status: string };
  }

  async listTools(): Promise<readonly { name: string; description: string; inputSchema: unknown }[]> {
    const result = (await this.request('tools/list')) as { tools?: readonly { name: string; description: string; inputSchema: unknown }[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return await this.request('tools/call', {
      name,
      args,
    });
  }

  async listResources(): Promise<readonly { uri: string; description: string }[]> {
    const result = (await this.request('resources/list')) as {
      resources?: readonly { uri: string; description: string }[];
    };
    return result.resources ?? [];
  }

  async readResource(uri: string): Promise<unknown> {
    return await this.request('resources/read', { uri });
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;

    const payload = JSON.stringify({
      id,
      method,
      params,
    });
    return await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (this.socket) {
        this.socket.send(payload);
        return;
      }
      if (this.child) {
        this.child.stdin.write(`${payload}\n`);
        return;
      }
      this.pending.delete(id);
      reject(new Error('mcp_client_not_connected'));
    });
  }

  /* v8 ignore start -- WebSocket/stdio transport: requires real server connection */
  private async connectWebSocket(): Promise<void> {
    if (this.options.transport !== 'websocket') {
      return;
    }
    const ws = new WebSocket(this.options.url, {
      headers: this.options.token
        ? {
            'x-xifan-token': this.options.token,
          }
        : undefined,
    });
    this.socket = ws;

    ws.on('message', (raw) => {
      this.handleMessage(raw.toString());
    });
    ws.on('error', (error) => {
      this.rejectAllPending(error instanceof Error ? error : new Error(String(error)));
    });
    ws.on('close', () => {
      this.rejectAllPending(new Error('mcp_websocket_closed'));
    });

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
  }

  private async connectStdio(): Promise<void> {
    if (this.options.transport !== 'stdio') {
      return;
    }
    const child = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env: this.options.env
        ? {
            ...process.env,
            ...this.options.env,
          }
        : process.env,
      stdio: 'pipe',
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdin.setDefaultEncoding('utf8');

    const lineReader = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    lineReader.on('line', (line) => {
      this.handleMessage(line);
    });

    child.on('error', (error) => {
      this.rejectAllPending(error instanceof Error ? error : new Error(String(error)));
    });
    child.on('exit', () => {
      this.rejectAllPending(new Error('mcp_stdio_exited'));
    });
  }
  /* v8 ignore stop */

  private handleMessage(raw: string): void {
    let parsed: MCPRpcResponse | undefined;
    try {
      parsed = JSON.parse(raw) as MCPRpcResponse;
    } catch {
      return;
    }
    if (!parsed || typeof parsed.id !== 'number') {
      return;
    }
    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }
    this.pending.delete(parsed.id);
    if (!parsed.ok) {
      pending.reject(new Error(parsed.error ?? 'mcp_request_failed'));
      return;
    }
    pending.resolve(parsed.result);
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
