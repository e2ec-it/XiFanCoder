const LITELLM_BASE = process.env['LITELLM_BASE_URL'] ?? 'http://localhost:4000';
const LITELLM_KEY  = process.env['LITELLM_API_KEY'] ?? '';
const EMBED_MODEL  = process.env['XIFAN_EMBED_MODEL'] ?? 'bge-code';

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${LITELLM_BASE}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LITELLM_KEY}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${msg}`);
  }

  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const vector = data.data[0]?.embedding;
  if (!vector || vector.length !== 768) {
    throw new Error(`Expected 768-dim vector, got ${vector?.length}`);
  }
  return vector;
}
