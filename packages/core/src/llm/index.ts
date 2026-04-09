/**
 * LLM 模块统一导出
 *
 * 公开接口：
 * - createDriver()：工厂函数（主入口）
 * - BuiltinTSDriver：Driver 实现类
 * - ILLMDriver / ILLMAdapter：接口类型
 * - 数据类型：LLMRequest / LLMResponse / StreamChunk / ...
 * - 工具函数：countTokens / estimateCost / withRetry / streamWithFallback
 */

// ─── 工厂 & Driver ────────────────────────────────────────────────────────────
export { createDriver } from './driver-factory.js';
export { BuiltinTSDriver } from './builtin-ts-driver.js';
export {
  LiteLLMProxyDriver,
  probeLiteLLMProxyHealth,
  resolveLiteLLMProxyBaseUrl,
  resolveLiteLLMProxyStartupConfig,
  startLiteLLMProxyProcess,
} from './litellm-proxy-driver.js';
export {
  detectLiteLLMProxyOnline,
  resolveLLMDriverMode,
} from './driver-selection.js';

// ─── 适配器（供高级用户扩展）──────────────────────────────────────────────────
export { AnthropicAdapter } from './adapters/anthropic-adapter.js';
export { OpenAIAdapter } from './adapters/openai-adapter.js';

// ─── 类型 ─────────────────────────────────────────────────────────────────────
export type {
  ProviderType,
  LiteLLMProxyOptions,
  ProviderConfig,
  MessageRole,
  ContentPart,
  TextContentPart,
  FunctionCall,
  ToolCall,
  LLMMessage,
  LLMToolFunction,
  LLMTool,
  LLMRequest,
  LLMFinishReason,
  TokenUsage,
  LLMResponse,
  StreamChunk,
  ModelInfo,
  ILLMAdapter,
  ILLMDriver,
  TokenUsageHandler,
} from './types.js';
export type {
  LiteLLMProxyDriverDeps,
  LiteLLMResolvedStartupConfig,
  StartLiteLLMProxyProcessOptions,
} from './litellm-proxy-driver.js';
export type {
  LLMDriverMode,
  LLMDriverSelectionReason,
  ResolveLLMDriverModeOptions,
  ResolvedLLMDriverMode,
} from './driver-selection.js';

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
export { countTokens, estimateTextTokens } from './token-counter.js';
export { estimateCost, findModelPricing, BUILTIN_PRICING } from './model-pricing.js';
export type { ModelPricing } from './model-pricing.js';
export { withRetry, streamWithFallback, responseToStreamChunks } from './retry.js';
export { mapHttpError, extractRetryAfterMs, isContextLimitError } from './error-mapper.js';

// ─── 转换器（供测试和高级用户使用）──────────────────────────────────────────────
export {
  toAnthropicRequest,
  toAnthropicMessages,
  toAnthropicTools,
} from './converters/to-anthropic.js';
export type {
  AnthropicMessage,
  AnthropicTool,
  AnthropicRequest,
  AnthropicContentBlock,
} from './converters/to-anthropic.js';

export {
  fromAnthropicResponse,
  AnthropicStreamParser,
} from './converters/from-anthropic.js';
export type { AnthropicSSEEvent } from './converters/from-anthropic.js';

export {
  fromOpenAIResponse,
  OpenAIStreamParser,
} from './converters/from-openai.js';
export type { OpenAIStreamChunk } from './converters/from-openai.js';
