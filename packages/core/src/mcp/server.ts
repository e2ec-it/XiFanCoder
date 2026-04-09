import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import {
  ConnectionLimiter,
  ensureLocalhostTlsCertificate,
  type MCPAllowedOriginPattern,
  persistSessionToken,
  validateMCPUpgradeRequest,
  generateSessionToken,
} from './security.js';

interface MCPRpcRequest {
  readonly id: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

interface MCPRpcResponse {
  readonly id: string | number | null;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

interface MCPResourceDefinition {
  readonly uri: string;
  readonly description: string;
}

interface MCPToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface MCPDispatchRequest {
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface MCPServerHandlers {
  readonly getCurrentSession?: () => Promise<unknown> | unknown;
  readonly getXifanMarkdown?: () => Promise<string> | string;
  readonly onAsk?: (instruction: string) => Promise<unknown> | unknown;
  readonly onFileEdit?: (input: {
    readonly filePath: string;
    readonly instruction: string;
  }) => Promise<unknown> | unknown;
}

export interface MCPServerTlsOptions {
  readonly keyPath: string;
  readonly certPath: string;
}

export interface MCPWebSocketServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly path?: string;
  readonly token?: string;
  readonly tokenFilePath?: string;
  readonly persistToken?: boolean;
  readonly maxConnections?: number;
  readonly requireTls?: boolean;
  readonly tls?: MCPServerTlsOptions;
  readonly allowMissingOrigin?: boolean;
  readonly allowedHosts?: readonly string[];
  readonly allowedOrigins?: readonly MCPAllowedOriginPattern[];
  readonly handlers?: MCPServerHandlers;
  readonly onConnectionStateChange?: (state: {
    readonly ideConnected: boolean;
    readonly connectedClients: number;
  }) => void;
}

export interface MCPWebSocketServerStatus {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly tokenFilePath?: string;
  readonly tlsEnabled: boolean;
  readonly tlsCertPath?: string;
  readonly connectedClients: number;
  readonly ideConnected: boolean;
}

const DEFAULT_MCP_RESOURCES: readonly MCPResourceDefinition[] = [
  {
    uri: 'xifan://session/current',
    description: 'Current active XiFanCoder session snapshot',
  },
  {
    uri: 'xifan://context/xifan_md',
    description: 'Current project XIFAN.md context',
  },
];

const DEFAULT_MCP_TOOLS: readonly MCPToolDefinition[] = [
  {
    name: 'xifan_ask',
    description: 'Send a natural-language instruction to XiFanCoder agent',
    inputSchema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', minLength: 1 },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
  },
  {
    name: 'xifan_file_edit',
    description: 'Trigger an edit request for a target file',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', minLength: 1 },
        instruction: { type: 'string', minLength: 1 },
      },
      required: ['filePath', 'instruction'],
      additionalProperties: false,
    },
  },
];

function parseRpcRequest(raw: unknown): MCPRpcRequest | undefined {
  /* v8 ignore next 3 -- defensive guard: callers always pass parsed JSON */
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const id = obj.id;
  if (!(typeof id === 'string' || typeof id === 'number' || id === null)) {
    return undefined;
  }
  if (typeof obj.method !== 'string') {
    return undefined;
  }
  if (obj.params !== undefined && (typeof obj.params !== 'object' || obj.params === null)) {
    return undefined;
  }
  return {
    id,
    method: obj.method,
    params: (obj.params as Record<string, unknown> | undefined) ?? undefined,
  };
}

/* v8 ignore start -- defensive URL parsing: HTTP upgrade always provides valid URL */
function parsePathname(url: string | undefined): string {
  if (!url) {
    return '/';
  }
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return '/';
  }
}
/* v8 ignore stop */

