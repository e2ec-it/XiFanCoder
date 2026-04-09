import { randomUUID } from 'node:crypto';

import { MemoryDatabaseManager } from '../db/database.js';
import { ObservationStore } from '../db/observation-store.js';
import { QueueStore } from '../db/queue-store.js';
import { MemSessionStore } from '../db/session-store.js';
import { SessionSummaryStore } from '../db/summary-store.js';
import { UserPromptStore } from '../db/prompt-store.js';
import { QueueProcessor } from '../queue/queue-processor.js';
import type {
  ObservationRecord,
  ObservationType,
  QueueItemRecord,
  QueueItemStatus,
  SearchFilters,
  SearchResult,
  UserPromptRecord,
} from '../types.js';
import type { QueueLLMDriver } from '../llm/observation-generator.js';

export interface MemoryManagerOptions {
  readonly dbPath?: string;
  readonly defaultProject?: string;
  readonly injectMaxTokens?: number;
  readonly now?: () => number;
  readonly idGenerator?: () => string;
  readonly llmDriver?: QueueLLMDriver;
  readonly allowExternalDbPath?: boolean;
}

export interface ObserveOptions {
  readonly sessionId: string;
  readonly project?: string;
  readonly promptNumber?: number;
}

export interface SummarizeOptions {
  readonly sessionId: string;
  readonly project?: string;
}

