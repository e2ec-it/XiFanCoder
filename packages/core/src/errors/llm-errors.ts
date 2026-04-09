import { XiFanError } from './base.js';

/** E1001 — LLM API 速率限制（429） */
export class LLMRateLimitError extends XiFanError {
  readonly code = 'E1001';
  readonly recoverable = true;

  constructor(
    readonly retryAfterMs: number,
    cause?: unknown,
  ) {
    super(`LLM 请求频率超限，建议等待 ${retryAfterMs}ms 后重试`, cause);
  }
}

/** E1002 — LLM API Key 无效（401） */
export class LLMAuthError extends XiFanError {
  readonly code = 'E1002';
  readonly recoverable = false;

  constructor(
    readonly provider: string,
    cause?: unknown,
  ) {
    super(`LLM 认证失败（provider: ${provider}），请检查 API Key 配置`, cause);
  }
}

/** E1003 — 超出上下文窗口限制（400 + context limit） */
export class LLMContextLimitError extends XiFanError {
  readonly code = 'E1003';
  readonly recoverable = true;

  constructor(
    readonly currentTokens: number,
    readonly maxTokens: number,
    cause?: unknown,
  ) {
    super(
      `超出上下文窗口限制：当前 ${currentTokens} tokens，上限 ${maxTokens} tokens`,
      cause,
    );
  }
}

/** E1004 — 流式响应中断（可降级为非流式重试） */
export class LLMStreamError extends XiFanError {
  readonly code = 'E1004';
  readonly recoverable = true;

  constructor(message: string, cause?: unknown) {
    super(`流式响应中断：${message}`, cause);
  }
}

/** E1005 — 超出最大工具调用轮次（ADR-006：默认 50 轮） */
export class MaxRoundsExceededError extends XiFanError {
  readonly code = 'E1005';
  readonly recoverable = false;

  constructor(
    readonly rounds: number,
    cause?: unknown,
  ) {
    super(`已超出最大工具调用轮次（${rounds} 轮），会话终止`, cause);
  }
}

/** E1006 — LLM API 网络错误（5xx / 连接失败） */
export class LLMNetworkError extends XiFanError {
  readonly code = 'E1006';
  readonly recoverable = true;

  constructor(
    readonly url: string,
    message: string,
    cause?: unknown,
  ) {
    super(`LLM API 网络错误（${url}）：${message}`, cause);
  }
}