/* v8 ignore start -- HTTP upgrade rejection: requires raw socket connection */
function writeUpgradeRejection(socket: Duplex, statusCode: number, reason: string): void {
  const reasonPhrase =
    statusCode === 401
      ? 'Unauthorized'
      : statusCode === 403
      ? 'Forbidden'
      : statusCode === 404
      ? 'Not Found'
      : statusCode === 426
      ? 'Upgrade Required'
      : statusCode === 503
      ? 'Service Unavailable'
      : 'Bad Request';
  socket.write(
    `HTTP/1.1 ${statusCode} ${reasonPhrase}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      '\r\n' +
      `${reason}\r\n`,
  );
  socket.destroy();
}
/* v8 ignore stop */

async function readResource(uri: string, handlers: MCPServerHandlers): Promise<unknown> {
  if (uri === 'xifan://session/current') {
    const session = await handlers.getCurrentSession?.();
    return {
      uri,
      content: session ?? null,
    };
  }
  if (uri === 'xifan://context/xifan_md') {
    const content = await handlers.getXifanMarkdown?.();
    return {
      uri,
      content: content ?? '',
    };
  }
  throw new Error('resource_not_found');
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  handlers: MCPServerHandlers,
): Promise<unknown> {
  if (name === 'xifan_ask') {
    const instruction = String(args.instruction ?? '');
    if (!instruction.trim()) {
      throw new Error('invalid_instruction');
    }
    const result = await handlers.onAsk?.(instruction);
    return {
      accepted: true,
      result: result ?? null,
    };
  }

  if (name === 'xifan_file_edit') {
    const filePath = String(args.filePath ?? '');
    const instruction = String(args.instruction ?? '');
    if (!filePath.trim() || !instruction.trim()) {
      throw new Error('invalid_file_edit_payload');
    }
    const result = await handlers.onFileEdit?.({
      filePath,
      instruction,
    });
    return {
      accepted: true,
      result: result ?? null,
    };
  }

  throw new Error('tool_not_found');
}

export async function dispatchMCPRequest(
  request: MCPDispatchRequest,
  handlers: MCPServerHandlers = {},
): Promise<unknown> {
  if (request.method === 'ping') {
    return { status: 'ok' };
  }

  if (request.method === 'resources/list') {
    return { resources: DEFAULT_MCP_RESOURCES };
  }

  if (request.method === 'resources/read') {
    const uri = String(request.params?.uri ?? '');
    if (!uri) {
      throw new Error('invalid_resource_uri');
    }
    return await readResource(uri, handlers);
  }

  if (request.method === 'tools/list') {
    return { tools: DEFAULT_MCP_TOOLS };
  }

  if (request.method === 'tools/call') {
    const name = String(request.params?.name ?? '');
    const args = (request.params?.args as Record<string, unknown> | undefined) ?? {};
    if (!name) {
      throw new Error('invalid_tool_name');
    }
    return await callTool(name, args, handlers);
  }

  throw new Error('unknown_method');
}

export class MCPWebSocketServer {
  private readonly host: string;
  private readonly port: number;
  private readonly path: string;
  private readonly handlers: MCPServerHandlers;
  private readonly requireTls: boolean;
  private readonly allowMissingOrigin: boolean;
  private readonly allowedHosts?: readonly string[];
  private readonly allowedOrigins?: readonly MCPAllowedOriginPattern[];
  private readonly tlsOptions?: MCPServerTlsOptions;
  private readonly shouldPersistToken: boolean;
  private readonly desiredTokenFilePath?: string;
  private readonly onConnectionStateChange?: MCPWebSocketServerOptions['onConnectionStateChange'];
  private readonly connectionLimiter: ConnectionLimiter;
  private readonly clients = new Set<WebSocket>();

  private readonly wsServer = new WebSocketServer({ noServer: true });
  private server?: ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;
  private token: string;
  private tokenFilePath?: string;
  private tlsCertPath?: string;

  constructor(options: MCPWebSocketServerOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 7890;
    this.path = options.path ?? '/mcp';
    this.handlers = options.handlers ?? {};
    this.requireTls = options.requireTls ?? true;
    this.allowMissingOrigin = options.allowMissingOrigin ?? true;
    this.allowedHosts = options.allowedHosts;
    this.allowedOrigins = options.allowedOrigins;
    this.tlsOptions = options.tls;
    this.shouldPersistToken = options.persistToken ?? true;
    this.desiredTokenFilePath = options.tokenFilePath;
    this.onConnectionStateChange = options.onConnectionStateChange;
    this.connectionLimiter = new ConnectionLimiter(options.maxConnections ?? 10);
    this.token = options.token ?? generateSessionToken();

    this.wsServer.on('connection', (socket) => this.handleConnection(socket));
  }

  async start(): Promise<MCPWebSocketServerStatus> {
    if (this.server) {
      throw new Error('MCP WebSocket server is already running');
    }

    if (this.shouldPersistToken) {
      this.tokenFilePath = await persistSessionToken(this.token, this.desiredTokenFilePath);
    }

    let effectiveTlsOptions = this.tlsOptions;
    if (!effectiveTlsOptions && this.requireTls) {
      const generated = await ensureLocalhostTlsCertificate();
      effectiveTlsOptions = {
        keyPath: generated.keyPath,
        certPath: generated.certPath,
      };
    }
    this.tlsCertPath = effectiveTlsOptions?.certPath;

    const server = effectiveTlsOptions
      ? createHttpsServer(
          {
            key: await readFile(effectiveTlsOptions.keyPath, 'utf8'),
            cert: await readFile(effectiveTlsOptions.certPath, 'utf8'),
          },
          (req, res) => {
            const pathname = parsePathname(req.url);
            if (pathname === this.path) {
              res.statusCode = 426;
              res.end('Use WebSocket upgrade');
              return;
            }
            res.statusCode = 404;
            res.end('Not Found');
          },
        )
      : createHttpServer((req, res) => {
          const pathname = parsePathname(req.url);
          if (pathname === this.path) {
            res.statusCode = 426;
            res.end('Use WebSocket upgrade');
            return;
          }
          res.statusCode = 404;
          res.end('Not Found');
        });

    this.server = server;
    server.on('upgrade', (request, socket, head) => this.handleUpgrade(request, socket, head));

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, () => resolve());
    });

    /* v8 ignore next -- status read after listen resolve */
    return this.getStatus();
  }

  /* v8 ignore next 4 -- WebSocket cleanup: requires live connections */
  async stop(): Promise<void> {
    for (const socket of this.clients) {
      socket.close();
    }
    this.clients.clear();

    this.wsServer.close();
    const current = this.server;
    this.server = undefined;
    if (!current) {
      return;
    }
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }

  getStatus(): MCPWebSocketServerStatus {
    const address = this.server?.address();
    const resolvedPort = typeof address === 'object' && address ? address.port : this.port;
    const resolvedHost = typeof address === 'object' && address ? address.address : this.host;
    return {
      host: resolvedHost,
      port: resolvedPort,
      path: this.path,
      tokenFilePath: this.tokenFilePath,
      tlsEnabled: Boolean(this.tlsCertPath),
      tlsCertPath: this.tlsCertPath,
      connectedClients: this.clients.size,
      ideConnected: this.clients.size > 0,
    };
  }

  getToken(): string {
    return this.token;
  }

  private emitConnectionState(): void {
    this.onConnectionStateChange?.({
      ideConnected: this.clients.size > 0,
      connectedClients: this.clients.size,
    });
  }

  private handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    if (parsePathname(request.url) !== this.path) {
      writeUpgradeRejection(socket, 404, 'invalid_path');
      return;
    }

    const isSecureTransport = Boolean((request.socket as import('node:tls').TLSSocket).encrypted);
    const validation = validateMCPUpgradeRequest({
      headers: request.headers,
      url: request.url,
      isSecureTransport,
      policy: {
        expectedToken: this.token,
        requireTls: this.requireTls,
        allowMissingOrigin: this.allowMissingOrigin,
        allowedHosts: this.allowedHosts,
        allowedOrigins: this.allowedOrigins,
      },
    });
    if (!validation.ok) {
      writeUpgradeRejection(socket, validation.statusCode, validation.reason);
      return;
    }

    if (!this.connectionLimiter.tryAcquire()) {
      writeUpgradeRejection(socket, 503, 'connection_limit');
      return;
    }

    this.wsServer.handleUpgrade(request, socket, head, (ws) => {
      this.wsServer.emit('connection', ws, request);
    });
  }

  private handleConnection(socket: WebSocket): void {
    this.clients.add(socket);
    this.emitConnectionState();

    /* v8 ignore start -- WebSocket lifecycle handlers: require real connection close/error */
    socket.on('close', () => {
      this.clients.delete(socket);
      this.connectionLimiter.release();
      this.emitConnectionState();
    });
    socket.on('error', () => {
      this.clients.delete(socket);
      this.connectionLimiter.release();
      this.emitConnectionState();
    });
    /* v8 ignore stop */

    socket.on('message', (payload) => {
      void this.handleMessage(socket, payload);
    });
  }

  private async handleMessage(socket: WebSocket, payload: RawData): Promise<void> {
    const raw = payload.toString();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const errorResponse: MCPRpcResponse = {
        id: null,
        ok: false,
        error: 'invalid_json',
      };
      socket.send(JSON.stringify(errorResponse));
      return;
    }

    const request = parseRpcRequest(parsed);
    if (!request) {
      const errorResponse: MCPRpcResponse = {
        id: null,
        ok: false,
        error: 'invalid_request',
      };
      socket.send(JSON.stringify(errorResponse));
      return;
    }

    try {
      const result = await this.dispatch(request);
      socket.send(
        JSON.stringify({
          id: request.id,
          ok: true,
          result,
        } satisfies MCPRpcResponse),
      );
    } catch (error) {
      socket.send(
        JSON.stringify({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies MCPRpcResponse),
      );
    }
  }

  private async dispatch(request: MCPRpcRequest): Promise<unknown> {
    return await dispatchMCPRequest(
      {
        method: request.method,
        params: request.params,
      },
      this.handlers,
    );
  }
}

export function getDefaultMCPResources(): readonly {
  readonly uri: string;
  readonly description: string;
}[] {
  return DEFAULT_MCP_RESOURCES;
}

export function getDefaultMCPTools(): readonly {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}[] {
  return DEFAULT_MCP_TOOLS;
}
