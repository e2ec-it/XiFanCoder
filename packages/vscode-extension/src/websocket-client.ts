import WebSocket from 'ws';

export interface WebSocketLike {
  readonly readyState: number;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (payload: unknown) => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
  send(data: string): void;
  close(): void;
}

export interface XiFanWsIncomingMessage {
  readonly text: string;
  readonly json?: unknown;
}

export interface XiFanWebSocketClientOptions {
  readonly url: string;
  readonly token?: string;
  readonly createSocket?: (url: string, token?: string) => WebSocketLike;
  readonly onMessage?: (message: XiFanWsIncomingMessage) => void;
  readonly onStatus?: (status: string) => void;
  readonly onError?: (error: Error) => void;
}

function toText(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }
  if (Buffer.isBuffer(payload)) {
    return payload.toString('utf8');
  }
  if (Array.isArray(payload)) {
    return Buffer.concat(
      payload.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'))),
    ).toString('utf8');
  }
  if (payload instanceof ArrayBuffer) {
    return Buffer.from(payload).toString('utf8');
  }
  if (ArrayBuffer.isView(payload)) {
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString('utf8');
  }
  return String(payload);
}

function parseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/* v8 ignore start — requires real WebSocket server */
function createDefaultSocket(url: string, token?: string): WebSocketLike {
  if (!token) {
    return new WebSocket(url);
  }
  return new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}
/* v8 ignore stop */

export class XiFanWebSocketClient {
  private readonly opts: XiFanWebSocketClientOptions;
  private socket: WebSocketLike | undefined;
  public isConnected = false;

  constructor(options: XiFanWebSocketClientOptions) {
    this.opts = options;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      this.opts.onStatus?.('already connected');
      return;
    }

    const createSocket = this.opts.createSocket ?? createDefaultSocket;
    const socket = createSocket(this.opts.url, this.opts.token);
    this.socket = socket;
    this.opts.onStatus?.(`connecting ${this.opts.url}`);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const rejectOnce = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };

      socket.on('open', () => {
        this.isConnected = true;
        this.opts.onStatus?.('connected');
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      socket.on('message', (payload) => {
        const text = toText(payload);
        this.opts.onMessage?.({
          text,
          json: parseJson(text),
        });
      });

      socket.on('close', (code, reason) => {
        this.isConnected = false;
        this.opts.onStatus?.(`closed code=${code} reason=${toText(reason)}`);
      });

      socket.on('error', (error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        this.opts.onError?.(err);
        this.isConnected = false;
        rejectOnce(err);
      });
    });
  }

  send(payload: string | Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error('websocket is not connected');
    }
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.socket.send(serialized);
  }

  disconnect(): void {
    if (!this.socket) {
      return;
    }
    this.socket.close();
    this.socket = undefined;
    this.isConnected = false;
    this.opts.onStatus?.('disconnected');
  }
}

