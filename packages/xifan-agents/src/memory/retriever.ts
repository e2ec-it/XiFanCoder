import type { Pool } from 'pg';

import { embed } from './embedder.js';
import type { MemoryRecord } from './store.js';

export interface SearchResult extends MemoryRecord {
  readonly rrf_score: number;
}

export interface SearchOptions {
  readonly topK?: number;
  readonly project?: string;
}

export async function hybridSearch(
  pool: Pool,
  query: string,
  options: SearchOptions = {},
): Promise<readonly SearchResult[]> {
  const topK = options.topK ?? 5;
  const vector = await embed(query);
  const vecStr = `[${vector.join(',')}]`;

  // RRF fusion: cosine top-20 + BM25 top-20 → merged top-K
  const withProject = options.project !== undefined;
  const { rows } = await pool.query<SearchResult>(
    `WITH cosine AS (
      SELECT id, summary, type, payload, salience, project,
             created_at::text, accessed_at::text,
             ROW_NUMBER() OVER (ORDER BY embedding <=> $1) AS rank
      FROM xifan_mem.memories
      WHERE embedding IS NOT NULL
      ${withProject ? 'AND (project = $3 OR project IS NULL)' : ''}
      ORDER BY embedding <=> $1
      LIMIT 20
    ),
    bm25 AS (
      SELECT id, summary, type, payload, salience, project,
             created_at::text, accessed_at::text,
             ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, plainto_tsquery('simple', $2)) DESC) AS rank
      FROM xifan_mem.memories
      WHERE tsv @@ plainto_tsquery('simple', $2)
      ${withProject ? 'AND (project = $3 OR project IS NULL)' : ''}
      LIMIT 20
    ),
    rrf AS (
      SELECT COALESCE(c.id, b.id) AS id,
             COALESCE(c.summary, b.summary) AS summary,
             COALESCE(c.type, b.type) AS type,
             COALESCE(c.payload, b.payload) AS payload,
             COALESCE(c.salience, b.salience) AS salience,
             COALESCE(c.project, b.project) AS project,
             COALESCE(c.created_at, b.created_at) AS created_at,
             COALESCE(c.accessed_at, b.accessed_at) AS accessed_at,
             COALESCE(1.0/(60 + c.rank), 0) + COALESCE(1.0/(60 + b.rank), 0) AS rrf_score
      FROM cosine c FULL OUTER JOIN bm25 b USING (id)
    )
    SELECT * FROM rrf ORDER BY rrf_score DESC LIMIT $${withProject ? 4 : 3}`,
    withProject ? [vecStr, query, options.project, topK] : [vecStr, query, topK],
  );

  // Update accessed_at (fire-and-forget)
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    pool
      .query('UPDATE xifan_mem.memories SET accessed_at = $1 WHERE id = ANY($2)', [Date.now(), ids])
      .catch(() => { /* silent */ });
  }

  return rows;
}
