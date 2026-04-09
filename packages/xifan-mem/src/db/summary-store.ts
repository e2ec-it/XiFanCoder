import type Database from 'better-sqlite3';

import type { CreateSessionSummaryInput, SessionSummaryRecord } from '../types.js';
import { parseStringArray, stringifyStringArray } from './serde.js';

interface SummaryStoreOptions {
  readonly now?: () => number;
}

interface SummaryRow {
  id: string;
  mem_session_id: string;
  request: string;
  investigated: string;
  learned: string;
  completed: string;
  next_steps: string;
  notes: string | null;
  files_read: string;
  files_edited: string;
  project: string;
  created_at: number;
}

function toSummaryRecord(row: SummaryRow): SessionSummaryRecord {
  return {
    id: row.id,
    memSessionId: row.mem_session_id,
    request: row.request,
    investigated: row.investigated,
    learned: row.learned,
    completed: row.completed,
    nextSteps: row.next_steps,
    notes: row.notes ?? undefined,
    filesRead: parseStringArray(row.files_read),
    filesEdited: parseStringArray(row.files_edited),
    project: row.project,
    createdAt: row.created_at,
  };
}

export class SessionSummaryStore {
  private readonly db: Database.Database;
  private readonly now: () => number;

  constructor(db: Database.Database, options: SummaryStoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
  }

  create(input: CreateSessionSummaryInput): SessionSummaryRecord {
    this.db.prepare(`
      INSERT INTO session_summaries (
        id, mem_session_id, request, investigated, learned,
        completed, next_steps, notes, files_read, files_edited,
        project, created_at
      ) VALUES (
        @id, @memSessionId, @request, @investigated, @learned,
        @completed, @nextSteps, @notes, @filesRead, @filesEdited,
        @project, @createdAt
      )
    `).run({
      id: input.id,
      memSessionId: input.memSessionId,
      request: input.request,
      investigated: input.investigated,
      learned: input.learned,
      completed: input.completed,
      nextSteps: input.nextSteps,
      notes: input.notes ?? null,
      filesRead: stringifyStringArray(input.filesRead),
      filesEdited: stringifyStringArray(input.filesEdited),
      project: input.project,
      createdAt: input.createdAt ?? this.now(),
    });

    const created = this.findById(input.id);
    /* v8 ignore next 3 -- defensive guard after successful INSERT */
    if (!created) {
      throw new Error(`failed to create session summary: ${input.id}`);
    }
    return created;
  }

  findById(id: string): SessionSummaryRecord | undefined {
    const row = this.db
      .prepare(`
        SELECT
          id, mem_session_id, request, investigated, learned,
          completed, next_steps, notes, files_read, files_edited,
          project, created_at
        FROM session_summaries
        WHERE id = ?
      `)
      .get(id) as SummaryRow | undefined;
    return row ? toSummaryRecord(row) : undefined;
  }

  listBySession(memSessionId: string, limit = 50): readonly SessionSummaryRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          id, mem_session_id, request, investigated, learned,
          completed, next_steps, notes, files_read, files_edited,
          project, created_at
        FROM session_summaries
        WHERE mem_session_id = @memSessionId
        ORDER BY created_at DESC
        LIMIT @limit
      `)
      .all({
        memSessionId,
        limit,
      }) as SummaryRow[];
    return rows.map(toSummaryRecord);
  }

  findBySession(memSessionId: string, limit = 50): readonly SessionSummaryRecord[] {
    return this.listBySession(memSessionId, limit);
  }

  findLatestByProject(project: string): SessionSummaryRecord | undefined {
    const row = this.db
      .prepare(`
        SELECT
          id, mem_session_id, request, investigated, learned,
          completed, next_steps, notes, files_read, files_edited,
          project, created_at
        FROM session_summaries
        WHERE project = @project
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get({
        project,
      }) as SummaryRow | undefined;
    return row ? toSummaryRecord(row) : undefined;
  }
}
