// packages/xifan-agents/src/__tests__/unit/mcp-proxy.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable, Writable, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { parseFrames, makeFrame, shouldRecord, runMcpProxy } from '../../observer/mcp-proxy.js';

// Helper: create a Readable from one or more Buffer chunks
function makeReadable(chunks: Buffer[]): Readable {
  const r = new Readable({ read() {} });
  for (const chunk of chunks) {
    r.push(chunk);
  }
  r.push(null);
  return r;
}

// Helper: collect all frames from the async generator
async function collectFrames(readable: Readable): Promise<Buffer[]> {
  const results: Buffer[] = [];
  for await (const frame of parseFrames(readable)) {
    results.push(frame);
  }
  return results;
}

describe('parseFrames', () => {
  it('parses a single complete frame', async () => {
    const body = Buffer.from('{"hello":"ok"}');
    const header = `Content-Length: ${body.length}\r\n\r\n`;
    const frame = Buffer.concat([Buffer.from(header, 'ascii'), body]);

    const readable = makeReadable([frame]);
    const frames = await collectFrames(readable);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(body);
  });

  it('parses multiple frames from a single chunk', async () => {
    const body1 = Buffer.from('{"id":1,"method":"initialize"}');
    const body2 = Buffer.from('{"id":2,"method":"tools/call"}');

    const frame1 = Buffer.concat([
      Buffer.from(`Content-Length: ${body1.length}\r\n\r\n`, 'ascii'),
      body1,
    ]);
    const frame2 = Buffer.concat([
      Buffer.from(`Content-Length: ${body2.length}\r\n\r\n`, 'ascii'),
      body2,
    ]);

    const combined = Buffer.concat([frame1, frame2]);
    const readable = makeReadable([combined]);
    const frames = await collectFrames(readable);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual(body1);
    expect(frames[1]).toEqual(body2);
  });

  it('handles frame split across chunks', async () => {
    const body = Buffer.from('{"id":3,"method":"tools/list"}');
    const headerStr = `Content-Length: ${body.length}\r\n\r\n`;
    const header = Buffer.from(headerStr, 'ascii');

    // Split: first chunk has header + partial body, second chunk has the rest
    const splitAt = Math.floor(body.length / 2);
    const chunk1 = Buffer.concat([header, body.subarray(0, splitAt)]);
    const chunk2 = body.subarray(splitAt);

    const readable = makeReadable([chunk1, chunk2]);
    const frames = await collectFrames(readable);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(body);
  });

  it('handles header split across chunks', async () => {
    const body = Buffer.from('{"id":4}');
    const fullFrame = Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
      body,
    ]);

    // Split the frame in the middle of the header
    const chunk1 = fullFrame.subarray(0, 10);
    const chunk2 = fullFrame.subarray(10);

    const readable = makeReadable([chunk1, chunk2]);
    const frames = await collectFrames(readable);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(body);
  });

  it('throws on invalid Content-Length', async () => {
    const frame = Buffer.from('Content-Length: abc\r\n\r\nhello');
    const stream = makeReadable([frame]);
    const gen = parseFrames(stream);
    await expect(gen.next()).rejects.toThrow('Invalid Content-Length');
  });
});

describe('makeFrame', () => {
  it('produces correct Content-Length header', () => {
    const body = Buffer.from('{"id":1}');
    const frame = makeFrame(body);
    const frameStr = frame.toString('ascii');

    expect(frameStr).toMatch(/^Content-Length: 8\r\n\r\n/);
  });

  it('includes the original body after the header', () => {
    const body = Buffer.from('{"method":"tools/call","params":{}}');
    const frame = makeFrame(body);
    const sep = Buffer.from('\r\n\r\n', 'ascii');
    const sepIdx = frame.indexOf(sep);

    expect(sepIdx).toBeGreaterThan(-1);
    const bodyPart = frame.subarray(sepIdx + sep.length);
    expect(bodyPart).toEqual(body);
  });

  it('roundtrips through parseFrames', async () => {
    const body = Buffer.from('{"id":99,"result":{"tools":[]}}');
    const frame = makeFrame(body);
    const readable = makeReadable([frame]);
    const frames = await collectFrames(readable);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(body);
  });
});

