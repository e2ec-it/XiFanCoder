import type Database from 'better-sqlite3';

import type {
  CreateSessionInput,
  SessionListOptions,
  SessionRecord,
  UpdateSessionInput,
} from './types.js';
import { buildParameterizedUpdateQuery } from './query-builder.js';

function mapSessionRow(row: {
  id: string;
  project_path: string;
  model: string;
  provider: string;
  status: SessionRecord['status'];
  agent_mode: SessionRecord['agentMode'];
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  context_snapshot: string | null;
  total_tokens: number;
  total_cost_usd: number;
  message_count: number;
  mem_session_id: string | null;
}): SessionRecord {
  return {
    id: row.id,
    projectPath: row.project_path,
    model: row.model,
    provider: row.provider,
    status: row.status,
    agentMode: row.agent_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    contextSnapshot: row.context_snapshot ?? undefined,
    totalTokens: row.total_tokens,
    totalCostUsd: row.total_cost_usd,
    messageCount: row.message_count,
    memSessionId: row.mem_session_id ?? undefined,
  };
}

export class SessionRepository {
  private readonly db: Database.Database;
  private readonly now: () => number;

  constructor(db: Database.Database, options: { now?: () => number } = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
  }

  create(input: CreateSessionInput): SessionRecord {
    const createdAt = input.createdAt ?? this.now();
    const updatedAt = input.updatedAt ?? createdAt;

    this.db.prepare(`
      INSERT INTO sessions (
        id, project_path, model, provider, status, agent_mode,
        created_at, updated_at, completed_at, context_snapshot,
        total_tokens, total_cost_usd, message_count, mem_session_id
      ) VALUES (
        @id, @projectPath, @model, @provider, @status, @agentMode,
        @createdAt, @updatedAt, @completedAt, @contextSnapshot,
        @totalTokens, @totalCostUsd, @messageCount, @memSessionId
      )
    `).run({
      id: input.id,
      projectPath: input.projectPath,
      model: input.model,
      provider: input.provider,
      status: input.status ?? 'active',
      agentMode: input.agentMode ?? 'build',
      createdAt,
      updatedAt,
      completedAt: input.completedAt ?? null,
      contextSnapshot: input.contextSnapshot ?? null,
      totalTokens: input.totalTokens ?? 0,
      totalCostUsd: input.totalCostUsd ?? 0,
      messageCount: input.messageCount ?? 0,
      memSessionId: input.memSessionId ?? null,
    });

    const created = this.findById(input.id);
    /* v8 ignore next 3 -- defensive guard: insert + select always succeeds in SQLite */
    if (!created) {
      throw new Error(`failed to load created session: ${input.id}`);
    }
    return created;
  }

  findById(id: string): SessionRecord | undefined {
    const row = this.db
      .prepare(`
        SELECT
          id, project_path, model, provider, status, agent_mode,
          created_at, updated_at, completed_at, context_snapshot,
          total_tokens, total_cost_usd, message_count, mem_session_id
        FROM sessions
        WHERE id = ?
      `)
      .get(id) as
      | {
        id: string;
        project_path: string;
        model: string;
        provider: string;
        status: SessionRecord['status'];
        agent_mode: SessionRecord['agentMode'];
        created_at: number;
        updated_at: number;
        completed_at: number | null;
        context_snapshot: string | null;
        total_tokens: number;
        total_cost_usd: number;
        message_count: number;
        mem_session_id: string | null;
      }
      | undefined;
    return row ? mapSessionRow(row) : undefined;
  }

  findByProject(projectPath: string, limit = 50): readonly SessionRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          id, project_path, model, provider, status, agent_mode,
          created_at, updated_at, completed_at, context_snapshot,
          total_tokens, total_cost_usd, message_count, mem_session_id
        FROM sessions
        WHERE project_path = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(projectPath, limit) as Array<{
      id: string;
      project_path: string;
      model: string;
      provider: string;
      status: SessionRecord['status'];
      agent_mode: SessionRecord['agentMode'];
      created_at: number;
      updated_at: number;
      completed_at: number | null;
      context_snapshot: string | null;
      total_tokens: number;
      total_cost_usd: number;
      message_count: number;
      mem_session_id: string | null;
    }>;
    return rows.map(mapSessionRow);
  }

  list(options: SessionListOptions = {}): readonly SessionRecord[] {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const hasStatus = options.status !== undefined;
    const query = hasStatus
      ? `
        SELECT
          id, project_path, model, provider, status, agent_mode,
          created_at, updated_at, completed_at, context_snapshot,
          total_tokens, total_cost_usd, message_count, mem_session_id
        FROM sessions
        WHERE status = @status
        ORDER BY updated_at DESC
        LIMIT @limit OFFSET @offset
      `
      : `
        SELECT
          id, project_path, model, provider, status, agent_mode,
          created_at, updated_at, completed_at, context_snapshot,
          total_tokens, total_cost_usd, message_count, mem_session_id
        FROM sessions
        ORDER BY updated_at DESC
        LIMIT @limit OFFSET @offset
      `;

    const rows = this.db
      .prepare(query)
      .all({
        status: options.status,
        limit,
        offset,
      }) as Array<{
      id: string;
      project_path: string;
      model: string;
      provider: string;
      status: SessionRecord['status'];
      agent_mode: SessionRecord['agentMode'];
      created_at: number;
      updated_at: number;
      completed_at: number | null;
      context_snapshot: string | null;
      total_tokens: number;
      total_cost_usd: number;
      message_count: number;
      mem_session_id: string | null;
    }>;
    return rows.map(mapSessionRow);
  }

  update(id: string, patch: UpdateSessionInput): SessionRecord | undefined {
    const built = buildParameterizedUpdateQuery({
      table: 'sessions',
      idColumn: 'id',
      idValue: id,
      fields: {
        model: patch.model === undefined ? undefined : { column: 'model', value: patch.model },
        provider: patch.provider === undefined ? undefined : { column: 'provider', value: patch.provider },
        status: patch.status === undefined ? undefined : { column: 'status', value: patch.status },
        agentMode: patch.agentMode === undefined ? undefined : { column: 'agent_mode', value: patch.agentMode },
        completedAt: patch.completedAt === undefined ? undefined : { column: 'completed_at', value: patch.completedAt },
        contextSnapshot:
          patch.contextSnapshot === undefined ? undefined : { column: 'context_snapshot', value: patch.contextSnapshot },
        totalTokens:
          patch.totalTokens === undefined ? undefined : { column: 'total_tokens', value: patch.totalTokens },
        totalCostUsd:
          patch.totalCostUsd === undefined ? undefined : { column: 'total_cost_usd', value: patch.totalCostUsd },
        messageCount:
          patch.messageCount === undefined ? undefined : { column: 'message_count', value: patch.messageCount },
        memSessionId:
          patch.memSessionId === undefined ? undefined : { column: 'mem_session_id', value: patch.memSessionId },
        updatedAt: { column: 'updated_at', value: patch.updatedAt ?? this.now() },
      },
    });
    /* v8 ignore next 3 -- updatedAt is always set, so built is never null */
    if (!built) {
      return this.findById(id);
    }
    this.db.prepare(built.sql).run(built.params);

    return this.findById(id);
  }
}
