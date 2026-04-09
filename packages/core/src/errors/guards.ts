import { XiFanError } from './base.js';
import {
  LLMRateLimitError,
  LLMAuthError,
  LLMContextLimitError,
  LLMStreamError,
  MaxRoundsExceededError,
  LLMNetworkError,
} from './llm-errors.js';
import {
  ToolNotFoundError,
  ToolExecutionError,
  ToolPermissionDeniedError,
  ToolTimeoutError,
  EditConflictError,
} from './tool-errors.js';
import { ConfigValidationError, ConfigNotFoundError } from './config-errors.js';
import { PluginCrashError, PluginNotFoundError, PluginTimeoutError } from './plugin-errors.js';
import { BudgetExceededError } from './budget-errors.js';

/** 判断是否为 XiFanError */
export function isXiFanError(err: unknown): err is XiFanError {
  return err instanceof XiFanError;
}

/** 判断是否为可重试的错误 */
export function isRetryableError(err: unknown): boolean {
  return isXiFanError(err) && err.recoverable;
}

/** 判断是否为 LLM 相关错误（E1xxx） */
export function isLLMError(
  err: unknown,
): err is
  | LLMRateLimitError
  | LLMAuthError
  | LLMContextLimitError
  | LLMStreamError
  | MaxRoundsExceededError
  | LLMNetworkError {
  return (
    err instanceof LLMRateLimitError ||
    err instanceof LLMAuthError ||
    err instanceof LLMContextLimitError ||
    err instanceof LLMStreamError ||
    err instanceof MaxRoundsExceededError ||
    err instanceof LLMNetworkError
  );
}

/** 判断是否为工具相关错误（E2xxx） */
export function isToolError(
  err: unknown,
): err is
  | ToolNotFoundError
  | ToolExecutionError
  | ToolPermissionDeniedError
  | ToolTimeoutError
  | EditConflictError {
  return (
    err instanceof ToolNotFoundError ||
    err instanceof ToolExecutionError ||
    err instanceof ToolPermissionDeniedError ||
    err instanceof ToolTimeoutError ||
    err instanceof EditConflictError
  );
}

/** 判断是否为配置相关错误（E3xxx） */
export function isConfigError(
  err: unknown,
): err is ConfigValidationError | ConfigNotFoundError {
  return err instanceof ConfigValidationError || err instanceof ConfigNotFoundError;
}

/** 判断是否为插件相关错误（E4xxx） */
export function isPluginError(
  err: unknown,
): err is PluginCrashError | PluginNotFoundError | PluginTimeoutError {
  return (
    err instanceof PluginCrashError ||
    err instanceof PluginNotFoundError ||
    err instanceof PluginTimeoutError
  );
}

/** 判断是否为预算相关错误（E6xxx） */
export function isBudgetError(err: unknown): err is BudgetExceededError {
  return err instanceof BudgetExceededError;
}

/** 按错误码精确匹配 */
export function hasErrorCode(err: unknown, code: string): boolean {
  return isXiFanError(err) && err.code === code;
}
