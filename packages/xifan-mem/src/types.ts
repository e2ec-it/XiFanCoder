export type MemSessionStatus = 'active' | 'completed' | 'failed';

export interface MemSessionRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly project: string;
  readonly userPrompt: string;
  readonly status: MemSessionStatus;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly promptCount: number;
}

export interface CreateMemSessionInput {
  readonly id: string;
  readonly sessionId: string;
  readonly project: string;
  readonly userPrompt: string;
  readonly status?: MemSessionStatus;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly promptCount?: number;
}

export type ObservationType =
  | 'decision'
  | 'bugfix'
  | 'feature'
  | 'refactor'
  | 'discovery'
  | 'change';

export interface ObservationRecord {
  readonly id: string;
  readonly memSessionId: string;
  readonly type: ObservationType;
  readonly title: string;
  readonly subtitle?: string;
  readonly narrative: string;
  readonly facts: readonly string[];
  readonly concepts: readonly string[];
  readonly filesRead: readonly string[];
  readonly filesModified: readonly string[];
  readonly project: string;
  readonly promptNumber: number;
  readonly createdAt: number;
}

export interface CreateObservationInput {
  readonly id: string;
  readonly memSessionId: string;
  readonly type: ObservationType;
  readonly title: string;
  readonly subtitle?: string;
  readonly narrative: string;
  readonly facts: readonly string[];
  readonly concepts: readonly string[];
  readonly filesRead: readonly string[];
  readonly filesModified: readonly string[];
  readonly project: string;
  readonly promptNumber: number;
  readonly createdAt?: number;
}

export interface SessionSummaryRecord {
  readonly id: string;
  readonly memSessionId: string;
  readonly request: string;
  readonly investigated: string;
  readonly learned: string;
  readonly completed: string;
  readonly nextSteps: string;
  readonly notes?: string;
  readonly filesRead: readonly string[];
  readonly filesEdited: readonly string[];
  readonly project: string;
  readonly createdAt: number;
}

export interface CreateSessionSummaryInput {
  readonly id: string;
  readonly memSessionId: string;
  readonly request: string;
  readonly investigated: string;
  readonly learned: string;
  readonly completed: string;
  readonly nextSteps: string;
  readonly notes?: string;
  readonly filesRead: readonly string[];
  readonly filesEdited: readonly string[];
  readonly project: string;
  readonly createdAt?: number;
}

export interface UserPromptRecord {
  readonly id: string;
  readonly memSessionId: string;
  readonly content: string;
  readonly project: string;
  readonly promptNumber: number;
  readonly createdAt: number;
}

export interface AppendUserPromptInput {
  readonly id: string;
  readonly memSessionId: string;
  readonly content: string;
  readonly project: string;
  readonly promptNumber: number;
  readonly createdAt?: number;
}

export type QueueItemType = 'observation' | 'summarize';
export type QueueItemStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface QueueItemRecord {
  readonly id: string;
  readonly type: QueueItemType;
  readonly payload: string;
  readonly status: QueueItemStatus;
  readonly retryCount: number;
  readonly claimedAt?: number;
  readonly createdAt: number;
}

export interface EnqueueQueueItemInput {
  readonly id: string;
  readonly type: QueueItemType;
  readonly payload: string;
  readonly status?: QueueItemStatus;
  readonly retryCount?: number;
  readonly claimedAt?: number;
  readonly createdAt?: number;
}

export interface SearchResult {
  readonly id: string;
  readonly memSessionId: string;
  readonly type: ObservationType;
  readonly title: string;
  readonly project: string;
  readonly createdAt: number;
  readonly snippet: string;
}

export interface SearchFilters {
  readonly project?: string;
  readonly type?: ObservationType;
  readonly filePath?: string;
  readonly limit?: number;
}
