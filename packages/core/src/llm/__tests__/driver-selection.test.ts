import { describe, expect, it } from 'vitest';

import {
  detectLiteLLMProxyOnline,
  resolveLLMDriverMode,
} from '../driver-selection.js';

describe('resolveLLMDriverMode', () => {
  it('selects forced builtin mode without probing', async () => {
    const resolved = await resolveLLMDriverMode({ mode: 'builtin' });
    expect(resolved.selectedDriver).toBe('builtin');
    expect(resolved.reason).toBe('forced_builtin');
  });

  it('falls back to builtin when auto mode and LiteLLM is unavailable', async () => {
    const resolved = await resolveLLMDriverMode({
      mode: 'auto',
      detectLiteLLMOnline: async () => false,
    });

    expect(resolved.selectedDriver).toBe('builtin');
    expect(resolved.reason).toBe('auto_no_litellm');
  });

  it('asks for confirmation and selects LiteLLM when user accepts', async () => {
    const resolved = await resolveLLMDriverMode({
      mode: 'auto',
      detectLiteLLMOnline: async () => true,
      confirmUseLiteLLM: async () => true,
    });

    expect(resolved.selectedDriver).toBe('litellm');
    expect(resolved.reason).toBe('auto_user_accepted');
  });

  it('falls back when confirmation prompt is unavailable', async () => {
    const resolved = await resolveLLMDriverMode({
      mode: 'auto',
      detectLiteLLMOnline: async () => true,
    });

    expect(resolved.selectedDriver).toBe('builtin');
    expect(resolved.reason).toBe('auto_prompt_unavailable');
  });

  it('falls back when user declines LiteLLM prompt', async () => {
    const resolved = await resolveLLMDriverMode({
      mode: 'auto',
      detectLiteLLMOnline: async () => true,
      confirmUseLiteLLM: async () => false,
    });

    expect(resolved.selectedDriver).toBe('builtin');
    expect(resolved.reason).toBe('auto_user_declined');
  });

  it('uses builtin in headless mode even when LiteLLM is detected', async () => {
    const resolved = await resolveLLMDriverMode({
      mode: 'auto',
      headless: true,
      detectLiteLLMOnline: async () => true,
      confirmUseLiteLLM: async () => true,
    });

    expect(resolved.selectedDriver).toBe('builtin');
    expect(resolved.reason).toBe('auto_headless_fallback');
  });

  it('selects forced litellm mode without probing', async () => {
    const resolved = await resolveLLMDriverMode({ mode: 'litellm' });
    expect(resolved.selectedDriver).toBe('litellm');
    expect(resolved.reason).toBe('forced_litellm');
  });

  it('uses default options when called with no arguments', async () => {
    const resolved = await resolveLLMDriverMode({
      detectLiteLLMOnline: async () => false,
    });
    expect(resolved.selectedDriver).toBe('builtin');
    expect(resolved.litellmBaseUrl).toBe('http://localhost:4000');
  });

  it('uses custom detectTimeoutMs option', async () => {
    let receivedTimeout = 0;
    const resolved = await resolveLLMDriverMode({
      mode: 'auto',
      detectTimeoutMs: 500,
      detectLiteLLMOnline: async (_url, timeout) => {
        receivedTimeout = timeout;
        return false;
      },
    });
    expect(resolved.selectedDriver).toBe('builtin');
    expect(receivedTimeout).toBe(500);
  });
});

describe('detectLiteLLMProxyOnline', () => {
  it('returns true when /v1/models endpoint is healthy', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];

    globalThis.fetch = (async (input: URL | RequestInfo): Promise<Response> => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/v1/models')) {
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    try {
      const online = await detectLiteLLMProxyOnline('http://localhost:4000');
      expect(online).toBe(true);
      expect(calls[0]).toBe('http://localhost:4000/v1/models');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to /models when first candidate fails', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];

    globalThis.fetch = (async (input: URL | RequestInfo): Promise<Response> => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/v1/models')) {
        return new Response('{}', { status: 500 });
      }
      if (url.endsWith('/models')) {
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    try {
      const online = await detectLiteLLMProxyOnline('http://localhost:4000');
      expect(online).toBe(true);
      expect(calls).toContain('http://localhost:4000/v1/models');
      expect(calls).toContain('http://localhost:4000/models');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('only probes /v1/models when URL already ends with /v1', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];

    globalThis.fetch = (async (input: URL | RequestInfo): Promise<Response> => {
      const url = String(input);
      calls.push(url);
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const online = await detectLiteLLMProxyOnline('http://localhost:4000/v1');
      expect(online).toBe(true);
      expect(calls).toEqual(['http://localhost:4000/v1/models']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns false when all probes fail', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (): Promise<Response> => {
      throw new Error('network-error');
    }) as typeof fetch;

    try {
      const online = await detectLiteLLMProxyOnline('http://localhost:4000');
      expect(online).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