export interface SaveOptions {
  readonly project?: string;
  readonly type?: ObservationType;
  readonly filesRead?: readonly string[];
  readonly filesModified?: readonly string[];
  readonly memSessionId?: string;
  readonly promptNumber?: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export class MemoryManager {
  private readonly dbManager: MemoryDatabaseManager;
  private readonly sessions: MemSessionStore;
  private readonly observations: ObservationStore;
  private readonly summaries: SessionSummaryStore;
  private readonly prompts: UserPromptStore;
  private readonly queue: QueueStore;
  private readonly queueProcessor?: QueueProcessor;
  private readonly defaultProject: string;
  private readonly injectMaxTokens: number;
  private readonly now: () => number;
  private readonly idGenerator: () => string;

  constructor(options: MemoryManagerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
    this.defaultProject = options.defaultProject ?? process.cwd();
    this.injectMaxTokens = options.injectMaxTokens ?? 1_200;

    this.dbManager = new MemoryDatabaseManager({
      dbPath: options.dbPath,
      now: this.now,
      allowExternalDbPath: options.allowExternalDbPath,
    });
    this.dbManager.migrate();
    const db = this.dbManager.getConnection();

    this.sessions = new MemSessionStore(db, { now: this.now });
    this.observations = new ObservationStore(db, { now: this.now });
    this.summaries = new SessionSummaryStore(db, { now: this.now });
    this.prompts = new UserPromptStore(db, { now: this.now });
    this.queue = new QueueStore(db, { now: this.now });

    if (options.llmDriver) {
      this.queueProcessor = new QueueProcessor(
        options.llmDriver,
        this.queue,
        this.observations,
        this.summaries,
        { now: this.now },
      );
    }
  }

  close(): void {
    this.queueProcessor?.stop();
    this.dbManager.close();
  }

  startQueueProcessor(): void {
    if (!this.queueProcessor) {
      return;
    }
    void this.queueProcessor.start();
  }

  async processQueueOnce(): Promise<boolean> {
    if (!this.queueProcessor) {
      return false;
    }
    return await this.queueProcessor.processOnce();
  }

  recall(query: string, project = this.defaultProject, limit = 6): string {
    const results = this.search(query, { project, limit });
    if (results.length === 0) {
      return '';
    }

    const observations = this.getObservations(results.map((item) => item.id));
    /* v8 ignore next 3 -- defensive: search results should always resolve to observations */
    if (observations.length === 0) {
      return '';
    }

    const opening = `<xifan-memory project="${project}">`;
    const closing = '</xifan-memory>';
    const lines: string[] = [opening];

    for (const item of observations) {
      const facts = item.facts.length > 0 ? item.facts.join('; ') : item.narrative;
      const block = [
        `[${isoDate(item.createdAt)} ${item.type}] ${item.title}`,
        `facts: ${facts}`,
      ].join('\n');
      const candidate = [...lines, block, closing].join('\n');
      if (estimateTokens(candidate) > this.injectMaxTokens) {
        break;
      }
      lines.push(block);
    }

    if (lines.length === 1) {
      return '';
    }
    lines.push(closing);
    return lines.join('\n');
  }

  logPrompt(content: string, sessionId: string, project = this.defaultProject): UserPromptRecord {
    const session = this.ensureSession(sessionId, project, content);
    const promptNumber = session.promptCount + 1;
    const prompt = this.prompts.append({
      id: this.idGenerator(),
      memSessionId: session.id,
      content,
      project,
      promptNumber,
    });
    this.sessions.incrementPromptCount(session.id);
    return prompt;
  }

  observe(toolName: string, result: string, options: ObserveOptions): QueueItemRecord {
    const project = options.project ?? this.defaultProject;
    const session = this.ensureSession(options.sessionId, project, `${toolName}: ${result}`);
    const promptNumber = options.promptNumber ?? Math.max(1, session.promptCount);
    return this.queue.enqueue({
      id: this.idGenerator(),
      type: 'observation',
      payload: JSON.stringify({
        kind: 'observation',
        memSessionId: session.id,
        project,
        promptNumber,
        sourceText: `tool=${toolName}\nresult=${result}`,
      }),
    });
  }

  summarize(sessionCtx: string, options: SummarizeOptions): QueueItemRecord {
    const project = options.project ?? this.defaultProject;
    const session = this.ensureSession(options.sessionId, project, sessionCtx);
    return this.queue.enqueue({
      id: this.idGenerator(),
      type: 'summarize',
      payload: JSON.stringify({
        kind: 'summarize',
        memSessionId: session.id,
        project,
        sourceText: sessionCtx,
      }),
    });
  }

  search(query: string, filters: SearchFilters = {}): readonly SearchResult[] {
    const limit = filters.limit ?? 20;
    let candidates: readonly ObservationRecord[];
    if (query.trim()) {
      candidates = this.observations.search(query, {
        project: filters.project,
        limit: limit * 4,
      });
    } else if (filters.filePath) {
      candidates = this.observations.findByFile(filters.filePath, limit * 4);
    } else if (filters.project) {
      candidates = this.observations.findByProject(filters.project, limit * 4);
    } else {
      candidates = [];
    }

    const filtered = candidates.filter((item) => {
      if (filters.project && item.project !== filters.project) {
        return false;
      }
      if (filters.type && item.type !== filters.type) {
        return false;
      }
      if (
        filters.filePath &&
        !item.filesRead.includes(filters.filePath) &&
        !item.filesModified.includes(filters.filePath)
      ) {
        return false;
      }
      return true;
    });

    return filtered.slice(0, limit).map((item) => ({
      id: item.id,
      memSessionId: item.memSessionId,
      type: item.type,
      title: item.title,
      project: item.project,
      createdAt: item.createdAt,
      snippet: item.narrative.slice(0, 160),
    }));
  }

  timeline(anchorId: string, depth = 2): readonly ObservationRecord[] {
    const anchor = this.observations.findById(anchorId);
    if (!anchor) {
      return [];
    }
    const rows = this.observations.listBySession(anchor.memSessionId, 500);
    const index = rows.findIndex((row) => row.id === anchorId);
    /* v8 ignore next 3 -- defensive: anchor found by findById must exist in its session */
    if (index < 0) {
      return [];
    }
    const start = Math.max(0, index - depth);
    const end = Math.min(rows.length, index + depth + 1);
    return rows.slice(start, end);
  }

  getObservations(ids: readonly string[]): readonly ObservationRecord[] {
    return ids
      .map((id) => this.observations.findById(id))
      .filter((item): item is ObservationRecord => item !== undefined);
  }

  save(
    text: string,
    title: string,
    options: SaveOptions = {},
  ): ObservationRecord {
    const project = options.project ?? this.defaultProject;
    const memSessionId =
      options.memSessionId ?? this.ensureSession(`manual:${project}`, project, title).id;

    return this.observations.create({
      id: this.idGenerator(),
      memSessionId,
      type: options.type ?? 'discovery',
      title,
      narrative: text,
      facts: [text.slice(0, 120)],
      concepts: [],
      filesRead: options.filesRead ?? [],
      filesModified: options.filesModified ?? [],
      project,
      promptNumber: options.promptNumber ?? 1,
    });
  }

  listQueue(status: QueueItemStatus, limit = 50): readonly QueueItemRecord[] {
    return this.queue.listByStatus(status, limit);
  }

  private ensureSession(sessionId: string, project: string, userPrompt: string): {
    readonly id: string;
    readonly promptCount: number;
  } {
    const existing = this.sessions.findBySessionId(sessionId);
    if (existing) {
      return existing;
    }
    return this.sessions.create({
      id: this.idGenerator(),
      sessionId,
      project,
      userPrompt,
    });
  }
}
