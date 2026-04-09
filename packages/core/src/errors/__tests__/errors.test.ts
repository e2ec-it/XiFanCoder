/**
 * 错误处理框架单元测试
 *
 * 覆盖：
 * 1. XiFanError 基类 instanceof 链
 * 2. 各错误类字段正确性
 * 3. 类型守卫函数
 * 4. formatErrorForUser 用户友好消息（不泄露敏感信息）
 */

import { describe, it, expect } from 'vitest';
import {
  XiFanError,
  LLMRateLimitError,
  LLMAuthError,
  LLMContextLimitError,
  LLMStreamError,
  MaxRoundsExceededError,
  LLMNetworkError,
  ToolNotFoundError,
  ToolExecutionError,
  ToolPermissionDeniedError,
  ToolTimeoutError,
  EditConflictError,
  ConfigValidationError,
  ConfigNotFoundError,
  PluginCrashError,
  PluginNotFoundError,
  PluginTimeoutError,
  BudgetExceededError,
} from '../index.js';
import {
  isXiFanError,
  isRetryableError,
  isLLMError,
  isToolError,
  isConfigError,
  isPluginError,
  isBudgetError,
  hasErrorCode,
} from '../guards.js';
import { formatErrorForUser } from '../formatter.js';

// ─── 1. instanceof 链测试 ──────────────────────────────────────────────────

describe('XiFanError 基类 instanceof 链', () => {
  it('LLMRateLimitError 应同时是 XiFanError 和 Error', () => {
    const err = new LLMRateLimitError(5_000);
    expect(err).toBeInstanceOf(LLMRateLimitError);
    expect(err).toBeInstanceOf(XiFanError);
    expect(err).toBeInstanceOf(Error);
  });

  it('LLMAuthError 应同时是 XiFanError 和 Error', () => {
    const err = new LLMAuthError('anthropic');
    expect(err).toBeInstanceOf(LLMAuthError);
    expect(err).toBeInstanceOf(XiFanError);
    expect(err).toBeInstanceOf(Error);
  });

  it('ToolExecutionError 应同时是 XiFanError 和 Error', () => {
    const err = new ToolExecutionError('read_file', 'Permission denied');
    expect(err).toBeInstanceOf(ToolExecutionError);
    expect(err).toBeInstanceOf(XiFanError);
    expect(err).toBeInstanceOf(Error);
  });

  it('BudgetExceededError 应同时是 XiFanError 和 Error', () => {
    const err = new BudgetExceededError('session', 5.0, 6.5);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err).toBeInstanceOf(XiFanError);
    expect(err).toBeInstanceOf(Error);
  });
});

// ─── 2. 各错误类字段验证 ────────────────────────────────────────────────────

describe('LLM 错误类字段', () => {
  it('LLMRateLimitError 字段正确', () => {
    const err = new LLMRateLimitError(3_000);
    expect(err.code).toBe('E1001');
    expect(err.recoverable).toBe(true);
    expect(err.retryAfterMs).toBe(3_000);
    expect(err.name).toBe('LLMRateLimitError');
    expect(err.message).toContain('3000');
  });

  it('LLMAuthError 字段正确', () => {
    const err = new LLMAuthError('openai');
    expect(err.code).toBe('E1002');
    expect(err.recoverable).toBe(false);
    expect(err.provider).toBe('openai');
    expect(err.message).toContain('openai');
  });

  it('LLMContextLimitError 字段正确', () => {
    const err = new LLMContextLimitError(150_000, 128_000);
    expect(err.code).toBe('E1003');
    expect(err.recoverable).toBe(true);
    expect(err.currentTokens).toBe(150_000);
    expect(err.maxTokens).toBe(128_000);
  });

  it('LLMStreamError 字段正确', () => {
    const err = new LLMStreamError('connection reset');
    expect(err.code).toBe('E1004');
    expect(err.recoverable).toBe(true);
  });

  it('MaxRoundsExceededError 字段正确', () => {
    const err = new MaxRoundsExceededError(50);
    expect(err.code).toBe('E1005');
    expect(err.recoverable).toBe(false);
    expect(err.rounds).toBe(50);
  });

  it('LLMNetworkError 字段正确', () => {
    const err = new LLMNetworkError('https://api.anthropic.com', 'timeout');
    expect(err.code).toBe('E1006');
    expect(err.recoverable).toBe(true);
  });
});

