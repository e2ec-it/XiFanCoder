import type Database from 'better-sqlite3';

import type { AppendUserPromptInput, UserPromptRecord } from '../types.js';

interface PromptStoreOptions {
  readonly now?: () => number;
}

interface PromptRow {
  id: string;
  mem_session_id: string;
  content: string;
  project: string;
  prompt_number: number;
  created_at: number;
}

function toPromptRecord(row: PromptRow): UserPromptRecord {
  return {
    id: row.id,
    memSessionId: row.mem_session_id,
    content: row.content,
    project: row.project,
    promptNumber: row.prompt_number,
    createdAt: row.created_at,
  };
}

export class UserPromptStore {
  private readonly db: Database.Database;
  private readonly now: () => number;

  constructor(db: Database.Database, options: PromptStoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
  }

  append(input: AppendUserPromptInput): UserPromptRecord {
    this.db.prepare(`
      INSERT INTO user_prompts (
        id, mem_session_id, content, project, prompt_number, created_at
      ) VALUES (
        @id, @memSessionId, @content, @project, @promptNumber, @createdAt
      )
    `).run({
      id: input.id,
      memSessionId: input.memSessionId,
      content: input.content,
      project: input.project,
      promptNumber: input.promptNumber,
      createdAt: input.createdAt ?? this.now(),
    });

    const created = this.findById(input.id);
    /* v8 ignore next 3 -- defensive guard after successful INSERT */
    if (!created) {
      throw new Error(`failed to append prompt: ${input.id}`);
    }
    return created;
  }

  findById(id: string): UserPromptRecord | undefined {
    const row = this.db
      .prepare(`
        SELECT
          id, mem_session_id, content, project, prompt_number, created_at
        FROM user_prompts
        WHERE id = ?
      `)
      .get(id) as PromptRow | undefined;
    return row ? toPromptRecord(row) : undefined;
  }

  listBySession(memSessionId: string, limit = 100): readonly UserPromptRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          id, mem_session_id, content, project, prompt_number, created_at
        FROM user_prompts
        WHERE mem_session_id = @memSessionId
        ORDER BY created_at ASC
        LIMIT @limit
      `)
      .all({
        memSessionId,
        limit,
      }) as PromptRow[];
    return rows.map(toPromptRecord);
  }

  searchByText(query: string, project?: string, limit = 20): readonly UserPromptRecord[] {
    if (project) {
      const rows = this.db
        .prepare(`
          SELECT
            p.id, p.mem_session_id, p.content, p.project, p.prompt_number, p.created_at
          FROM user_prompts_fts f
          INNER JOIN user_prompts p
            ON p.rowid = f.rowid
          WHERE user_prompts_fts MATCH @query
            AND p.project = @project
          ORDER BY bm25(user_prompts_fts), p.created_at DESC
          LIMIT @limit
        `)
        .all({
          query,
          project,
          limit,
        }) as PromptRow[];
      return rows.map(toPromptRecord);
    }

    const rows = this.db
      .prepare(`
        SELECT
          p.id, p.mem_session_id, p.content, p.project, p.prompt_number, p.created_at
        FROM user_prompts_fts f
        INNER JOIN user_prompts p
          ON p.rowid = f.rowid
        WHERE user_prompts_fts MATCH @query
        ORDER BY bm25(user_prompts_fts), p.created_at DESC
        LIMIT @limit
      `)
      .all({
        query,
        limit,
      }) as PromptRow[];
    return rows.map(toPromptRecord);
  }
}
