import type Database from 'better-sqlite3';

import type {
  InsertTokenUsageInput,
  TokenUsageAggregate,
  TokenUsageRecord,
} from './types.js';

function mapTokenUsageRow(row: {
  id: string;
  session_id: string;
  model: string;
  provider: string;
  role: TokenUsageRecord['role'];
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  tool_call_count: number;
  created_at: number;
}): TokenUsageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    model: row.model,
    provider: row.provider,
    role: row.role,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    costUsd: row.cost_usd,
    toolCallCount: row.tool_call_count,
    createdAt: row.created_at,
  };
}

function mapAggregateRow(row: {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number | null;
  tool_call_count: number | null;
}): TokenUsageAggregate {
  return {
    promptTokens: row.prompt_tokens ?? 0,
    completionTokens: row.completion_tokens ?? 0,
    totalTokens: row.total_tokens ?? 0,
    cacheReadTokens: row.cache_read_tokens ?? 0,
    cacheWriteTokens: row.cache_write_tokens ?? 0,
    costUsd: row.cost_usd ?? 0,
    toolCallCount: row.tool_call_count ?? 0,
  };
}

function dayRangeUtc(day: string): { start: number; end: number } {
  const start = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(start)) {
    throw new Error(`invalid day format: ${day}`);
  }
  return {
    start,
    end: start + 24 * 60 * 60 * 1000,
  };
}

export class TokenUsageRepository {
  private readonly db: Database.Database;
  private readonly now: () => number;

  constructor(db: Database.Database, options: { now?: () => number } = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
  }

  insert(input: InsertTokenUsageInput): TokenUsageRecord {
    const createdAt = input.createdAt ?? this.now();
    this.db.prepare(`
      INSERT INTO token_usage (
        id, session_id, model, provider, role,
        prompt_tokens, completion_tokens, total_tokens,
        cache_read_tokens, cache_write_tokens, cost_usd, tool_call_count, created_at
      ) VALUES (
        @id, @sessionId, @model, @provider, @role,
        @promptTokens, @completionTokens, @totalTokens,
        @cacheReadTokens, @cacheWriteTokens, @costUsd, @toolCallCount, @createdAt
      )
    `).run({
      id: input.id,
      sessionId: input.sessionId,
      model: input.model,
      provider: input.provider,
      role: input.role,
      promptTokens: input.promptTokens ?? 0,
      completionTokens: input.completionTokens ?? 0,
      totalTokens: input.totalTokens ?? 0,
      cacheReadTokens: input.cacheReadTokens ?? 0,
      cacheWriteTokens: input.cacheWriteTokens ?? 0,
      costUsd: input.costUsd ?? 0,
      toolCallCount: input.toolCallCount ?? 0,
      createdAt,
    });

    const created = this.findById(input.id);
    if (!created) {
      throw new Error(`failed to load inserted token usage: ${input.id}`);
    }
    return created;
  }

  sumBySession(sessionId: string): TokenUsageAggregate {
    const row = this.db.prepare(`
      SELECT
        SUM(prompt_tokens) AS prompt_tokens,
        SUM(completion_tokens) AS completion_tokens,
        SUM(total_tokens) AS total_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens,
        SUM(cache_write_tokens) AS cache_write_tokens,
        SUM(cost_usd) AS cost_usd,
        SUM(tool_call_count) AS tool_call_count
      FROM token_usage
      WHERE session_id = ?
    `).get(sessionId) as {
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
      cache_read_tokens: number | null;
      cache_write_tokens: number | null;
      cost_usd: number | null;
      tool_call_count: number | null;
    };

    return mapAggregateRow(row);
  }

  sumByDay(day: string): TokenUsageAggregate {
    const range = dayRangeUtc(day);
    const row = this.db.prepare(`
      SELECT
        SUM(prompt_tokens) AS prompt_tokens,
        SUM(completion_tokens) AS completion_tokens,
        SUM(total_tokens) AS total_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens,
        SUM(cache_write_tokens) AS cache_write_tokens,
        SUM(cost_usd) AS cost_usd,
        SUM(tool_call_count) AS tool_call_count
      FROM token_usage
      WHERE created_at >= @start
        AND created_at < @end
    `).get({
      start: range.start,
      end: range.end,
    }) as {
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
      cache_read_tokens: number | null;
      cache_write_tokens: number | null;
      cost_usd: number | null;
      tool_call_count: number | null;
    };

    return mapAggregateRow(row);
  }

  sumByModel(model: string): TokenUsageAggregate {
    const row = this.db.prepare(`
      SELECT
        SUM(prompt_tokens) AS prompt_tokens,
        SUM(completion_tokens) AS completion_tokens,
        SUM(total_tokens) AS total_tokens,
        SUM(cache_read_tokens) AS cache_read_tokens,
        SUM(cache_write_tokens) AS cache_write_tokens,
        SUM(cost_usd) AS cost_usd,
        SUM(tool_call_count) AS tool_call_count
      FROM token_usage
      WHERE model = ?
    `).get(model) as {
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
      cache_read_tokens: number | null;
      cache_write_tokens: number | null;
      cost_usd: number | null;
      tool_call_count: number | null;
    };

    return mapAggregateRow(row);
  }

  findById(id: string): TokenUsageRecord | undefined {
    const row = this.db.prepare(`
      SELECT
        id, session_id, model, provider, role,
        prompt_tokens, completion_tokens, total_tokens,
        cache_read_tokens, cache_write_tokens, cost_usd, tool_call_count, created_at
      FROM token_usage
      WHERE id = ?
    `).get(id) as
      | {
        id: string;
        session_id: string;
        model: string;
        provider: string;
        role: TokenUsageRecord['role'];
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        cache_read_tokens: number;
        cache_write_tokens: number;
        cost_usd: number;
        tool_call_count: number;
        created_at: number;
      }
      | undefined;

    return row ? mapTokenUsageRow(row) : undefined;
  }
}