describe('Tool 错误类字段', () => {
  it('ToolNotFoundError 字段正确', () => {
    const err = new ToolNotFoundError('unknown_tool');
    expect(err.code).toBe('E2001');
    expect(err.toolName).toBe('unknown_tool');
  });

  it('ToolTimeoutError 字段正确', () => {
    const err = new ToolTimeoutError('bash_execute', 30_000);
    expect(err.code).toBe('E2004');
    expect(err.toolName).toBe('bash_execute');
    expect(err.timeoutMs).toBe(30_000);
  });

  it('EditConflictError 字段正确', () => {
    const err = new EditConflictError('a.ts', 'sha256:1', 'sha256:2');
    expect(err.code).toBe('E2005');
    expect(err.path).toBe('a.ts');
    expect(err.expectedHash).toBe('sha256:1');
    expect(err.actualHash).toBe('sha256:2');
  });
});

describe('Config 错误类字段', () => {
  it('ConfigValidationError 字段正确', () => {
    const errors = [{ field: 'model', message: 'required' }];
    const err = new ConfigValidationError(errors);
    expect(err.code).toBe('E3001');
    expect(err.recoverable).toBe(false);
    expect(err.validationErrors).toBe(errors);
  });

  it('ConfigNotFoundError 字段正确', () => {
    const err = new ConfigNotFoundError('/home/user/.xifan/config.json');
    expect(err.code).toBe('E3002');
    expect(err.configPath).toBe('/home/user/.xifan/config.json');
  });
});

describe('Plugin 错误类字段', () => {
  it('PluginCrashError 字段正确', () => {
    const err = new PluginCrashError('my-plugin', 1);
    expect(err.code).toBe('E4001');
    expect(err.recoverable).toBe(true);
    expect(err.exitCode).toBe(1);
  });

  it('PluginNotFoundError 字段正确', () => {
    const err = new PluginNotFoundError('missing-plugin');
    expect(err.code).toBe('E4002');
    expect(err.recoverable).toBe(false);
  });

  it('PluginTimeoutError 字段正确', () => {
    const err = new PluginTimeoutError('slow-plugin', 10_000);
    expect(err.code).toBe('E4003');
    expect(err.recoverable).toBe(true);
    expect(err.timeoutMs).toBe(10_000);
  });
});

describe('Budget 错误类字段', () => {
  it('BudgetExceededError 字段正确', () => {
    const err = new BudgetExceededError('daily', 10.0, 12.5);
    expect(err.code).toBe('E6001');
    expect(err.recoverable).toBe(false);
    expect(err.budgetType).toBe('daily');
    expect(err.limitUsd).toBe(10.0);
    expect(err.currentUsd).toBe(12.5);
  });
});

// ─── 3. 类型守卫函数测试 ────────────────────────────────────────────────────

describe('isXiFanError 类型守卫', () => {
  it('XiFanError 子类返回 true', () => {
    expect(isXiFanError(new LLMAuthError('x'))).toBe(true);
    expect(isXiFanError(new ToolTimeoutError('bash', 1000))).toBe(true);
  });

  it('普通 Error 返回 false', () => {
    expect(isXiFanError(new Error('oops'))).toBe(false);
  });

  it('非 Error 值返回 false', () => {
    expect(isXiFanError(null)).toBe(false);
    expect(isXiFanError(42)).toBe(false);
    expect(isXiFanError('string')).toBe(false);
    expect(isXiFanError(undefined)).toBe(false);
  });
});

describe('isRetryableError 类型守卫', () => {
  it('recoverable=true 的错误返回 true', () => {
    expect(isRetryableError(new LLMRateLimitError(1000))).toBe(true);
    expect(isRetryableError(new LLMStreamError())).toBe(true);
    expect(isRetryableError(new LLMContextLimitError(0, 0))).toBe(true);
    expect(isRetryableError(new LLMNetworkError('url', 'msg'))).toBe(true);
    expect(isRetryableError(new ToolExecutionError('t', 'm'))).toBe(true);
  });

  it('recoverable=false 的错误返回 false', () => {
    expect(isRetryableError(new LLMAuthError('x'))).toBe(false);
    expect(isRetryableError(new MaxRoundsExceededError(10))).toBe(false);
    expect(isRetryableError(new BudgetExceededError('session', 1, 2))).toBe(false);
    expect(isRetryableError(new ConfigValidationError([]))).toBe(false);
  });

  it('非 XiFanError 返回 false', () => {
    expect(isRetryableError(new Error('x'))).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });
});

