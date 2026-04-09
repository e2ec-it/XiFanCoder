export { DatabaseManager } from './manager.js';
export { SessionRepository } from './session-repository.js';
export { MessageRepository } from './message-repository.js';
export { TokenUsageRepository } from './token-usage-repository.js';
export { buildParameterizedUpdateQuery } from './query-builder.js';
export {
  decryptJsonPayload,
  encryptJsonPayload,
  enforceDatabaseFilePermissions,
  isEncryptedPayload,
  resolveSecureDbPath,
} from './security.js';

export type {
  AppendMessageInput,
  CreateSessionInput,
  InsertTokenUsageInput,
  MessageRecord,
  MessageSearchResult,
  SearchMessagesOptions,
  SessionListOptions,
  SessionRecord,
  SessionStatus,
  StreamingAppendMessageInput,
  TokenUsageAggregate,
  TokenUsageRecord,
  TokenUsageRole,
  UpdateSessionInput,
} from './types.js';
export type {
  DatabaseManagerOptions,
  MigrationRecord,
} from './manager.js';
