// packages/xifan-agents/src/observer/session.ts
import { v4 as uuidv4 } from 'uuid';
import type { Pool } from 'pg';

export interface StartSessionInput {
  readonly project: string;
  readonly userInput: string;
  readonly model?: string;
}

export async function startSession(pool: Pool, input: StartSessionInput): Promise<string> {
  const id = uuidv4();
  await pool.query(
    `INSERT INTO xifan_obs.sessions (id, project, user_input, model, started_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, input.project, input.userInput, input.model ?? null, Date.now()]
  );
  return id;
}

export interface EndSessionInput {
  readonly sessionId: string;
  readonly status: 'completed' | 'max_rounds' | 'error';
  readonly rounds: number;
  readonly toolCount: number;
}

export async function endSession(pool: Pool, input: EndSessionInput): Promise<void> {
  await pool.query(
    `UPDATE xifan_obs.sessions
     SET status = $1, rounds = $2, tool_count = $3, completed_at = $4
     WHERE id = $5`,
    [input.status, input.rounds, input.toolCount, Date.now(), input.sessionId]
  );
}