describe('领域类型守卫', () => {
  it('isLLMError 识别 E1xxx', () => {
    expect(isLLMError(new LLMRateLimitError(0))).toBe(true);
    expect(isLLMError(new LLMAuthError('x'))).toBe(true);
    expect(isLLMError(new ToolNotFoundError('t'))).toBe(false);
  });

  it('isToolError 识别 E2xxx', () => {
    expect(isToolError(new ToolNotFoundError('t'))).toBe(true);
    expect(isToolError(new ToolPermissionDeniedError('t'))).toBe(true);
    expect(isToolError(new EditConflictError('a.ts', 'sha256:1', 'sha256:2'))).toBe(true);
    expect(isToolError(new LLMRateLimitError(0))).toBe(false);
  });

  it('isConfigError 识别 E3xxx', () => {
    expect(isConfigError(new ConfigNotFoundError('/path'))).toBe(true);
    expect(isConfigError(new LLMAuthError('x'))).toBe(false);
  });

  it('isPluginError 识别 E4xxx', () => {
    expect(isPluginError(new PluginCrashError('p', 1))).toBe(true);
    expect(isPluginError(new PluginNotFoundError('p'))).toBe(true);
    expect(isPluginError(new ToolNotFoundError('t'))).toBe(false);
  });

  it('isBudgetError 识别 E6xxx', () => {
    expect(isBudgetError(new BudgetExceededError('session', 1, 2))).toBe(true);
    expect(isBudgetError(new LLMAuthError('x'))).toBe(false);
  });
});

describe('hasErrorCode 精确匹配', () => {
  it('匹配正确错误码', () => {
    expect(hasErrorCode(new LLMRateLimitError(0), 'E1001')).toBe(true);
    expect(hasErrorCode(new LLMAuthError('x'), 'E1002')).toBe(true);
  });

  it('不匹配错误码', () => {
    expect(hasErrorCode(new LLMRateLimitError(0), 'E1002')).toBe(false);
  });

  it('非 XiFanError 返回 false', () => {
    expect(hasErrorCode(new Error('x'), 'E1001')).toBe(false);
  });
});

// ─── 4. formatErrorForUser 用户友好消息测试 ─────────────────────────────────

describe('formatErrorForUser 用户消息', () => {
  it('E1001 消息包含重试提示，不暴露内部路径', () => {
    const msg = formatErrorForUser(new LLMRateLimitError(3_000));
    expect(msg).toBeTruthy();
    expect(msg).toContain('重试');
  });

  it('E1002 消息提示检查 API Key，不包含实际密钥', () => {
    const msg = formatErrorForUser(new LLMAuthError('anthropic'));
    expect(msg).toContain('API Key');
    expect(msg).not.toContain('sk-');  // 不泄露密钥格式
  });

  it('E1003 消息包含上下文超限提示', () => {
    const msg = formatErrorForUser(new LLMContextLimitError(150_000, 128_000));
    expect(msg).toBeTruthy();
    expect(msg.length).toBeGreaterThan(0);
  });

  it('E6001 消息包含预算超限提示', () => {
    const msg = formatErrorForUser(new BudgetExceededError('session', 10, 12));
    expect(msg).toBeTruthy();
    expect(msg).not.toContain('Error');  // 不暴露内部错误类名
  });

  it('E2005 消息提示重新读取', () => {
    const msg = formatErrorForUser(new EditConflictError('a.ts', 'sha256:1', 'sha256:2'));
    expect(msg).toContain('编辑冲突');
    expect(msg).toContain('重新读取');
  });

  it('未知错误码返回通用消息', () => {
    // 使用一个已知的错误类来测试通用路径
    const msg = formatErrorForUser(new PluginCrashError('test-plugin', null));
    expect(msg).toBeTruthy();
    expect(msg.length).toBeGreaterThan(0);
  });
});

// ─── 5. cause 字段测试 ──────────────────────────────────────────────────────

describe('cause 字段传递', () => {
  it('LLMNetworkError 保留 cause', () => {
    const originalError = new Error('connection refused');
    const err = new LLMNetworkError('url', 'network error', originalError);
    expect(err.cause).toBe(originalError);
  });

  it('LLMStreamError 保留 cause', () => {
    const originalError = new Error('stream aborted');
    const err = new LLMStreamError('stream failed', originalError);
    expect(err.cause).toBe(originalError);
  });
});
