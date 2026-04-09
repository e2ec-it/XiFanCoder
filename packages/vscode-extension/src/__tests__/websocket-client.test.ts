import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { XiFanWebSocketClient, type WebSocketLike } from '../websocket-client.js';

class FakeWebSocket extends EventEmitter implements WebSocketLike {
  public readyState = 0;
  public readonly sent: string[] = [];
  public closeCalled = 0;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalled += 1;
    this.readyState = 3;
    this.emit('close', 1000, Buffer.from('bye', 'utf8'));
  }

  open(): void {
    this.readyState = 1;
    this.emit('open');
  }

  fail(error: Error): void {
    this.emit('error', error);
  }

  pushMessage(payload: unknown): void {
    this.emit('message', payload);
  }
}

describe('XiFanWebSocketClient', () => {
  it('connects, receives JSON messages, and sends payload', async () => {
    const socket = new FakeWebSocket();
    const statuses: string[] = [];
    const messages: Array<{ text: string; json: unknown }> = [];

    const client = new XiFanWebSocketClient({
      url: 'ws://127.0.0.1:8787/mcp',
      createSocket: () => socket,
      onStatus: (status) => statuses.push(status),
      onMessage: (message) => messages.push({ text: message.text, json: message.json }),
    });

    const connectPromise = client.connect();
    socket.open();
    await connectPromise;

    socket.pushMessage(Buffer.from('{"ok":true}', 'utf8'));
    client.send({ type: 'ping' });

    expect(client.isConnected).toBe(true);
    expect(statuses).toContain('connected');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.json).toEqual({ ok: true });
    expect(socket.sent).toEqual(['{"type":"ping"}']);
  });

  it('rejects connect when websocket emits error before open', async () => {
    const socket = new FakeWebSocket();
    const client = new XiFanWebSocketClient({
      url: 'ws://127.0.0.1:8787/mcp',
      createSocket: () => socket,
    });

    const connectPromise = client.connect();
    socket.fail(new Error('connection refused'));
    await expect(connectPromise).rejects.toThrow('connection refused');
    expect(client.isConnected).toBe(false);
  });

  it('throws if sending before connected', () => {
    const client = new XiFanWebSocketClient({
      url: 'ws://127.0.0.1:8787/mcp',
      createSocket: () => new FakeWebSocket(),
    });

    expect(() => {
      client.send('ping');
    }).toThrow('websocket is not connected');
  });

  it('disconnects active websocket connection', async () => {
    const socket = new FakeWebSocket();
    const statuses: string[] = [];

    const client = new XiFanWebSocketClient({
      url: 'ws://127.0.0.1:8787/mcp',
      createSocket: () => socket,
      onStatus: (status) => statuses.push(status),
    });

    const connectPromise = client.connect();
    socket.open();
    await connectPromise;

    client.disconnect();

    expect(socket.closeCalled).toBe(1);
    expect(client.isConnected).toBe(false);
    expect(statuses).toContain('disconnected');
  });

  it('handles string, array, typed-array and close-status payload branches', async () => {
    const socket = new FakeWebSocket();
    const statuses: string[] = [];
    const messages: Array<{ text: string; json: unknown }> = [];

    const client = new XiFanWebSocketClient({
      url: 'ws://127.0.0.1:8787/mcp',
      createSocket: () => socket,
      onStatus: (status) => statuses.push(status),
      onMessage: (message) => messages.push({ text: message.text, json: message.json }),
    });

    const connectPromise = client.connect();
    socket.open();
    await connectPromise;

    socket.pushMessage('plain text');
    socket.pushMessage([Buffer.from('["a"'), Buffer.from(',"b"]')]);
    socket.pushMessage(new Uint8Array(Buffer.from('{"typed":true}', 'utf8')));
    socket.close();

    expect(messages).toEqual([
      { text: 'plain text', json: undefined },
      { text: '["a","b"]', json: ['a', 'b'] },
      { text: '{"typed":true}', json: { typed: true } },
    ]);
    expect(statuses).toContain('closed code=1000 reason=bye');
    expect(client.isConnected).toBe(false);
  });

  it('treats invalid json as plain text and reports already connected state', async () => {
    const socket = new FakeWebSocket();
    const statuses: string[] = [];
    const messages: Array<{ text: string; json: unknown }> = [];

    const client = new XiFanWebSocketClient({
      url: 'ws://127.0.0.1:8787/mcp',
      createSocket: () => socket,
      onStatus: (status) => statuses.push(status),
      onMessage: (message) => messages.push({ text: message.text, json: message.json }),
    });

    const connectPromise = client.connect();
    socket.open();
    await connectPromise;

    await client.connect();
    socket.pushMessage('{oops');

    expect(statuses).toContain('already connected');
    expect(messages).toEqual([{ text: '{oops', json: undefined }]);
  });

  it('handles ArrayBuffer payload via toText', async () => {
    const socket = new FakeWebSocket();
    const messages: Array<{ text: string; json: unknown }> = [];

    const client = new XiFanWebSocketClient({
      url: 'ws://127.0.0.1:8787/mcp',
      createSocket: () => socket,
      onMessage: (message) => messages.push({ text: message.text, json: message.json }),
    });

    const connectPromise = client.connect();
    socket.open();
    await connectPromise;

    const buf = Buffer.from('{"ab":1}', 'utf8');
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    socket.pushMessage(ab);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.json).toEqual({ ab: 1 });
  });

  it('handles unknown payload type via String() fallback in toText', async () => {
    const socket = new FakeWebSocket();
    const messages: Array<{ text: string; json: unknown }> = [];

    const client = new XiFanWebSocketClient({
      url: 'ws://127.0.0.1:8787/mcp',
      createSocket: () => socket,
      onMessage: (message) => messages.push({ text: message.text, json: message.json }),
    });

    const connectPromise = client.connect();
    socket.open();
    await connectPromise;

    socket.pushMessage(12345);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe('12345');
    expect(messages[0]?.json).toBeUndefined();
  });

  it('ignores duplicate error after socket already settled', async () => {
    const socket = new FakeWebSocket();
    const errors: Error[] = [];

    const client = new XiFanWebSocketClient({
      url: 'ws://127.0.0.1:8787/mcp',
      createSocket: () => socket,
      onError: (error) => errors.push(error),
    });

    const connectPromise = client.connect();
    socket.open();
    await connectPromise;

    // After open resolved, emit an error — rejectOnce should return early
    socket.fail(new Error('late error'));

    expect(client.isConnected).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('late error');
  });

  it('ignores repeated disconnect when socket is absent', () => {
    const statuses: string[] = [];
    const client = new XiFanWebSocketClient({
      url: 'ws://127.0.0.1:8787/mcp',
      createSocket: () => new FakeWebSocket(),
      onStatus: (status) => statuses.push(status),
    });

    client.disconnect();

    expect(statuses).toEqual([]);
  });
});
