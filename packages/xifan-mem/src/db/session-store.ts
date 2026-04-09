import type Database from 'better-sqlite3';

import type { CreateMemSessionInput, MemSessionRecord, MemSessionStatus } from '../types.js';

interface SessionStoreOptions {
  readonly now?: () => number;
}

interface SessionRow {
  id: string;
  session_id: string;
  project: string;
  user_prompt: string;
  status: MemSessionStatus;
  started_at: number;
  completed_at: number | null;
  prompt_count: number;
}

function toRecord(row: SessionRow): MemSessionRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    project: row.project,
    userPrompt: row.user_prompt,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    promptCount: row.prompt_count,
  };
}

export class MemSessionStore {
  private readonly db: Database.Database;
  private readonly now: () => number;

  constructor(db: Database.Database, options: SessionStoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
  }

  create(input: CreateMemSessionInput): MemSessionRecord {
    this.db.prepare(`
      INSERT INTO mem_sessions (
        id, session_id, project, user_prompt, status,
        started_at, completed_at, prompt_count
      ) VALUES (
        @id, @sessionId, @project, @userPrompt, @status,
        @startedAt, @completedAt, @promptCount
      )
    `).run({
      id: input.id,
      sessionId: input.sessionId,
      project: input.project,
      userPrompt: input.userPrompt,
      status: input.status ?? 'active',
      startedAt: input.startedAt ?? this.now(),
      completedAt: input.completedAt ?? null,
      promptCount: input.promptCount ?? 0,
    });

    const created = this.findById(input.id);
    /* v8 ignore next 3 -- defensive guard after successful INSERT */
    if (!created) {
      throw new Error(`failed to create mem session: ${input.id}`);
    }
    return created;
  }

  findById(id: string): MemSessionRecord | undefined {
    const row = this.db
      .prepare(`
        SELECT
          id, session_id, project, user_prompt, status,
          started_at, completed_at, prompt_count
        FROM mem_sessions
        WHERE id = ?
      `)
      .get(id) as SessionRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  listByProject(project: string, limit = 50): readonly MemSessionRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          id, session_id, project, user_prompt, status,
          started_at, completed_at, prompt_count
        FROM mem_sessions
        WHERE project = @project
        ORDER BY started_at DESC
        LIMIT @limit
      `)
      .all({
        project,
        limit,
      }) as SessionRow[];
    return rows.map(toRecord);
  }

  findBySessionId(sessionId: string): MemSessionRecord | undefined {
    const row = this.db
      .prepare(`
        SELECT
          id, session_id, project, user_prompt, status,
          started_at, completed_at, prompt_count
        FROM mem_sessions
        WHERE session_id = @sessionId
        ORDER BY started_at DESC
        LIMIT 1
      `)
      .get({
        sessionId,
      }) as SessionRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  updateStatus(
    id: string,
    status: MemSessionStatus,
    completedAt = status === 'completed' ? this.now() : undefined,
  ): MemSessionRecord | undefined {
    this.db.prepare(`
      UPDATE mem_sessions
      SET
        status = @status,
        completed_at = CASE
          WHEN @completedAt IS NULL THEN completed_at
          ELSE @completedAt
        END
      WHERE id = @id
    `).run({
      id,
      status,
      completedAt: completedAt ?? null,
    });
    return this.findById(id);
  }

  incrementPromptCount(id: string, delta = 1): MemSessionRecord | undefined {
    this.db.prepare(`
      UPDATE mem_sessions
      SET prompt_count = prompt_count + @delta
      WHERE id = @id
    `).run({
      id,
      delta,
    });
    return this.findById(id);
  }
}