describe('shouldRecord', () => {
  it('returns true for tools/call', () => {
    expect(shouldRecord('tools/call')).toBe(true);
  });

  it('returns false for tools/list', () => {
    expect(shouldRecord('tools/list')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(shouldRecord(undefined)).toBe(false);
  });

  it('returns false for initialize', () => {
    expect(shouldRecord('initialize')).toBe(false);
  });

  it('returns false for notifications/message', () => {
    expect(shouldRecord('notifications/message')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(shouldRecord('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runMcpProxy tests
// ---------------------------------------------------------------------------

// Helper: build an LSP frame from a JSON object
function jsonFrame(obj: Record<string, unknown>): Buffer {
  return makeFrame(Buffer.from(JSON.stringify(obj), 'utf8'));
}

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock pg.Pool
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
  const mockEnd = vi.fn().mockResolvedValue(undefined);
  return {
    Pool: vi.fn().mockImplementation(() => ({
      query: mockQuery,
      end: mockEnd,
    })),
  };
});

import { spawn } from 'node:child_process';
import { Pool } from 'pg';

const mockSpawn = vi.mocked(spawn);

describe('runMcpProxy', () => {
  let fakeStdin: PassThrough;
  let fakeTargetStdin: PassThrough;
  let fakeTargetStdout: PassThrough;
  let fakeTarget: EventEmitter & { stdin: Writable; stdout: Readable; killed: boolean };
  let origStdin: NodeJS.ReadableStream;
  let origStdout: NodeJS.WritableStream;
  let capturedStdout: Buffer[];
  let stdoutWriter: Writable;
  let origExit: typeof process.exit;

  beforeEach(() => {
    vi.clearAllMocks();

    fakeStdin = new PassThrough();
    fakeTargetStdin = new PassThrough();
    fakeTargetStdout = new PassThrough();

    fakeTarget = Object.assign(new EventEmitter(), {
      stdin: fakeTargetStdin as Writable,
      stdout: fakeTargetStdout as Readable,
      killed: false,
    });

    mockSpawn.mockReturnValue(fakeTarget as unknown as ReturnType<typeof spawn>);

    // Capture stdout writes
    capturedStdout = [];
    stdoutWriter = new Writable({
      write(chunk, _enc, cb) {
        capturedStdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
    });

    // Replace process.stdin and process.stdout for test isolation
    origStdin = process.stdin;
    origStdout = process.stdout;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: stdoutWriter, writable: true, configurable: true });

    // Prevent process.exit from actually exiting
    origExit = process.exit;
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: origStdout, writable: true, configurable: true });
    process.exit = origExit;
  });

  it('throws on targetCmd containing quotes', async () => {
    await expect(
      runMcpProxy({ targetCmd: 'node "server.js"', sessionId: 's1', databaseUrl: '' })
    ).rejects.toThrow('targetCmd contains quotes');
  });

  it('throws on empty targetCmd', async () => {
    await expect(
      runMcpProxy({ targetCmd: '', sessionId: 's1', databaseUrl: '' })
    ).rejects.toThrow('targetCmd must not be empty');
  });

  it('forwards stdin frames to target and target stdout to process stdout', async () => {
    const proxyPromise = runMcpProxy({
      targetCmd: 'node mcp-server.js',
      sessionId: 'sess-1',
      databaseUrl: 'postgresql://localhost/test',
    });

    // Send a tools/call request through stdin
    const request = jsonFrame({ id: 1, method: 'tools/call', params: { name: 'read' } });
    fakeStdin.write(request);
    fakeStdin.end();

    // Wait a tick for the frame to be processed
    await new Promise((r) => setTimeout(r, 50));

    // Simulate target responding
    const response = jsonFrame({ id: 1, result: { content: 'file contents' } });
    fakeTargetStdout.write(response);
    fakeTargetStdout.end();

    // Wait for piping
    await new Promise((r) => setTimeout(r, 50));

    // Trigger target close to resolve the proxy
    fakeTarget.emit('close', 0);

    await proxyPromise;

    // Verify spawn was called correctly
    expect(mockSpawn).toHaveBeenCalledWith('node', ['mcp-server.js'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    // Verify DB recording was attempted (pool.query called for tools/call)
    const poolInstance = (Pool as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as { query: ReturnType<typeof vi.fn> };
    expect(poolInstance.query).toHaveBeenCalled();

    // Verify stdout received the response frame
    const combined = Buffer.concat(capturedStdout);
    expect(combined.length).toBeGreaterThan(0);
    expect(combined.toString()).toContain('file contents');
  });

  it('records tools/call requests but not other methods', async () => {
    const proxyPromise = runMcpProxy({
      targetCmd: 'node server.js',
      sessionId: 'sess-2',
      databaseUrl: 'postgresql://localhost/test',
    });

    // Send a non-tools/call frame (should not be recorded)
    const initFrame = jsonFrame({ id: 10, method: 'initialize', params: {} });
    fakeStdin.write(initFrame);
    fakeStdin.end();

    await new Promise((r) => setTimeout(r, 50));
    fakeTargetStdout.end();
    await new Promise((r) => setTimeout(r, 50));

    fakeTarget.emit('close', 0);
    await proxyPromise;

    // DB query should NOT have been called for 'initialize' method
    const poolInstance = (Pool as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as { query: ReturnType<typeof vi.fn> };
    const calls = poolInstance.query.mock.calls as unknown[][];
    const recordCalls = calls.filter((c) => typeof c[0] === 'string' && c[0].includes('INSERT'));
    expect(recordCalls).toHaveLength(0);
  });

  it('handles target error event', async () => {
    const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const proxyPromise = runMcpProxy({
      targetCmd: 'node broken.js',
      sessionId: 'sess-3',
      databaseUrl: 'postgresql://localhost/test',
    });

    fakeStdin.end();
    fakeTargetStdout.end();

    await new Promise((r) => setTimeout(r, 50));

    fakeTarget.emit('error', new Error('spawn failed'));
    await proxyPromise;

    expect(process.exit).toHaveBeenCalledWith(1);
    mockConsoleError.mockRestore();
  });

  it('starts proxy in fail mode without error when DB succeeds', async () => {
    const proxyPromise = runMcpProxy({
      targetCmd: 'node server.js',
      sessionId: 'sess-4',
      databaseUrl: 'postgresql://localhost/test',
      onError: 'fail',
    });

    // Send a tools/call request (DB mock succeeds by default)
    const request = jsonFrame({ id: 1, method: 'tools/call', params: {} });
    fakeStdin.write(request);
    fakeStdin.end();

    await new Promise((r) => setTimeout(r, 50));
    fakeTargetStdout.end();
    await new Promise((r) => setTimeout(r, 50));

    fakeTarget.emit('close', 0);
    await proxyPromise;

    // Verify DB recording was attempted
    const poolInstance = (Pool as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as { query: ReturnType<typeof vi.fn> };
    expect(poolInstance.query).toHaveBeenCalled();
  });

  it('handles DB write error in bypass mode gracefully', async () => {
    const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Pre-configure Pool mock to reject
    const PoolCtor = Pool as unknown as ReturnType<typeof vi.fn>;
    PoolCtor.mockImplementationOnce(() => ({
      query: vi.fn().mockRejectedValue(new Error('DB down')),
      end: vi.fn().mockResolvedValue(undefined),
    }));

    const proxyPromise = runMcpProxy({
      targetCmd: 'node server.js',
      sessionId: 'sess-bypass',
      databaseUrl: 'postgresql://localhost/test',
      onError: 'bypass',
    });

    const request = jsonFrame({ id: 1, method: 'tools/call', params: {} });
    fakeStdin.write(request);
    fakeStdin.end();

    await new Promise((r) => setTimeout(r, 50));
    fakeTargetStdout.end();
    await new Promise((r) => setTimeout(r, 50));

    fakeTarget.emit('close', 0);
    await proxyPromise;

    // Bypass mode logs the error and continues
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('DB write error'),
      expect.any(Error),
    );
    mockConsoleError.mockRestore();
  });

  it('forwards non-JSON stdin data without recording', async () => {
    const proxyPromise = runMcpProxy({
      targetCmd: 'node server.js',
      sessionId: 'sess-nonjson',
      databaseUrl: 'postgresql://localhost/test',
    });

    // Send a frame with invalid JSON content
    const invalidFrame = makeFrame(Buffer.from('not valid json'));
    fakeStdin.write(invalidFrame);
    fakeStdin.end();

    await new Promise((r) => setTimeout(r, 50));
    fakeTargetStdout.end();
    await new Promise((r) => setTimeout(r, 50));

    fakeTarget.emit('close', 0);
    await proxyPromise;

    // Should not crash, and no DB recording
    const poolInstance = (Pool as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as { query: ReturnType<typeof vi.fn> };
    const insertCalls = (poolInstance.query.mock.calls as unknown[][]).filter(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT'),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('forwards non-JSON target stdout without recording', async () => {
    const proxyPromise = runMcpProxy({
      targetCmd: 'node server.js',
      sessionId: 'sess-nonjson-out',
      databaseUrl: 'postgresql://localhost/test',
    });

    fakeStdin.end();

    // Target responds with non-JSON
    fakeTargetStdout.write(makeFrame(Buffer.from('not json response')));
    fakeTargetStdout.end();

    await new Promise((r) => setTimeout(r, 50));

    fakeTarget.emit('close', 0);
    await proxyPromise;

    // Non-JSON responses are forwarded but not recorded
    const combined = Buffer.concat(capturedStdout);
    expect(combined.toString()).toContain('not json response');
  });

  it('correlates response to pending request and records it', async () => {
    const proxyPromise = runMcpProxy({
      targetCmd: 'node server.js',
      sessionId: 'sess-correlate',
      databaseUrl: 'postgresql://localhost/test',
    });

    // Send a tools/call request with id 42
    fakeStdin.write(jsonFrame({ id: 42, method: 'tools/call', params: { name: 'read' } }));
    fakeStdin.end();

    await new Promise((r) => setTimeout(r, 50));

    // Target responds with matching id 42
    fakeTargetStdout.write(jsonFrame({ id: 42, result: { data: 'ok' } }));
    fakeTargetStdout.end();

    await new Promise((r) => setTimeout(r, 50));

    fakeTarget.emit('close', 0);
    await proxyPromise;

    // DB should have recorded both request and response
    const poolInstance = (Pool as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as { query: ReturnType<typeof vi.fn> };
    const insertCalls = (poolInstance.query.mock.calls as unknown[][]).filter(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT'),
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not record response for non-pending id', async () => {
    const proxyPromise = runMcpProxy({
      targetCmd: 'node server.js',
      sessionId: 'sess-nopending',
      databaseUrl: 'postgresql://localhost/test',
    });

    fakeStdin.end();

    // Target responds with an id that was never requested
    fakeTargetStdout.write(jsonFrame({ id: 999, result: {} }));
    fakeTargetStdout.end();

    await new Promise((r) => setTimeout(r, 50));

    fakeTarget.emit('close', 0);
    await proxyPromise;

    // No INSERT calls (no request was recorded, no matching pending)
    const poolInstance = (Pool as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as { query: ReturnType<typeof vi.fn> };
    const insertCalls = (poolInstance.query.mock.calls as unknown[][]).filter(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT'),
    );
    expect(insertCalls).toHaveLength(0);
  });
});
