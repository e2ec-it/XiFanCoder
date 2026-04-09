import { describe, expect, it } from 'vitest';

import {
  LLMAuthError,
  LLMContextLimitError,
  LLMNetworkError,
  LLMRateLimitError,
} from '../../errors/index.js';
import { extractRetryAfterMs, isContextLimitError, mapHttpError } from '../error-mapper.js';

describe('extractRetryAfterMs', () => {
  it('extracts seconds from retry message text', () => {
    const value = extractRetryAfterMs({
      message: 'Rate limit exceeded. Please retry in 12 seconds.',
    });
    expect(value).toBe(12_000);
  });

  it('uses retry_after field when message does not include seconds', () => {
    const value = extractRetryAfterMs({
      retry_after: 3,
      message: 'Please retry later.',
    });
    expect(value).toBe(3_000);
  });

  it('falls back to default for unsupported payload', () => {
    expect(extractRetryAfterMs('oops')).toBe(5_000);
  });
});

describe('error mapper helpers', () => {
  it('detects context limit errors by known phrases', () => {
    expect(isContextLimitError({ message: 'maximum context window exceeded' })).toBe(true);
    expect(isContextLimitError({ message: 'network timeout' })).toBe(false);
  });

  it('maps auth and context errors to typed XiFan errors', () => {
    const authError = mapHttpError(401, { message: 'unauthorized' }, 'https://api.openai.com/v1/chat');
    expect(authError).toBeInstanceOf(LLMAuthError);

    const contextError = mapHttpError(400, { message: 'context length exceeded' }, 'https://api.test');
    expect(contextError).toBeInstanceOf(LLMContextLimitError);
  });

  it('maps 403 to LLMAuthError', () => {
    const error = mapHttpError(403, { message: 'forbidden' }, 'https://api.test.com/v1');
    expect(error).toBeInstanceOf(LLMAuthError);
  });

  it('maps 429 to LLMRateLimitError', () => {
    const error = mapHttpError(429, { message: 'rate limit' }, 'https://api.test.com/v1');
    expect(error).toBeInstanceOf(LLMRateLimitError);
  });

  it('maps 400 non-context-limit to LLMNetworkError with body summary', () => {
    const error = mapHttpError(400, { message: 'invalid model' }, 'https://api.test.com/v1');
    expect(error).toBeInstanceOf(LLMNetworkError);
  });

  it('maps 500+ to LLMNetworkError as server error', () => {
    const error = mapHttpError(502, null, 'https://api.test.com/v1');
    expect(error).toBeInstanceOf(LLMNetworkError);
  });

  it('maps other status codes to LLMNetworkError', () => {
    const error = mapHttpError(404, { error: 'not found' }, 'https://api.test.com/v1');
    expect(error).toBeInstanceOf(LLMNetworkError);
  });

  it('safeBodySummary handles different body types', () => {
    // String body
    const strError = mapHttpError(404, 'plain text error message', 'https://api.test.com/v1');
    expect(strError).toBeInstanceOf(LLMNetworkError);

    // Non-string, non-object body
    const numError = mapHttpError(404, 42, 'https://api.test.com/v1');
    expect(numError).toBeInstanceOf(LLMNetworkError);

    // Object with 'detail' field
    const detailError = mapHttpError(404, { detail: 'detailed error' }, 'https://api.test.com/v1');
    expect(detailError).toBeInstanceOf(LLMNetworkError);

    // Object without message/error/detail
    const objError = mapHttpError(404, { foo: 'bar' }, 'https://api.test.com/v1');
    expect(objError).toBeInstanceOf(LLMNetworkError);
  });

  it('safeHostname handles invalid URL', () => {
    const error = mapHttpError(401, {}, 'not-a-valid-url');
    expect(error).toBeInstanceOf(LLMAuthError);
  });

  it('extractRetrySeconds handles messages without matching number', () => {
    const value = extractRetryAfterMs({
      message: 'Please wait seconds before retrying',
    });
    // No number before "second", should fall through to default
    expect(value).toBe(5_000);
  });

  it('extractRetrySeconds handles message with no second keyword at all', () => {
    const value = extractRetryAfterMs({
      message: 'Rate limited, please try again later',
    });
    expect(value).toBe(5_000);
  });

  it('extractRetryAfterMs returns default for null body', () => {
    expect(extractRetryAfterMs(null)).toBe(5_000);
  });

  it('isContextLimitError detects all known phrases', () => {
    expect(isContextLimitError({ message: 'tokens exceed the limit' })).toBe(true);
    expect(isContextLimitError({ error: 'reduce the length of messages' })).toBe(true);
    expect(isContextLimitError({ message: 'maximum context limit' })).toBe(true);
    expect(isContextLimitError(null)).toBe(false);
    expect(isContextLimitError('string')).toBe(false);
  });
});
