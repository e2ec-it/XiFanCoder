/**
 * LLM 模块内部类型定义
 *
 * 定义 ILLMDriver 接口及模块内补充类型。
 * 核心数据类型（LLMRequest、LLMResponse 等）在此定义，
 * 后续 core/src/types/ 完成后可重导出。
 */

// ─── Provider 配置 ─────────────────────────────────────────────────────────

export type ProviderType = 'anthropic' | 'openai' | 'ollama' | 'litellm-proxy';

export interface LiteLLMProxyOptions {
  readonly proxyUrl?: string;
  readonly autoStart?: boolean;
  readonly healthcheckTimeoutMs?: number;
  readonly startupGraceMs?: number;
  readonly startCommand?: string;
  readonly startArgs?: readonly string[];
}

export interface ProviderConfig {
  readonly type: ProviderType;
  readonly model: string;
  readonly baseUrl?: string;    // ollama 常用，litellm-proxy 可被 litellm.proxyUrl 覆盖
  readonly apiKey?: string;     // 运行时由 RuntimeSecrets 注入，非必填
  readonly timeoutMs?: number;  // 默认 60_000
  readonly maxRetries?: number; // 默认 3
  readonly litellm?: LiteLLMProxyOptions;
}

// ─── 消息格式（OpenAI Function Calling，ADR-005）──────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextContentPart {
  readonly type: 'text';
  readonly text: string;
}

export type ContentPart = TextContentPart;

export interface FunctionCall {
  readonly name: string;
  readonly arguments: string;  // JSON 字符串
}

export interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: FunctionCall;
}

export interface LLMMessage {
  readonly role: MessageRole;
  readonly content: string | readonly ContentPart[] | null;
  readonly tool_calls?: readonly ToolCall[];
  readonly tool_call_id?: string;   // tool role 时使用
  readonly name?: string;           // tool role 时工具名称
}

// ─── 工具定义 ──────────────────────────────────────────────────────────────

export interface LLMToolFunction {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;  // JSON Schema
}

export interface LLMTool {
  readonly type: 'function';
  readonly function: LLMToolFunction;
}

// ─── 请求与响应 ────────────────────────────────────────────────────────────

export interface LLMRequest {
  readonly model: string;
  readonly messages: readonly LLMMessage[];
  readonly tools?: readonly LLMTool[];
  readonly tool_choice?: 'auto' | 'none' | 'required';
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly systemPrompt?: string;  // 便捷字段，自动插入 system 消息
}

export type LLMFinishReason = 'stop' | 'tool_use' | 'max_tokens' | 'error';

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface LLMResponse {
  readonly message: LLMMessage;
  readonly finishReason: LLMFinishReason;
  readonly usage: TokenUsage;
  readonly latencyMs: number;
  readonly requestId?: string;
}

// ─── 流式响应 ──────────────────────────────────────────────────────────────

export type StreamChunk =
  | { readonly type: 'text_delta'; readonly delta: string }
  | {
      readonly type: 'tool_use_delta';
      readonly toolCallId: string;
      readonly name?: string;
      readonly argumentsDelta?: string;
    }
  | {
      readonly type: 'message_stop';
      readonly finishReason: LLMFinishReason;
      readonly usage: TokenUsage;
    };

// ─── 模型信息 ──────────────────────────────────────────────────────────────

export interface ModelInfo {
  readonly id: string;
  readonly provider: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly supportsFunctionCalling: boolean;
  readonly supportsStreaming: boolean;
}

// ─── 适配器接口（内部使用）────────────────────────────────────────────────

export interface ILLMAdapter {
  chat(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncGenerator<StreamChunk>;
  countTokens(messages: readonly LLMMessage[], tools?: readonly LLMTool[]): number;
  getModels(): Promise<readonly ModelInfo[]>;
}

// ─── Driver 接口（对外公开）───────────────────────────────────────────────

export interface ILLMDriver {
  chat(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncGenerator<StreamChunk>;
  countTokens(messages: readonly LLMMessage[], tools?: readonly LLMTool[]): number;
  getModels(): Promise<readonly ModelInfo[]>;
  readonly driverName: string;
  readonly providerType: ProviderType;
}

// ─── Token 使用回调 ────────────────────────────────────────────────────────

export type TokenUsageHandler = (usage: TokenUsage, model: string, requestId?: string) => void;
