export {
  applyHashAnchoredEdit,
  computeRangeHash,
  getRangeText,
  normalizeForHash,
  sha256,
} from './hash-anchor.js';
export { previewWriteFileChange, writeFileWithPolicy } from './write-file.js';
export { readFileSegment } from './read-file.js';
export { listDirectory } from './list-dir.js';
export { executeBashCommand } from './bash-execute.js';
export { fetchWebContent } from './web-fetch.js';
export {
  buildSandboxedCommand,
  checkCommandSafety,
  sanitizeCommandEnv,
} from './sandbox.js';
export {
  BASH_EXECUTE_INPUT_SCHEMA,
  LIST_DIR_INPUT_SCHEMA,
  READ_FILE_INPUT_SCHEMA,
  WEB_FETCH_INPUT_SCHEMA,
  WRITE_FILE_INPUT_SCHEMA,
  createBuiltinToolDefinitions,
  registerBuiltinTools,
} from './builtin.js';

export type {
  HashAnchoredEditRequest,
  HashAnchoredEditResult,
  LineRange,
} from './hash-anchor.js';
export type {
  HashAnchoredWriteFileRequest,
  LegacyWriteFileRequest,
  WriteFileMode,
  WriteFilePreview,
  WriteFileRequest,
  WriteFileResult,
} from './write-file.js';
export type { ReadFileOptions, ReadFileRequest, ReadFileResult } from './read-file.js';
export type { ListDirEntry, ListDirRequest, ListDirResult } from './list-dir.js';
export type {
  BashExecuteOptions,
  BashExecuteRequest,
  BashExecuteResult,
} from './bash-execute.js';
export type { CommandSafetyDecision, SandboxLimits } from './sandbox.js';
export type {
  BuiltinToolFactoryOptions,
} from './builtin.js';
export type {
  WebFetchOptions,
  WebFetchRequest,
  WebFetchResult,
  WebFetchSummaryInput,
  WebFetchSummarizer,
} from './web-fetch.js';

export {
  ToolDispatcher,
  createPluginToolDefinition,
} from './dispatcher.js';

export type {
  PluginToolBinding,
  PluginToolExecutor,
  ToolApprovalHandler,
  ToolApprovalRequest,
  ToolDefinition,
  ToolDispatcherOptions,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolExecutor,
  ToolSource,
} from './dispatcher.js';
