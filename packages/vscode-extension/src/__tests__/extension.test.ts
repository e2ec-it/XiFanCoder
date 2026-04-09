import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeOutputChannel = {
  appendLine: (line: string) => void;
  dispose: () => void;
};

type FakeContext = {
  subscriptions: Array<{ dispose: () => void }>;
};

const commandHandlers = new Map<string, () => unknown | Promise<unknown>>();
const outputLines: string[] = [];
const infoMessages: string[] = [];
const warningMessages: string[] = [];
const errorMessages: string[] = [];
const inputQueue: Array<string | undefined> = [];

let configuredUrl = '';

class MockXiFanWebSocketClient {
  static instances: MockXiFanWebSocketClient[] = [];
  static failNextConnect = false;
  static failNextSend = false;

  public isConnected = false;
  public readonly sent: unknown[] = [];
  public disconnectCalls = 0;

  constructor(
    private readonly options: {
      url: string;
      token?: string;
      onStatus?: (status: string) => void;
      onMessage?: (message: { text: string }) => void;
      onError?: (error: Error) => void;
    },
  ) {
    MockXiFanWebSocketClient.instances.push(this);
  }

  async connect(): Promise<void> {
    this.options.onStatus?.(`connecting ${this.options.url}`);
    if (MockXiFanWebSocketClient.failNextConnect) {
      MockXiFanWebSocketClient.failNextConnect = false;
      const error = new Error('boom connect');
      this.options.onError?.(error);
      throw error;
    }
    this.isConnected = true;
    this.options.onStatus?.('connected');
  }

  send(payload: unknown): void {
    if (MockXiFanWebSocketClient.failNextSend) {
      MockXiFanWebSocketClient.failNextSend = false;
      throw new Error('boom send');
    }
    this.sent.push(payload);
    this.options.onMessage?.({ text: JSON.stringify(payload) });
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.isConnected = false;
    this.options.onStatus?.('disconnected');
  }
}

vi.mock('vscode', () => {
  return {
    workspace: {
      getConfiguration: () => ({
        get: () => configuredUrl,
      }),
    },
    window: {
      createOutputChannel: (): FakeOutputChannel => ({
        appendLine: (line: string) => {
          outputLines.push(line);
        },
        dispose: () => undefined,
      }),
      showInputBox: vi.fn(async () => inputQueue.shift()),
      showInformationMessage: vi.fn((message: string) => {
        infoMessages.push(message);
      }),
      showWarningMessage: vi.fn((message: string) => {
        warningMessages.push(message);
      }),
      showErrorMessage: vi.fn((message: string) => {
        errorMessages.push(message);
      }),
    },
    commands: {
      registerCommand: (id: string, handler: () => unknown | Promise<unknown>) => {
        commandHandlers.set(id, handler);
        return { dispose: () => undefined };
      },
    },
  };
});

vi.mock('../websocket-client.js', () => ({
  XiFanWebSocketClient: MockXiFanWebSocketClient,
}));

async function loadExtensionModule() {
  return await import('../extension.js');
}

function makeContext(): FakeContext {
  return { subscriptions: [] };
}

beforeEach(() => {
  commandHandlers.clear();
  outputLines.length = 0;
  infoMessages.length = 0;
  warningMessages.length = 0;
  errorMessages.length = 0;
  inputQueue.length = 0;
  configuredUrl = '';
  MockXiFanWebSocketClient.instances.length = 0;
  MockXiFanWebSocketClient.failNextConnect = false;
  MockXiFanWebSocketClient.failNextSend = false;
});

afterEach(async () => {
  const mod = await loadExtensionModule();
  mod.deactivate();
  vi.clearAllMocks();
});

