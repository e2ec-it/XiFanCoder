// 基类
export { XiFanError } from './base.js';

// LLM 错误（E1xxx）
export {
  LLMRateLimitError,
  LLMAuthError,
  LLMContextLimitError,
  LLMStreamError,
  MaxRoundsExceededError,
  LLMNetworkError,
} from './llm-errors.js';

// 工具错误（E2xxx）
export {
  ToolNotFoundError,
  ToolExecutionError,
  ToolPermissionDeniedError,
  ToolTimeoutError,
  EditConflictError,
} from './tool-errors.js';

// 配置错误（E3xxx）
export { ConfigValidationError, ConfigNotFoundError } from './config-errors.js';

// 插件错误（E4xxx）
export { PluginCrashError, PluginNotFoundError, PluginTimeoutError } from './plugin-errors.js';

// 预算错误（E6xxx）
export { BudgetExceededError } from './budget-errors.js';

// 类型守卫
export {
  isXiFanError,
  isRetryableError,
  isLLMError,
  isToolError,
  isConfigError,
  isPluginError,
  isBudgetError,
  hasErrorCode,
} from './guards.js';

// 用户友好格式化
export { formatErrorForUser } from './formatter.js';
