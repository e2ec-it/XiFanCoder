import type { Pool } from 'pg';

import { saveMemory } from './store.js';

const REFLECTION_MODEL = process.env['XIFAN_REFLECTION_MODEL'] ?? 'qwen2.5-coder-32b';
const LITELLM_BASE = process.env['LITELLM_BASE_URL'] ?? 'http://localhost:4000';
const LITELLM_KEY  = process.env['LITELLM_API_KEY'] ?? '';

export interface ReflectionOptions {
  readonly minCount?: number; // min episodics to trigger (default 20)
}

export async function reflectOnEpisodics(pool: Pool, opts: ReflectionOptions = {}): Promise<void> {
  const minCount = opts.minCount ?? 20;

  // Fetch recent unprocessed episodics (created after last reflective memory)
  const { rows: episodics } = await pool.query<{ id: string; summary: string }>(
    `SELECT id, summary FROM xifan_mem.memories
     WHERE type = 'episodic'
       AND created_at > (
         SELECT COALESCE(MAX(created_at), 0) FROM xifan_mem.memories WHERE type = 'reflective'
       )
     ORDER BY created_at DESC LIMIT 100`,
  );

  if (episodics.length < minCount) return;

  const clusters = clusterBySimilarity(episodics.map((e) => e.summary));

  for (const cluster of clusters) {
    if (cluster.length < 2) continue;

    const prompt = `以下是相似的编程经验记录，请提炼共同规律，生成一条可复用的洞察（100字以内）：\n\n${cluster.join('\n')}`;

    const res = await fetch(`${LITELLM_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LITELLM_KEY}`,
      },
      body: JSON.stringify({
        model: REFLECTION_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
      }),
    });

    if (!res.ok) continue;

    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const summary = data.choices[0]?.message.content?.trim();
    if (!summary) continue;

    await saveMemory(pool, { type: 'reflective', summary, salience: 1.2 });
  }
}

function clusterBySimilarity(summaries: string[]): string[][] {
  // Simple keyword-overlap clustering (Jaccard >= 0.3)
  const clusters: string[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < summaries.length; i++) {
    if (assigned.has(i)) continue;
    const cluster = [summaries[i]!];
    assigned.add(i);
    const wordsI = new Set(summaries[i]!.split(/\s+/));
    for (let j = i + 1; j < summaries.length; j++) {
      if (assigned.has(j)) continue;
      const wordsJ = new Set(summaries[j]!.split(/\s+/));
      const intersection = [...wordsI].filter((w) => wordsJ.has(w)).length;
      const union = new Set([...wordsI, ...wordsJ]).size;
      if (intersection / union >= 0.3) {
        cluster.push(summaries[j]!);
        assigned.add(j);
      }
    }
    clusters.push(cluster);
  }

  return clusters;
}
