export { AiderExecutor } from './aider.js';
export { runProcessCommand, type ProcessRunInput, type ProcessRunResult } from './process.js';
export { createAiderRpcHandler, startAiderPluginServer } from './main.js';

export type {
  AiderToolName,
  AiderRuntimeConfig,
  AiderEditInput,
  AiderCommitInput,
  AiderUndoInput,
  AiderExecutionResult,
  AiderAvailability,
} from './types.js';
