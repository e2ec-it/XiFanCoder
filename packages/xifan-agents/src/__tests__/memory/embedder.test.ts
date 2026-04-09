import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => vi.resetAllMocks());

describe('embed', () => {
  it('calls LiteLLM embeddings endpoint and returns vector', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: new Array(768).fill(0.1) }],
      }),
    });

    const { embed } = await import('../../memory/embedder.js');
    const vector = await embed('fix JWT expiry bug');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/embeddings'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(vector).toHaveLength(768);
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'error' });
    const { embed } = await import('../../memory/embedder.js');
    await expect(embed('test')).rejects.toThrow();
  });

  it('throws when embedding dimension is not 768', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: new Array(512).fill(0.1) }],
      }),
    });
    const { embed } = await import('../../memory/embedder.js');
    await expect(embed('test')).rejects.toThrow('Expected 768-dim vector');
  });
});
