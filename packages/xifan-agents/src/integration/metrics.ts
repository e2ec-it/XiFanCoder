import type { Pool } from 'pg';

export interface AgentMetrics {
  totalSessions: number;
  completedSessions: number;
  totalMemories: number;
  avgQualityScore: number;
  topSkills: Array<{ summary: string; salience: number }>;
}

export async function collectMetrics(pool: Pool): Promise<AgentMetrics> {
  const [sessionsResult, memoriesResult, skillsResult] = await Promise.all([
    pool.query<{ total: string; completed: string }>(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed
      FROM xifan_obs.sessions
    `),
    pool.query<{ total: string; avg_salience: string }>(`
      SELECT COUNT(*) AS total, AVG(salience) AS avg_salience
      FROM xifan_mem.memories
    `),
    pool.query<{ summary: string; salience: number }>(`
      SELECT summary, salience
      FROM xifan_mem.memories
      WHERE type = 'procedural'
      ORDER BY salience DESC
      LIMIT 5
    `),
  ]);

  const sessRow = sessionsResult.rows[0];
  const memRow = memoriesResult.rows[0];

  return {
    totalSessions: Number(sessRow?.total ?? 0),
    completedSessions: Number(sessRow?.completed ?? 0),
    totalMemories: Number(memRow?.total ?? 0),
    avgQualityScore: Number(memRow?.avg_salience ?? 0),
    topSkills: skillsResult.rows,
  };
}
