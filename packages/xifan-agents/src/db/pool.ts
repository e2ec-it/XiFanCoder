// packages/xifan-agents/src/db/pool.ts
import { Pool } from 'pg';

let _pool: Pool | undefined;

export function getPool(connectionString?: string): Pool {
  if (_pool) return _pool;
  const cs = connectionString ?? process.env['DATABASE_URL'];
  if (!cs) throw new Error('DATABASE_URL not set');
  _pool = new Pool({ connectionString: cs, max: 5 });
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
  }
}
