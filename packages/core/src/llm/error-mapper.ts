import {
  LLMRateLimitError,
  LLMAuthError,
  LLMContextLimitError,
  LLMNetworkError,
  type XiFanError,
} from '../errors/index.js';

/**
 * 将 HTTP 状态码和响应体映射为 XiFanError
 *
 * 对应 llm-driver-design.md §9 的错误映射规范。
 */
export function mapHttpError(
  status: number,
  body: unknown,
  url: string,
): XiFanError {
  switch (status) {
    case 401:
    case 403: {
      const hostname = safeHostname(url);
      return new LLMAuthError(hostname);
    }

    case 429: {
      const retryAfterMs = extractRetryAfterMs(body);
      return new LLMRateLimitError(retryAfterMs);
    }

    case 400: {
      if (isContextLimitError(body)) {
        return new LLMContextLimitError(0, 0);
      }
      return new LLMNetworkError(url, `Bad Request: ${safeBodySummary(body)}`);
    }

    default: {
      if (status >= 500) {
        return new LLMNetworkError(url, `HTTP ${status} Server Error`);
      }
      return new LLMNetworkError(url, `HTTP ${status}: ${safeBodySummary(body)}`);
    }
  }
}

/**
 * 从响应体中提取 Retry-After 等待时间（毫秒）
 * 若无法提取则返回默认值 5000ms
 */
export function extractRetryAfterMs(body: unknown): number {
  const DEFAULT_RETRY_MS = 5_000;

  if (typeof body !== 'object' || body === null) return DEFAULT_RETRY_MS;

  const obj = body as Record<string, unknown>;

  // Anthropic / OpenAI 通常在 error.message 中包含 retry-after 秒数
  const message = typeof obj['message'] === 'string' ? obj['message'] : '';
  const seconds = extractRetrySeconds(message);
  if (seconds !== undefined) {
    return seconds * 1_000;
  }

  // 部分 API 在响应体中提供 retry_after 字段
  if (typeof obj['retry_after'] === 'number') {
    return obj['retry_after'] * 1_000;
  }

  return DEFAULT_RETRY_MS;
}

function extractRetrySeconds(message: string): number | undefined {
  const normalized = message.toLowerCase();
  const marker = 'second';
  let cursor = 0;

  while (cursor < normalized.length) {
    const markerIndex = normalized.indexOf(marker, cursor);
    if (markerIndex === -1) {
      return undefined;
    }

    let end = markerIndex - 1;
    while (end >= 0 && isWhitespace(normalized[end] ?? '')) {
      end -= 1;
    }

    let start = end;
    while (start >= 0 && isDigit(normalized[start] ?? '')) {
      start -= 1;
    }

    if (end >= 0 && start < end) {
      const raw = normalized.slice(start + 1, end + 1);
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    cursor = markerIndex + marker.length;
  }

  /* v8 ignore next 2 -- v8 coverage boundary: function exit after while loop */
  return undefined;
}

function isWhitespace(value: string): boolean {
  return value === ' ' || value === '\t' || value === '\n' || value === '\r' || value === '\f';
}

function isDigit(value: string): boolean {
  const code = value.charCodeAt(0);
  return code >= 48 && code <= 57;
}

/**
 * 判断是否为上下文超限错误
 */
export function isContextLimitError(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;

  const obj = body as Record<string, unknown>;
  const message = String(obj['message'] ?? obj['error'] ?? '').toLowerCase();

  return (
    message.includes('context length') ||
    message.includes('context window') ||
    message.includes('maximum context') ||
    message.includes('tokens exceed') ||
    message.includes('reduce the length')
  );
}

/** 安全提取 hostname（避免暴露完整 URL） */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/** 安全截断响应体（避免暴露大量内容） */
function safeBodySummary(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 100);
  if (typeof body === 'object' && body !== null) {
    const obj = body as Record<string, unknown>;
    const msg = obj['message'] ?? obj['error'] ?? obj['detail'];
    return typeof msg === 'string' ? msg.slice(0, 100) : '[object]';
  }
  return String(body).slice(0, 100);
}
