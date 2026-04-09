import type { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'emotional' | 'reflective';

export interface MemoryRecord {
  readonly id: string;
  readonly type: MemoryType;
  readonly summary: string;
  readonly payload: unknown;
  readonly salience: number;
  readonly project: string | null;
  readonly created_at: string;
  readonly accessed_at: string;
}

export interface SaveMemoryInput {
  readonly type: MemoryType;
  readonly summary: string;
  readonly payload?: unknown;
  readonly embedding?: number[];
  readonly salience?: number;
  readonly project?: string;
}

export async function saveMemory(pool: Pool, input: SaveMemoryInput): Promise<string> {
  const id = uuidv4();
  const now = Date.now();
  await pool.query(
    `INSERT INTO xifan_mem.memories
      (id, type, summary, payload, embedding, salience, project, created_at, accessed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [
      id,
      input.type,
      input.summary,
      input.payload ? JSON.stringify(input.payload) : null,
      input.embedding ? `[${input.embedding.join(',')}]` : null,
      input.salience ?? 1.0,
      input.project ?? null,
      now,
    ],
  );
  return id;
}

export async function getMemory(pool: Pool, id: string): Promise<MemoryRecord | undefined> {
  const { rows } = await pool.query<MemoryRecord>(
    'SELECT id, type, summary, payload, salience, project, created_at::text, accessed_at::text FROM xifan_mem.memories WHERE id = $1',
    [id],
  );
  return rows[0];
}
