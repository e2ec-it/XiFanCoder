export type SessionStatus = 'active' | 'completed' | 'failed' | 'archived';
export type AgentMode = 'build' | 'plan';
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type TokenUsageRole = 'user' | 'assistant' | 'tool';

export interface SessionRecord {
  readonly id: string;
  readonly projectPath: string;
  readonly model: string;
  readonly provider: string;
  readonly status: SessionStatus;
  readonly agentMode: AgentMode;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number;
  readonly contextSnapshot?: string;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly messageCount: number;
  readonly memSessionId?: string;
}

export interface CreateSessionInput {
  readonly id: string;
  readonly projectPath: string;
  readonly model: string;
  readonly provider: string;
  readonly status?: SessionStatus;
  readonly agentMode?: AgentMode;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly completedAt?: number;
  readonly contextSnapshot?: string;
  readonly totalTokens?: number;
  readonly totalCostUsd?: number;
  readonly messageCount?: number;
  readonly memSessionId?: string;
}

export interface UpdateSessionInput {
  readonly model?: string;
  readonly provider?: string;
  readonly status?: SessionStatus;
  readonly agentMode?: AgentMode;
  readonly updatedAt?: number;
  readonly completedAt?: number;
  readonly contextSnapshot?: string;
  readonly totalTokens?: number;
  readonly totalCostUsd?: number;
  readonly messageCount?: number;
  readonly memSessionId?: string;
}

export interface SessionListOptions {
  readonly status?: SessionStatus;
  readonly limit?: number;
  readonly offset?: number;
}

export interface MessageRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly role: MessageRole;
  readonly content: unknown;
  readonly toolCalls?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly tokenCount?: number;
  readonly createdAt: number;
}

export interface AppendMessageInput {
  readonly id: string;
  readonly sessionId: string;
  readonly role: MessageRole;
  readonly content: unknown;
  readonly toolCalls?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly tokenCount?: number;
  readonly createdAt?: number;
}

export interface StreamingAppendMessageInput {
  readonly id: string;
  readonly sessionId: string;
  readonly role: MessageRole;
  readonly chunk: string;
  readonly createdAt?: number;
}

export interface MessageSearchResult {
  readonly message: MessageRecord;
  readonly rank: number;
}

export interface TokenUsageRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly model: string;
  readonly provider: string;
  readonly role: TokenUsageRole;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  readonly toolCallCount: number;
  readonly createdAt: number;
}

export interface InsertTokenUsageInput {
  readonly id: string;
  readonly sessionId: string;
  readonly model: string;
  readonly provider: string;
  readonly role: TokenUsageRole;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly costUsd?: number;
  readonly toolCallCount?: number;
  readonly createdAt?: number;
}

export interface TokenUsageAggregate {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  readonly toolCallCount: number;
}

export interface SearchMessagesOptions {
  readonly sessionId?: string;
  readonly limit?: number;
}
