// packages/xifan-agents/src/observer/event-store.ts
import type { Pool } from 'pg';

interface QueuedEvent {
  readonly pool: Pool;
  readonly sessionId: string;
  readonly type: string;
  readonly toolName?: string;
  readonly payload?: unknown;
  readonly durationMs?: number;
}

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

export function recordEvent(pool: Pool, input: {
  sessionId: string;
  type: string;
  toolName?: string;
  payload?: unknown;
  durationMs?: number;
}): void {
  queue.push({ pool, ...input });
  if (!flushTimer) {
    flushTimer = setTimeout(() => { void flushQueue(); }, 100);
  }
}

export async function flushQueue(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  if (queue.length === 0) return;

  const batch = queue.splice(0, queue.length);
  // Group by pool to batch per connection
  const grouped = new Map<Pool, typeof batch>();
  for (const ev of batch) {
    const existing = grouped.get(ev.pool) ?? [];
    existing.push(ev);
    grouped.set(ev.pool, existing);
  }

  for (const [pool, events] of grouped) {
    const values = events.map((_, i) => {
      const base = i * 6;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    }).join(', ');
    const params = events.flatMap(ev => [
      ev.sessionId, ev.type, ev.toolName ?? null,
      ev.payload ? JSON.stringify(ev.payload) : null,
      ev.durationMs ?? null, Date.now(),
    ]);
    await pool.query(
      `INSERT INTO xifan_obs.events (session_id, type, tool_name, payload, duration_ms, ts) VALUES ${values}`,
      params
    ).catch(() => { /* silent degradation */ });
  }
}
