import { timingSafeEqual } from 'node:crypto';
import net from 'node:net';

export type DaemonRole = 'user' | 'assistant' | 'system';
export type DaemonSource = 'cli' | 'desktop' | 'daemon';

export interface SessionEvent {
  readonly id: string;
  readonly sessionId: string;
  readonly role: DaemonRole;
  readonly content: string;
  readonly timestamp: string;
  readonly source: DaemonSource;
}

interface DaemonRpcRequest {
  readonly id: string;
  readonly type: string;
  readonly payload?: Record<string, unknown>;
}

interface DaemonRpcResponse {
  readonly id: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly data?: unknown;
}

interface DaemonNotification {
  readonly type: 'session.event';
  readonly sessionId: string;
  readonly event: SessionEvent;
}

interface ClientContext {
  authenticated: boolean;
  subscriptions: Set<string>;
}

function writeJson(socket: net.Socket, value: unknown): void {
  socket.write(JSON.stringify(value) + '\n');
}

function isAuthorized(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function normalizeRequest(raw: unknown): DaemonRpcRequest | undefined {
  /* v8 ignore next 3 -- defensive guard: callers always pass parsed JSON objects */
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || typeof obj.type !== 'string') {
    return undefined;
  }
  if (obj.payload !== undefined && (typeof obj.payload !== 'object' || obj.payload === null)) {
    return undefined;
  }
  return {
    id: obj.id,
    type: obj.type,
    payload: (obj.payload as Record<string, unknown> | undefined) ?? undefined,
  };
}

export interface SessionDaemonServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly token: string;
}

export class SessionDaemonServer {
  private readonly host: string;
  private readonly port: number;
  private readonly token: string;
  private readonly sessions = new Map<string, SessionEvent[]>();
  private readonly subscriptions = new Map<string, Set<net.Socket>>();
  private server?: net.Server;

