import { randomUUID } from 'node:crypto';

import { DatabaseManager } from '../db/manager.js';
import { MessageRepository } from '../db/message-repository.js';
import { SessionRepository } from '../db/session-repository.js';
import { TokenUsageRepository } from '../db/token-usage-repository.js';
import type {
  AgentMode,
  MessageRecord,
  MessageRole,
  SessionRecord,
  TokenUsageAggregate,
  TokenUsageRecord,
} from '../db/types.js';
import { BudgetExceededError } from '../errors/index.js';
import { estimateCost } from '../llm/index.js';

export interface SessionManagerOptions {
  readonly dbPath?: string;
  readonly now?: () => number;
  readonly idGenerator?: () => string;
  readonly allowExternalDbPath?: boolean;
  readonly messageEncryptionKey?: string;
}

export interface CreateSessionOptions {
  readonly id?: string;
  readonly projectPath: string;
  readonly model: string;
  readonly provider: string;
  readonly agentMode?: AgentMode;
}

export interface SessionQueryOptions {
  readonly projectPath?: string;
  readonly limit?: number;
}

export interface SessionResumeResult {
  readonly session: SessionRecord;
  readonly messages: readonly MessageRecord[];
}

export interface AppendMessageOptions {
  readonly id?: string;
  readonly sessionId: string;
  readonly role: MessageRole;
  readonly content: unknown;
  readonly tokenCount?: number;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: string;
}

export interface StreamingAppendMessageOptions {
  readonly messageId: string;
  readonly sessionId: string;
  readonly role: MessageRole;
  readonly chunk: string;
}

export interface RecordTokenUsageOptions {
  readonly id?: string;
  readonly sessionId: string;
  readonly role: 'user' | 'assistant' | 'tool';
  readonly model?: string;
  readonly provider?: string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly costUsd?: number;
  readonly toolCallCount?: number;
  readonly createdAt?: number;
}

export interface BudgetCheckOptions {
  readonly sessionId?: string;
  readonly sessionBudgetUsd?: number;
  readonly dailyBudgetUsd?: number;
  readonly day?: string;
}

export interface BudgetCheckResult {
  readonly sessionCostUsd?: number;
  readonly dailyCostUsd?: number;
}

export class SessionManager {
  private readonly dbManager: DatabaseManager;
  private readonly now: () => number;
  private readonly idGenerator: () => string;

  private readonly sessions: SessionRepository;
  private readonly messages: MessageRepository;
  private readonly tokenUsage: TokenUsageRepository;

  constructor(options: SessionManagerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
    this.dbManager = new DatabaseManager({
      dbPath: options.dbPath,
      now: this.now,
      allowExternalDbPath: options.allowExternalDbPath,
    });
    this.dbManager.migrate();
    const db = this.dbManager.getConnection();
    this.sessions = new SessionRepository(db, { now: this.now });
    this.messages = new MessageRepository(db, {
      now: this.now,
      encryptionKey: options.messageEncryptionKey ?? process.env.XIFAN_DB_ENCRYPTION_KEY,
    });
    this.tokenUsage = new TokenUsageRepository(db, { now: this.now });
  }

  createSession(input: CreateSessionOptions): SessionRecord {
    const id = input.id ?? this.idGenerator();
    return this.sessions.create({
      id,
      projectPath: input.projectPath,
      model: input.model,
      provider: input.provider,
      agentMode: input.agentMode ?? 'build',
      createdAt: this.now(),
      updatedAt: this.now(),
    });
  }

  listSessions(options: SessionQueryOptions = {}): readonly SessionRecord[] {
    if (options.projectPath) {
      return this.sessions.findByProject(options.projectPath, options.limit ?? 50);
    }
    return this.sessions.list({
      limit: options.limit ?? 50,
    });
  }

  resumeSession(sessionId: string): SessionResumeResult | undefined {
    const session = this.sessions.findById(sessionId);
    if (!session) {
      return undefined;
    }
    const messages = this.messages.findBySession(sessionId);
    return {
      session,
      messages,
    };
  }

  appendMessage(input: AppendMessageOptions): MessageRecord {
    return this.messages.append({
      id: input.id ?? this.idGenerator(),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      tokenCount: input.tokenCount,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      toolCalls: input.toolCalls,
      createdAt: this.now(),
    });
  }

  streamingAppend(input: StreamingAppendMessageOptions): MessageRecord {
    return this.messages.streamingAppend({
      id: input.messageId,
      sessionId: input.sessionId,
      role: input.role,
      chunk: input.chunk,
      createdAt: this.now(),
    });
  }

  updateContextSnapshot(sessionId: string, contextSnapshot: string): SessionRecord | undefined {
    return this.sessions.update(sessionId, {
      contextSnapshot,
      updatedAt: this.now(),
    });
  }

  recordTokenUsage(input: RecordTokenUsageOptions): TokenUsageRecord {
    const session = this.sessions.findById(input.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${input.sessionId}`);
    }

    const model = input.model ?? session.model;
    const provider = input.provider ?? session.provider;
    const promptTokens = input.promptTokens ?? 0;
    const completionTokens = input.completionTokens ?? 0;
    const cacheReadTokens = input.cacheReadTokens ?? 0;
    const cacheWriteTokens = input.cacheWriteTokens ?? 0;
    const totalTokens = input.totalTokens ?? promptTokens + completionTokens;
    const costUsd = input.costUsd ?? estimateCost(model, {
      promptTokens,
      completionTokens,
      cacheReadTokens,
      cacheWriteTokens,
    });

    const recorded = this.tokenUsage.insert({
      id: input.id ?? this.idGenerator(),
      sessionId: input.sessionId,
      model,
      provider,
      role: input.role,
      promptTokens,
      completionTokens,
      totalTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd,
      toolCallCount: input.toolCallCount ?? 0,
      createdAt: input.createdAt ?? this.now(),
    });

    this.sessions.update(session.id, {
      totalTokens: session.totalTokens + recorded.totalTokens,
      totalCostUsd: session.totalCostUsd + recorded.costUsd,
      updatedAt: this.now(),
    });
    return recorded;
  }

  getSessionCost(sessionId: string): TokenUsageAggregate {
    return this.tokenUsage.sumBySession(sessionId);
  }

  getTodayCost(day?: string): TokenUsageAggregate {
    const utcDay = day ?? new Date(this.now()).toISOString().slice(0, 10);
    return this.tokenUsage.sumByDay(utcDay);
  }

  getModelCost(model: string): TokenUsageAggregate {
    return this.tokenUsage.sumByModel(model);
  }

  checkBudget(options: BudgetCheckOptions): BudgetCheckResult {
    let sessionCostUsd: number | undefined;
    let dailyCostUsd: number | undefined;

    if (options.sessionBudgetUsd !== undefined) {
      if (!options.sessionId) {
        throw new Error('sessionBudgetUsd requires sessionId');
      }
      const sessionCost = this.getSessionCost(options.sessionId).costUsd;
      sessionCostUsd = sessionCost;
      if (sessionCost > options.sessionBudgetUsd) {
        throw new BudgetExceededError('session', options.sessionBudgetUsd, sessionCost);
      }
    }

    if (options.dailyBudgetUsd !== undefined) {
      const dailyCost = this.getTodayCost(options.day).costUsd;
      dailyCostUsd = dailyCost;
      if (dailyCost > options.dailyBudgetUsd) {
        throw new BudgetExceededError('daily', options.dailyBudgetUsd, dailyCost);
      }
    }

    return {
      sessionCostUsd,
      dailyCostUsd,
    };
  }

  close(): void {
    this.dbManager.close();
  }
}
