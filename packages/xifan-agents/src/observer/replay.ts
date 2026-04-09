// packages/xifan-agents/src/observer/replay.ts
import type { Pool } from 'pg';

export interface ReplayEvent {
  readonly id: string;
  readonly type: string;
  readonly tool_name: string | null;
  readonly payload: unknown;
  readonly duration_ms: number | null;
  readonly ts: string;
}

export async function getReplay(pool: Pool, sessionId: string): Promise<readonly ReplayEvent[]> {
  const { rows } = await pool.query<ReplayEvent>(
    `SELECT id::text, type, tool_name, payload, duration_ms, ts::text
     FROM xifan_obs.events
     WHERE session_id = $1
     ORDER BY ts ASC, id ASC`,
    [sessionId]
  );
  return rows;
}