describe('extension activation', () => {
  it('registers commands and connects, sends, disconnects through the command handlers', async () => {
    configuredUrl = '  ws://configured.example/mcp  ';
    inputQueue.push('  ws://manual.example/mcp  ', '  token-123  ', '  hello xifan  ');

    const mod = await loadExtensionModule();
    mod.activate(makeContext() as never);

    expect(commandHandlers.has('xifan.connectWebSocket')).toBe(true);
    expect(commandHandlers.has('xifan.sendMessage')).toBe(true);
    expect(commandHandlers.has('xifan.disconnectWebSocket')).toBe(true);
    expect(outputLines).toContain('XiFan extension activated');

    await commandHandlers.get('xifan.connectWebSocket')?.();

    const client = MockXiFanWebSocketClient.instances[0];
    expect(client).toBeDefined();
    expect(infoMessages).toContain('XiFan connected: ws://manual.example/mcp');
    expect(outputLines).toContain('[status] connecting ws://manual.example/mcp');
    expect(outputLines).toContain('[status] connected');

    await commandHandlers.get('xifan.sendMessage')?.();

    expect(client?.sent).toEqual([
      {
        type: 'user_message',
        content: 'hello xifan',
        source: 'vscode',
      },
    ]);
    expect(outputLines).toContain('[send] hello xifan');
    expect(outputLines).toContain('[recv] {"type":"user_message","content":"hello xifan","source":"vscode"}');

    commandHandlers.get('xifan.disconnectWebSocket')?.();

    expect(client?.disconnectCalls).toBe(1);
    expect(infoMessages).toContain('XiFan WebSocket disconnected');
    expect(outputLines).toContain('[status] disconnected by command');
  });

  it('returns early on empty inputs and warns when sending without a connection', async () => {
    inputQueue.push('', '');

    const mod = await loadExtensionModule();
    mod.activate(makeContext() as never);

    await commandHandlers.get('xifan.connectWebSocket')?.();
    expect(MockXiFanWebSocketClient.instances).toHaveLength(0);

    await commandHandlers.get('xifan.sendMessage')?.();
    expect(warningMessages).toContain('XiFan WebSocket 未连接，请先执行 “XiFan: Connect WebSocket”。');

    commandHandlers.get('xifan.disconnectWebSocket')?.();
    expect(outputLines).not.toContain('[status] disconnected by command');
  });

  it('replaces the previous client and reports connect/send failures', async () => {
    inputQueue.push('ws://first.example/mcp', undefined);

    const mod = await loadExtensionModule();
    mod.activate(makeContext() as never);

    await commandHandlers.get('xifan.connectWebSocket')?.();
    const firstClient = MockXiFanWebSocketClient.instances[0];
    expect(firstClient?.disconnectCalls).toBe(0);

    inputQueue.push('ws://second.example/mcp', 'next-token');
    MockXiFanWebSocketClient.failNextConnect = true;
    const secondConnect = commandHandlers.get('xifan.connectWebSocket');
    await secondConnect?.();

    expect(firstClient?.disconnectCalls).toBe(1);
    expect(errorMessages).toContain('XiFan connect failed: boom connect');
    expect(outputLines).toContain('[error] connect failed: boom connect');

    inputQueue.push('ws://second.example/mcp', 'next-token');
    await secondConnect?.();

    MockXiFanWebSocketClient.failNextSend = true;
    inputQueue.push('message that will fail');
    await commandHandlers.get('xifan.sendMessage')?.();

    expect(errorMessages).toContain('XiFan send failed: boom send');
    expect(outputLines).toContain('[error] send failed: boom send');
  });

  it('returns early when send text input is empty after connection is active', async () => {
    inputQueue.push('ws://active.example/mcp', undefined);

    const mod = await loadExtensionModule();
    mod.activate(makeContext() as never);

    await commandHandlers.get('xifan.connectWebSocket')?.();
    const client = MockXiFanWebSocketClient.instances.at(-1);
    expect(client?.isConnected).toBe(true);

    // User cancels input (undefined) or provides empty string
    inputQueue.push(undefined);
    await commandHandlers.get('xifan.sendMessage')?.();

    // No message should have been sent
    expect(client?.sent).toHaveLength(0);
  });

  it('disconnects the active client during deactivate', async () => {
    const mod = await loadExtensionModule();
    mod.activate(makeContext() as never);

    inputQueue.splice(0, inputQueue.length, 'ws://active.example/mcp', undefined);
    await commandHandlers.get('xifan.connectWebSocket')?.();

    const activeClient = MockXiFanWebSocketClient.instances.at(-1);
    mod.deactivate();

    expect(activeClient?.disconnectCalls).toBe(1);
  });
});
