import type Database from 'better-sqlite3';

import type {
  EnqueueQueueItemInput,
  QueueItemRecord,
  QueueItemStatus,
} from '../types.js';

interface QueueStoreOptions {
  readonly now?: () => number;
}

interface QueueRow {
  id: string;
  type: 'observation' | 'summarize';
  payload: string;
  status: QueueItemStatus;
  retry_count: number;
  claimed_at: number | null;
  created_at: number;
}

function toQueueRecord(row: QueueRow): QueueItemRecord {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    retryCount: row.retry_count,
    claimedAt: row.claimed_at ?? undefined,
    createdAt: row.created_at,
  };
}

export class QueueStore {
  private readonly db: Database.Database;
  private readonly now: () => number;

  constructor(db: Database.Database, options: QueueStoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
  }

  enqueue(input: EnqueueQueueItemInput): QueueItemRecord {
    this.db.prepare(`
      INSERT INTO pending_queue (
        id, type, payload, status, retry_count, claimed_at, created_at
      ) VALUES (
        @id, @type, @payload, @status, @retryCount, @claimedAt, @createdAt
      )
    `).run({
      id: input.id,
      type: input.type,
      payload: input.payload,
      status: input.status ?? 'pending',
      retryCount: input.retryCount ?? 0,
      claimedAt: input.claimedAt ?? null,
      createdAt: input.createdAt ?? this.now(),
    });

    const created = this.findById(input.id);
    /* v8 ignore next 3 -- defensive guard after successful INSERT */
    if (!created) {
      throw new Error(`failed to enqueue queue item: ${input.id}`);
    }
    return created;
  }

  findById(id: string): QueueItemRecord | undefined {
    const row = this.db
      .prepare(`
        SELECT
          id, type, payload, status, retry_count, claimed_at, created_at
        FROM pending_queue
        WHERE id = ?
      `)
      .get(id) as QueueRow | undefined;
    return row ? toQueueRecord(row) : undefined;
  }

  claimNext(): QueueItemRecord | undefined {
    const claim = this.db.transaction(() => {
      const pending = this.db
        .prepare(`
          SELECT
            id, type, payload, status, retry_count, claimed_at, created_at
          FROM pending_queue
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT 1
        `)
        .get() as QueueRow | undefined;
      if (!pending) {
        return undefined;
      }

      this.db.prepare(`
        UPDATE pending_queue
        SET status = 'processing', claimed_at = @claimedAt
        WHERE id = @id
      `).run({
        id: pending.id,
        claimedAt: this.now(),
      });

      const updated = this.findById(pending.id);
      /* v8 ignore next 3 -- defensive guard after successful UPDATE */
      if (!updated) {
        throw new Error(`failed to claim queue item: ${pending.id}`);
      }
      return updated;
    });

    return claim();
  }

  claim(): QueueItemRecord | undefined {
    return this.claimNext();
  }

  markDone(id: string): QueueItemRecord | undefined {
    this.db.prepare(`
      UPDATE pending_queue
      SET status = 'done'
      WHERE id = @id
    `).run({ id });
    return this.findById(id);
  }

  done(id: string): QueueItemRecord | undefined {
    return this.markDone(id);
  }

  markFailed(id: string): QueueItemRecord | undefined {
    this.db.prepare(`
      UPDATE pending_queue
      SET status = 'failed', retry_count = retry_count + 1
      WHERE id = @id
    `).run({ id });
    return this.findById(id);
  }

  fail(id: string): QueueItemRecord | undefined {
    return this.markFailed(id);
  }

  resetStale(maxProcessingAgeMs = 5 * 60 * 1000): number {
    return this.resetStaleProcessing(this.now() - maxProcessingAgeMs);
  }

  resetStaleProcessing(claimedBeforeEpochMs: number): number {
    const result = this.db.prepare(`
      UPDATE pending_queue
      SET status = 'pending', claimed_at = NULL
      WHERE status = 'processing'
        AND claimed_at IS NOT NULL
        AND claimed_at < @claimedBeforeEpochMs
    `).run({ claimedBeforeEpochMs });
    return result.changes;
  }

  updatePayload(id: string, payload: string): QueueItemRecord | undefined {
    this.db.prepare(`
      UPDATE pending_queue
      SET payload = @payload
      WHERE id = @id
    `).run({
      id,
      payload,
    });
    return this.findById(id);
  }

  listByStatus(status: QueueItemStatus, limit = 100): readonly QueueItemRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          id, type, payload, status, retry_count, claimed_at, created_at
        FROM pending_queue
        WHERE status = @status
        ORDER BY created_at ASC
        LIMIT @limit
      `)
      .all({
        status,
        limit,
      }) as QueueRow[];
    return rows.map(toQueueRecord);
  }
}