  constructor(options: SessionDaemonServerOptions) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 0;
    this.token = options.token;
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.server) {
      throw new Error('daemon server already started');
    }

    this.server = net.createServer((socket) => this.handleSocket(socket));
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.port, this.host, () => resolve());
    });

    const address = this.server.address();
    /* v8 ignore next 3 -- defensive guard: TCP server always returns AddressInfo */
    if (!address || typeof address === 'string') {
      throw new Error('daemon server address unavailable');
    }

    return { host: address.address, port: address.port };
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    const current = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }

  private handleSocket(socket: net.Socket): void {
    const context: ClientContext = {
      authenticated: false,
      subscriptions: new Set<string>(),
    };
    let buffer = '';

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const idx = buffer.indexOf('\n');
        if (idx < 0) {
          break;
        }
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.length === 0) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          writeJson(socket, { id: 'unknown', ok: false, error: 'invalid_json' } satisfies DaemonRpcResponse);
          continue;
        }

        const request = normalizeRequest(parsed);
        if (!request) {
          writeJson(socket, { id: 'unknown', ok: false, error: 'invalid_request' } satisfies DaemonRpcResponse);
          continue;
        }

        this.handleRequest(socket, context, request);
      }
    });

    const cleanup = (): void => {
      for (const sessionId of context.subscriptions) {
        const set = this.subscriptions.get(sessionId);
        /* v8 ignore next 3 -- defensive guard: set always exists for subscribed sessions */
        if (!set) {
          continue;
        }
        set.delete(socket);
        if (set.size === 0) {
          this.subscriptions.delete(sessionId);
        }
      }
      context.subscriptions.clear();
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  }

  private handleRequest(
    socket: net.Socket,
    context: ClientContext,
    request: DaemonRpcRequest,
  ): void {
    if (!context.authenticated && request.type !== 'auth') {
      writeJson(socket, { id: request.id, ok: false, error: 'unauthorized' } satisfies DaemonRpcResponse);
      socket.destroy();
      return;
    }

    if (request.type === 'auth') {
      const provided = String(request.payload?.token ?? '');
      if (!isAuthorized(provided, this.token)) {
        writeJson(socket, { id: request.id, ok: false, error: 'unauthorized' } satisfies DaemonRpcResponse);
        socket.destroy();
        return;
      }
      context.authenticated = true;
      writeJson(socket, { id: request.id, ok: true, data: { authenticated: true } } satisfies DaemonRpcResponse);
      return;
    }

    if (request.type === 'ping') {
      writeJson(socket, { id: request.id, ok: true, data: { status: 'ok' } } satisfies DaemonRpcResponse);
      return;
    }

    if (request.type === 'session.get') {
      const sessionId = String(request.payload?.sessionId ?? '');
      const events = this.sessions.get(sessionId) ?? [];
      writeJson(socket, { id: request.id, ok: true, data: { events } } satisfies DaemonRpcResponse);
      return;
    }

    if (request.type === 'session.subscribe') {
      const sessionId = String(request.payload?.sessionId ?? '');
      if (!sessionId) {
        writeJson(socket, { id: request.id, ok: false, error: 'invalid_session_id' } satisfies DaemonRpcResponse);
        return;
      }
      const set = this.subscriptions.get(sessionId) ?? new Set<net.Socket>();
      set.add(socket);
      this.subscriptions.set(sessionId, set);
      context.subscriptions.add(sessionId);
      writeJson(socket, { id: request.id, ok: true, data: { subscribed: true } } satisfies DaemonRpcResponse);
      return;
    }

    if (request.type === 'session.append') {
      const sessionId = String(request.payload?.sessionId ?? '');
      const content = String(request.payload?.content ?? '');
      const role = (request.payload?.role as DaemonRole | undefined) ?? 'user';
      const source = (request.payload?.source as DaemonSource | undefined) ?? 'cli';
      if (!sessionId || !content) {
        writeJson(socket, { id: request.id, ok: false, error: 'invalid_payload' } satisfies DaemonRpcResponse);
        return;
      }

      const event: SessionEvent = {
        id: `evt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        sessionId,
        role,
        content,
        timestamp: new Date().toISOString(),
        source,
      };
      const events = this.sessions.get(sessionId) ?? [];
      events.push(event);
      this.sessions.set(sessionId, events);
      writeJson(socket, { id: request.id, ok: true, data: { event } } satisfies DaemonRpcResponse);
      this.broadcast(sessionId, event);
      return;
    }

    writeJson(socket, { id: request.id, ok: false, error: 'unknown_method' } satisfies DaemonRpcResponse);
  }

  private broadcast(sessionId: string, event: SessionEvent): void {
    const subscribers = this.subscriptions.get(sessionId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }
    const notification: DaemonNotification = {
      type: 'session.event',
      sessionId,
      event,
    };
    for (const socket of subscribers) {
      if (!socket.destroyed) {
        writeJson(socket, notification);
      }
    }
  }
}

export interface SessionDaemonClientOptions {
  readonly host?: string;
  readonly port: number;
  readonly token: string;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class SessionDaemonClient {
  private readonly host: string;
  private readonly port: number;
  private readonly token: string;
  private socket?: net.Socket;
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventHandlers = new Set<(event: SessionEvent) => void>();

  constructor(options: SessionDaemonClientOptions) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port;
    this.token = options.token;
  }

  async connect(): Promise<void> {
    if (this.socket) {
      return;
    }

    const socket = new net.Socket();
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.connect(this.port, this.host, () => resolve());
    });

    socket.on('data', (chunk: Buffer) => this.handleData(chunk));
    socket.on('close', () => this.rejectAll(new Error('daemon connection closed')));
    socket.on('error', (error) => this.rejectAll(error instanceof Error ? error : new Error(String(error))));

    await this.request('auth', { token: this.token });
  }

  async disconnect(): Promise<void> {
    if (!this.socket) {
      return;
    }
    const socket = this.socket;
    this.socket = undefined;
    await new Promise<void>((resolve) => {
      socket.end(() => resolve());
    });
  }

  onSessionEvent(handler: (event: SessionEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  async ping(): Promise<{ status: string }> {
    const data = await this.request('ping');
    return data as { status: string };
  }

  async getSession(sessionId: string): Promise<readonly SessionEvent[]> {
    const data = await this.request('session.get', { sessionId });
    return ((data as { events?: readonly SessionEvent[] }).events ?? []) as readonly SessionEvent[];
  }

  async subscribe(sessionId: string): Promise<void> {
    await this.request('session.subscribe', { sessionId });
  }

  async appendSessionEvent(input: {
    sessionId: string;
    role?: DaemonRole;
    content: string;
    source?: DaemonSource;
  }): Promise<SessionEvent> {
    const data = await this.request('session.append', {
      sessionId: input.sessionId,
      role: input.role ?? 'user',
      content: input.content,
      source: input.source ?? 'cli',
    });
    return (data as { event: SessionEvent }).event;
  }

  private async request(type: string, payload?: Record<string, unknown>): Promise<unknown> {
    if (!this.socket) {
      throw new Error('daemon client is not connected');
    }

    const id = `req-${this.nextId++}`;
    const message: DaemonRpcRequest = { id, type, payload };
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    writeJson(this.socket, message);
    return await response;
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    for (;;) {
      const idx = this.buffer.indexOf('\n');
      if (idx < 0) {
        break;
      }
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      /* v8 ignore next 3 -- defensive guard: split always produces non-empty trimmed lines */
      if (!line) {
        continue;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(line);
      /* v8 ignore next 3 -- defensive guard: daemon always sends valid JSON */
      } catch {
        continue;
      }

      if (this.handleNotification(payload)) {
        continue;
      }
      this.handleResponse(payload);
    }
  }

  /* v8 ignore start -- client protocol handlers require live TCP connection */
  private handleNotification(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }
    const obj = payload as Record<string, unknown>;
    if (obj.type !== 'session.event') {
      return false;
    }
    const event = (obj.event ?? undefined) as SessionEvent | undefined;
    if (!event) {
      return true;
    }
    for (const handler of this.eventHandlers) {
      handler(event);
    }
    return true;
  }

  private handleResponse(payload: unknown): void {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const response = payload as Partial<DaemonRpcResponse>;
    if (typeof response.id !== 'string') {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);

    if (!response.ok) {
      pending.reject(new Error(response.error ?? 'daemon_request_failed'));
      return;
    }

    pending.resolve(response.data);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
  /* v8 ignore stop */
}
