/**
 * OpenAI Chat Completions API 响应 → 内部统一格式转换
 *
 * 包含：
 * - fromOpenAIResponse()：非流式响应转换
 * - OpenAIStreamParser：有状态流式解析器（按 index 累积 tool_calls）
 *
 * 对应 llm-driver-design.md §6.5
 */

import type {
  LLMMessage,
  LLMResponse,
  LLMFinishReason,
  StreamChunk,
  TokenUsage,
  ToolCall,
} from '../types.js';

// ─── OpenAI API 响应类型（局部定义）──────────────────────────────────────────

interface OpenAIMessage {
  readonly role: string;
  readonly content: string | null;
  readonly tool_calls?: readonly OpenAIToolCall[];
}

interface OpenAIToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

interface OpenAIUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly prompt_tokens_details?: {
    readonly cached_tokens?: number;
  };
}

// ─── 非流式响应转换 ───────────────────────────────────────────────────────────

/**
 * 将 OpenAI Chat Completion 响应转换为统一 LLMResponse
 */
export function fromOpenAIResponse(
  raw: {
    readonly choices: ReadonlyArray<{
      readonly message: OpenAIMessage;
      readonly finish_reason: string | null;
    }>;
    readonly usage?: OpenAIUsage;
    readonly id?: string;
  },
  latencyMs: number,
): LLMResponse {
  const choice = raw.choices[0];
  if (!choice) {
    throw new Error('OpenAI response has no choices');
  }

  const rawMsg = choice.message;
  const tool_calls: ToolCall[] | undefined =
    rawMsg.tool_calls && rawMsg.tool_calls.length > 0
      ? rawMsg.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }))
      : undefined;

  const message: LLMMessage = {
    role: 'assistant',
    content: rawMsg.content,
    ...(tool_calls ? { tool_calls } : {}),
  };

  return {
    message,
    finishReason: mapFinishReason(choice.finish_reason),
    usage: mapUsage(raw.usage),
    latencyMs,
    requestId: raw.id,
  };
}

// ─── OpenAIStreamParser（有状态流式解析器）───────────────────────────────────

/**
 * 解析 OpenAI SSE 流式响应，转换为内部 StreamChunk 序列
 *
 * 按 delta.tool_calls[].index 累积工具调用参数（delta 模式）
 */
export class OpenAIStreamParser {
  // 按 index 索引的 tool_call 累积状态
  private toolCalls: Map<number, {
    id: string;
    name: string;
    arguments: string;
  }> = new Map();

  // 是否已 yield 了对应 tool_call 的 header chunk
  private toolCallStarted: Set<number> = new Set();

  private finalUsage: TokenUsage | null = null;
  private finalFinishReason: LLMFinishReason = 'stop';

  /**
   * 处理单个 OpenAI SSE chunk，返回零或多个 StreamChunk
   */
  processChunk(chunk: OpenAIStreamChunk): readonly StreamChunk[] {
    const choice = chunk.choices?.[0];

    // 最后一条 chunk 可能只有 usage（stream_options: {include_usage: true}）
    if (chunk.usage) {
      this.finalUsage = mapUsage(chunk.usage);
    }

    if (!choice) return [];

    const delta = choice.delta;
    const result: StreamChunk[] = [];

    // finish_reason
    if (choice.finish_reason) {
      this.finalFinishReason = mapFinishReason(choice.finish_reason);
    }

    // 文本内容
    if (delta?.content) {
      result.push({ type: 'text_delta', delta: delta.content });
    }

    // 工具调用 delta
    if (delta?.tool_calls) {
      for (const tcDelta of delta.tool_calls) {
        const idx = tcDelta.index ?? 0;

        if (!this.toolCalls.has(idx)) {
          // 第一次见到这个 index：初始化
          this.toolCalls.set(idx, {
            id: tcDelta.id ?? '',
            name: tcDelta.function?.name ?? '',
            arguments: '',
          });
        }

        const tc = this.toolCalls.get(idx)!;

        // 累积 id 和 name（首次 delta 才有）
        if (tcDelta.id) (tc as { id: string }).id = tcDelta.id;
        if (tcDelta.function?.name) (tc as { name: string }).name = tcDelta.function.name;

        // yield header chunk（仅第一次）
        if (!this.toolCallStarted.has(idx) && tc.id) {
          this.toolCallStarted.add(idx);
          result.push({
            type: 'tool_use_delta',
            toolCallId: tc.id,
            name: tc.name || undefined,
          });
        }

        // 累积 arguments delta
        if (tcDelta.function?.arguments) {
          tc.arguments += tcDelta.function.arguments;
          if (tc.id) {
            result.push({
              type: 'tool_use_delta',
              toolCallId: tc.id,
              argumentsDelta: tcDelta.function.arguments,
            });
          }
        }
      }
    }

    return result;
  }

  /**
   * 在流结束时调用，返回 message_stop chunk
   */
  finish(): StreamChunk {
    const usage = this.finalUsage ?? {
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    return {
      type: 'message_stop',
      finishReason: this.finalFinishReason,
      usage,
    };
  }
}

// ─── OpenAI SSE chunk 类型 ────────────────────────────────────────────────────

export interface OpenAIStreamChunk {
  readonly choices?: ReadonlyArray<{
    readonly delta?: {
      readonly content?: string;
      readonly tool_calls?: ReadonlyArray<{
        readonly index?: number;
        readonly id?: string;
        readonly function?: {
          readonly name?: string;
          readonly arguments?: string;
        };
      }>;
    };
    readonly finish_reason?: string | null;
  }>;
  readonly usage?: OpenAIUsage;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function mapFinishReason(reason: string | null | undefined): LLMFinishReason {
  switch (reason) {
    case 'stop': return 'stop';
    case 'tool_calls': return 'tool_use';
    case 'length': return 'max_tokens';
    default: return 'stop';
  }
}

function mapUsage(usage: OpenAIUsage | undefined): TokenUsage {
  if (!usage) {
    return { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  }
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: 0,
  };
}
