import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWebContent } from '../web-fetch.js';

describe('fetchWebContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches response and generates fallback summary', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('Hello world from XiFan', {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWebContent({
      url: 'https://example.com/hello',
    });

    expect(result.status).toBe(200);
    expect(result.summary).toContain('Hello world');
    expect(result.excerpt).toContain('Hello world');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('supports injected summarizer callback', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('content', {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWebContent(
      {
        url: 'https://example.com',
        prompt: 'summarize',
      },
      {
        summarizer: (input) => `summary:${input.prompt}:${input.content}`,
      },
    );

    expect(result.summary).toBe('summary:summarize:content');
  });

  it('honors maxBytes and marks truncated', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('1234567890', {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWebContent({
      url: 'https://example.com',
      maxBytes: 4,
    });

    expect(result.excerpt).toBe('1234');
    expect(result.truncated).toBe(true);
  });

  it('rejects invalid positive integer params', async () => {
    await expect(
      fetchWebContent({ url: 'https://example.com', timeoutMs: -1 }),
    ).rejects.toThrowError('invalid timeoutMs');

    await expect(
      fetchWebContent({ url: 'https://example.com', maxBytes: 0 }),
    ).rejects.toThrowError('invalid maxBytes');
  });

  it('rejects invalid URL', async () => {
    await expect(
      fetchWebContent({ url: 'not-a-url' }),
    ).rejects.toThrowError('invalid url');
  });

  it('rejects unsupported protocol', async () => {
    await expect(
      fetchWebContent({ url: 'ftp://example.com/file' }),
    ).rejects.toThrowError('unsupported protocol');
  });

  it('handles null response body', async () => {
    const fetchMock = vi.fn(async () => {
      const res = new Response(null, {
        status: 204,
        headers: { 'content-type': 'text/plain' },
      });
      return res;
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWebContent({ url: 'https://example.com/empty' });
    expect(result.fetchedBytes).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('uses fallback summary with empty body', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWebContent({ url: 'https://example.com/blank' });
    expect(result.summary).toContain('response body is empty');
  });

  it('uses fallback summary with prompt', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('some content', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWebContent({
      url: 'https://example.com',
      prompt: 'summarize this',
    });
    expect(result.summary).toContain('Prompt: summarize this');
    expect(result.summary).toContain('Summary:');
  });

  it('truncates when maxBytes exactly consumed before next chunk', async () => {
    // Create a response where chunks exactly fill maxBytes, then one more arrives
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('ab'));  // 2 bytes, fills exactly maxBytes=2
        controller.enqueue(encoder.encode('cd'));  // hits remaining <= 0
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () =>
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWebContent({
      url: 'https://example.com',
      maxBytes: 2,
    });

    expect(result.truncated).toBe(true);
    expect(result.fetchedBytes).toBe(2);
    expect(result.excerpt).toBe('ab');
  });

  it('truncates when stream exceeds maxBytes across chunks', async () => {
    // Create a response with a readable stream that delivers multiple chunks
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Send multiple chunks totaling more than maxBytes
        controller.enqueue(encoder.encode('abc'));
        controller.enqueue(encoder.encode('def'));
        controller.enqueue(encoder.encode('ghi'));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () =>
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWebContent({
      url: 'https://example.com',
      maxBytes: 5,
    });

    expect(result.truncated).toBe(true);
    expect(result.fetchedBytes).toBe(5);
    // First chunk "abc" fits fully (3 bytes), second chunk "def" is sliced to 2 bytes
    expect(result.excerpt).toBe('abcde');
  });

  it('wraps fetch network errors', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWebContent({ url: 'https://example.com' }),
    ).rejects.toThrowError('request failed: network down');
  });
});
