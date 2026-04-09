import type Database from 'better-sqlite3';

import type {
  AppendMessageInput,
  MessageRecord,
  MessageSearchResult,
  SearchMessagesOptions,
  StreamingAppendMessageInput,
} from './types.js';
import {
  decryptJsonPayload,
  encryptJsonPayload,
  isEncryptedPayload,
} from './security.js';

function toStreamingText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  return String(content ?? '');
}

function mapMessageRow(
  row: {
  id: string;
  session_id: string;
  role: MessageRecord['role'];
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  token_count: number | null;
  created_at: number;
},
  parseContent: (raw: string) => unknown,
): MessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: parseContent(row.content),
    toolCalls: row.tool_calls ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    toolName: row.tool_name ?? undefined,
    tokenCount: row.token_count ?? undefined,
    createdAt: row.created_at,
  };
}

export class MessageRepository {
  private readonly db: Database.Database;
  private readonly now: () => number;
  private readonly encryptionKey?: string;

  constructor(
    db: Database.Database,
    options: { now?: () => number; encryptionKey?: string } = {},
  ) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
    this.encryptionKey = options.encryptionKey;
  }

  append(input: AppendMessageInput): MessageRecord {
    const createdAt = input.createdAt ?? this.now();
    this.db.prepare(`
      INSERT INTO messages (
        id, session_id, role, content, tool_calls, tool_call_id, tool_name, token_count, created_at
      ) VALUES (
        @id, @sessionId, @role, @content, @toolCalls, @toolCallId, @toolName, @tokenCount, @createdAt
      )
    `).run({
      id: input.id,
      sessionId: input.sessionId,
      role: input.role,
      content: this.serializeMessageContent(input.content),
      toolCalls: input.toolCalls ?? null,
      toolCallId: input.toolCallId ?? null,
      toolName: input.toolName ?? null,
      tokenCount: input.tokenCount ?? null,
      createdAt,
    });

    const created = this.findById(input.id);
    /* v8 ignore next 3 -- defensive guard: insert + select always succeeds in SQLite */
    if (!created) {
      throw new Error(`failed to load created message: ${input.id}`);
    }
    return created;
  }

  streamingAppend(input: StreamingAppendMessageInput): MessageRecord {
    const existing = this.findById(input.id);
    if (!existing) {
      return this.append({
        id: input.id,
        sessionId: input.sessionId,
        role: input.role,
        content: input.chunk,
        createdAt: input.createdAt,
      });
    }

    const nextContent = toStreamingText(existing.content) + input.chunk;
    this.db.prepare(`
      UPDATE messages
      SET content = @content
      WHERE id = @id
    `).run({
      id: input.id,
      content: this.serializeMessageContent(nextContent),
    });

    const updated = this.findById(input.id);
    /* v8 ignore next 3 -- defensive guard: update + select always succeeds in SQLite */
    if (!updated) {
      throw new Error(`failed to load streamed message: ${input.id}`);
    }
    return updated;
  }

  findById(id: string): MessageRecord | undefined {
    const row = this.db
      .prepare(`
        SELECT
          id, session_id, role, content, tool_calls, tool_call_id, tool_name, token_count, created_at
        FROM messages
        WHERE id = ?
      `)
      .get(id) as
      | {
        id: string;
        session_id: string;
        role: MessageRecord['role'];
        content: string;
        tool_calls: string | null;
        tool_call_id: string | null;
        tool_name: string | null;
        token_count: number | null;
        created_at: number;
      }
      | undefined;

    return row ? mapMessageRow(row, (value) => this.parseMessageContent(value)) : undefined;
  }

  findBySession(sessionId: string): readonly MessageRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          id, session_id, role, content, tool_calls, tool_call_id, tool_name, token_count, created_at
        FROM messages
        WHERE session_id = ?
        ORDER BY created_at ASC
      `)
      .all(sessionId) as Array<{
      id: string;
      session_id: string;
      role: MessageRecord['role'];
      content: string;
      tool_calls: string | null;
      tool_call_id: string | null;
      tool_name: string | null;
      token_count: number | null;
      created_at: number;
    }>;
    return rows.map((row) => mapMessageRow(row, (value) => this.parseMessageContent(value)));
  }

  searchByContent(query: string, options: SearchMessagesOptions = {}): readonly MessageSearchResult[] {
    const limit = options.limit ?? 20;

    const rows = options.sessionId
      ? (this.db.prepare(`
          SELECT
            m.id, m.session_id, m.role, m.content, m.tool_calls, m.tool_call_id, m.tool_name, m.token_count, m.created_at,
            bm25(messages_fts) AS rank
          FROM messages_fts
          JOIN messages m ON m.rowid = messages_fts.rowid
          WHERE messages_fts MATCH @query
            AND m.session_id = @sessionId
          ORDER BY rank
          LIMIT @limit
        `).all({
          query,
          sessionId: options.sessionId,
          limit,
        }) as Array<{
          id: string;
          session_id: string;
          role: MessageRecord['role'];
          content: string;
          tool_calls: string | null;
          tool_call_id: string | null;
          tool_name: string | null;
          token_count: number | null;
          created_at: number;
          rank: number;
        }>)
      : (this.db.prepare(`
          SELECT
            m.id, m.session_id, m.role, m.content, m.tool_calls, m.tool_call_id, m.tool_name, m.token_count, m.created_at,
            bm25(messages_fts) AS rank
          FROM messages_fts
          JOIN messages m ON m.rowid = messages_fts.rowid
          WHERE messages_fts MATCH @query
          ORDER BY rank
          LIMIT @limit
        `).all({
          query,
          limit,
        }) as Array<{
          id: string;
          session_id: string;
          role: MessageRecord['role'];
          content: string;
          tool_calls: string | null;
          tool_call_id: string | null;
          tool_name: string | null;
          token_count: number | null;
          created_at: number;
          rank: number;
        }>);

    return rows.map((row) => ({
      message: mapMessageRow(row, (value) => this.parseMessageContent(value)),
      rank: row.rank,
    }));
  }

  private serializeMessageContent(content: unknown): string {
    const raw = JSON.stringify(content);
    if (!this.encryptionKey) {
      return raw;
    }
    return encryptJsonPayload(raw, this.encryptionKey);
  }

  private parseMessageContent(raw: string): unknown {
    const resolved =
      this.encryptionKey && isEncryptedPayload(raw)
        ? decryptJsonPayload(raw, this.encryptionKey)
        : raw;
    try {
      return JSON.parse(resolved);
    } catch {
      return resolved;
    }
  }
}
