import type Database from 'better-sqlite3';

import type { CreateObservationInput, ObservationRecord, ObservationType } from '../types.js';
import { parseStringArray, stringifyStringArray } from './serde.js';

interface ObservationStoreOptions {
  readonly now?: () => number;
}

interface ObservationRow {
  id: string;
  mem_session_id: string;
  type: ObservationType;
  title: string;
  subtitle: string | null;
  narrative: string;
  facts: string;
  concepts: string;
  files_read: string;
  files_modified: string;
  project: string;
  prompt_number: number;
  created_at: number;
}

export interface ObservationSearchOptions {
  readonly project?: string;
  readonly limit?: number;
}

function toObservationRecord(row: ObservationRow): ObservationRecord {
  return {
    id: row.id,
    memSessionId: row.mem_session_id,
    type: row.type,
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    narrative: row.narrative,
    facts: parseStringArray(row.facts),
    concepts: parseStringArray(row.concepts),
    filesRead: parseStringArray(row.files_read),
    filesModified: parseStringArray(row.files_modified),
    project: row.project,
    promptNumber: row.prompt_number,
    createdAt: row.created_at,
  };
}

export class ObservationStore {
  private readonly db: Database.Database;
  private readonly now: () => number;

  constructor(db: Database.Database, options: ObservationStoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
  }

  create(input: CreateObservationInput): ObservationRecord {
    this.db.prepare(`
      INSERT INTO observations (
        id, mem_session_id, type, title, subtitle,
        narrative, facts, concepts, files_read, files_modified,
        project, prompt_number, created_at
      ) VALUES (
        @id, @memSessionId, @type, @title, @subtitle,
        @narrative, @facts, @concepts, @filesRead, @filesModified,
        @project, @promptNumber, @createdAt
      )
    `).run({
      id: input.id,
      memSessionId: input.memSessionId,
      type: input.type,
      title: input.title,
      subtitle: input.subtitle ?? null,
      narrative: input.narrative,
      facts: stringifyStringArray(input.facts),
      concepts: stringifyStringArray(input.concepts),
      filesRead: stringifyStringArray(input.filesRead),
      filesModified: stringifyStringArray(input.filesModified),
      project: input.project,
      promptNumber: input.promptNumber,
      createdAt: input.createdAt ?? this.now(),
    });

    const created = this.findById(input.id);
    /* v8 ignore next 3 -- defensive guard after successful INSERT */
    if (!created) {
      throw new Error(`failed to create observation: ${input.id}`);
    }
    return created;
  }

  findById(id: string): ObservationRecord | undefined {
    const row = this.db
      .prepare(`
        SELECT
          id, mem_session_id, type, title, subtitle, narrative,
          facts, concepts, files_read, files_modified,
          project, prompt_number, created_at
        FROM observations
        WHERE id = ?
      `)
      .get(id) as ObservationRow | undefined;
    return row ? toObservationRecord(row) : undefined;
  }

  listBySession(memSessionId: string, limit = 100): readonly ObservationRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          id, mem_session_id, type, title, subtitle, narrative,
          facts, concepts, files_read, files_modified,
          project, prompt_number, created_at
        FROM observations
        WHERE mem_session_id = @memSessionId
        ORDER BY created_at ASC
        LIMIT @limit
      `)
      .all({
        memSessionId,
        limit,
      }) as ObservationRow[];
    return rows.map(toObservationRecord);
  }

  findByProject(project: string, limit = 100): readonly ObservationRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          id, mem_session_id, type, title, subtitle, narrative,
          facts, concepts, files_read, files_modified,
          project, prompt_number, created_at
        FROM observations
        WHERE project = @project
        ORDER BY created_at DESC
        LIMIT @limit
      `)
      .all({
        project,
        limit,
      }) as ObservationRow[];
    return rows.map(toObservationRecord);
  }

  findByFile(filePath: string, limit = 100): readonly ObservationRecord[] {
    const encodedNeedle = `%${JSON.stringify(filePath).slice(1, -1)}%`;
    const rows = this.db
      .prepare(`
        SELECT
          id, mem_session_id, type, title, subtitle, narrative,
          facts, concepts, files_read, files_modified,
          project, prompt_number, created_at
        FROM observations
        WHERE files_read LIKE @needle OR files_modified LIKE @needle
        ORDER BY created_at DESC
        LIMIT @limit
      `)
      .all({
        needle: encodedNeedle,
        limit,
      }) as ObservationRow[];
    return rows.map(toObservationRecord);
  }

  search(query: string, options: ObservationSearchOptions = {}): readonly ObservationRecord[] {
    return this.searchByText(query, options);
  }

  searchByText(query: string, options: ObservationSearchOptions = {}): readonly ObservationRecord[] {
    const limit = options.limit ?? 20;
    if (options.project) {
      const rows = this.db
        .prepare(`
          SELECT
            o.id, o.mem_session_id, o.type, o.title, o.subtitle, o.narrative,
            o.facts, o.concepts, o.files_read, o.files_modified,
            o.project, o.prompt_number, o.created_at
          FROM observations_fts f
          INNER JOIN observations o
            ON o.rowid = f.rowid
          WHERE observations_fts MATCH @query
            AND o.project = @project
          ORDER BY bm25(observations_fts), o.created_at DESC
          LIMIT @limit
        `)
        .all({
          query,
          project: options.project,
          limit,
        }) as ObservationRow[];
      return rows.map(toObservationRecord);
    }

    const rows = this.db
      .prepare(`
        SELECT
          o.id, o.mem_session_id, o.type, o.title, o.subtitle, o.narrative,
          o.facts, o.concepts, o.files_read, o.files_modified,
          o.project, o.prompt_number, o.created_at
        FROM observations_fts f
        INNER JOIN observations o
          ON o.rowid = f.rowid
        WHERE observations_fts MATCH @query
        ORDER BY bm25(observations_fts), o.created_at DESC
        LIMIT @limit
      `)
      .all({
        query,
        limit,
      }) as ObservationRow[];
    return rows.map(toObservationRecord);
  }
}
