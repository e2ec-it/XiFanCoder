import { LLMRateLimitError, LLMStreamError, isRetryableError } from '../errors/index.js';
import type { LLMRequest, LLMResponse, StreamChunk } from './types.js';

/**
 * 重试配置（对应 llm-driver-design.md §10）
 */
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 16_000,
  jitterFactor: 0.2,   // ±20% 随机抖动
} as const;

/**
 * 带指数退避的重试包装函数
 *
 * - 仅对 isRetryableError() 为 true 的错误重试
 * - LLMRateLimitError 尊重 retryAfterMs 字段
 * - 最多重试 maxAttempts 次
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempt = 0,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isRetryableError(error) || attempt >= RETRY_CONFIG.maxAttempts - 1) {
      throw error;
    }

    const waitMs = calculateWaitMs(error, attempt);
    await sleep(waitMs);
    return withRetry(fn, attempt + 1);
  }
}

/**
 * 流式请求降级包装：
 * 若流式请求抛出 LLMStreamError，则降级为非流式请求，
 * 将完整响应转换为 StreamChunk 序列。
 */
export async function* streamWithFallback(
  request: LLMRequest,
  streamFn: (req: LLMRequest) => AsyncGenerator<StreamChunk>,
  chatFn: (req: LLMRequest) => Promise<LLMResponse>,
): AsyncGenerator<StreamChunk> {
  try {
    yield* streamFn(request);
  } catch (error) {
    if (error instanceof LLMStreamError) {
      // 降级到非流式请求
      const response = await withRetry(() => chatFn(request));
      yield* responseToStreamChunks(response);
    } else {
      throw error;
    }
  }
}

/**
 * 将完整 LLMResponse 转换为 StreamChunk 序列
 * （用于流式降级场景）
 */
export async function* responseToStreamChunks(
  response: LLMResponse,
): AsyncGenerator<StreamChunk> {
  const { message, finishReason, usage } = response;

  // 1. 文本内容
  const text = typeof message.content === 'string' ? message.content : null;
  if (text) {
    yield { type: 'text_delta', delta: text };
  }

  // 2. 工具调用
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      yield {
        type: 'tool_use_delta',
        toolCallId: tc.id,
        name: tc.function.name,
        argumentsDelta: tc.function.arguments,
      };
    }
  }

  // 3. 结束信号
  yield { type: 'message_stop', finishReason, usage };
}

// ─── 内部工具函数 ──────────────────────────────────────────────────────────

function calculateWaitMs(error: unknown, attempt: number): number {
  const baseDelay = Math.min(
    RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
    RETRY_CONFIG.maxDelayMs,
  );

  // ±20% 随机抖动（防止惊群）
  const jitter =
    baseDelay * RETRY_CONFIG.jitterFactor * (Math.random() * 2 - 1);
  const calculated = Math.max(0, baseDelay + jitter);

  // LLMRateLimitError 使用 API 返回的等待时间（取较大值）
  if (error instanceof LLMRateLimitError) {
    return Math.max(calculated, error.retryAfterMs);
  }

  return calculated;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
