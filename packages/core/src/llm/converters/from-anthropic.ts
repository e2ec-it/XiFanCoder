/**
 * Anthropic Messages API 格式 → OpenAI Function Calling 格式转换
 *
 * 包含：
 * - fromAnthropicResponse()：非流式响应转换
 * - AnthropicStreamParser：有状态流式解析器
 *
 * 对应 llm-driver-design.md §6.4
 */

import type {
  LLMMessage,
  LLMResponse,
  LLMFinishReason,
  StreamChunk,
  TokenUsage,
  ToolCall,
} from "../types.js";

// ─── Anthropic 响应类型（局部定义，避免依赖 SDK 内部类型）──────────────────────

interface AnthropicContentBlockText {
  readonly type: "text";
  readonly text: string;
}

interface AnthropicContentBlockToolUse {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

type AnthropicContentBlock =
  | AnthropicContentBlockText
  | AnthropicContentBlockToolUse;

interface AnthropicStopReason {
  readonly stop_reason:
    | "end_turn"
    | "tool_use"
    | "max_tokens"
    | "stop_sequence"
    | null;
}

interface AnthropicUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
}

// ─── 非流式响应转换 ───────────────────────────────────────────────────────────

/**
 * 将 Anthropic API 响应对象转换为统一 LLMResponse
 */
export function fromAnthropicResponse(
  raw: {
    readonly content: readonly AnthropicContentBlock[];
    readonly stop_reason: AnthropicStopReason["stop_reason"];
    readonly usage: AnthropicUsage;
    readonly id?: string;
  },
  latencyMs: number,
): LLMResponse {
  const textBlocks = raw.content.filter(
    (b): b is AnthropicContentBlockText => b.type === "text",
  );
  const toolBlocks = raw.content.filter(
    (b): b is AnthropicContentBlockToolUse => b.type === "tool_use",
  );

  const text = textBlocks.map((b) => b.text).join("");
  const tool_calls: ToolCall[] | undefined =
    toolBlocks.length > 0
      ? toolBlocks.map((b) => ({
          id: b.id,
          type: "function" as const,
          function: {
            name: b.name,
            arguments: JSON.stringify(b.input),
          },
        }))
      : undefined;

  const message: LLMMessage = {
    role: "assistant",
    content: text || null,
    ...(tool_calls ? { tool_calls } : {}),
  };

  return {
    message,
    finishReason: mapStopReason(raw.stop_reason),
    usage: mapUsage(raw.usage),
    latencyMs,
    requestId: raw.id,
  };
}

// ─── AnthropicStreamParser（有状态流式解析器）────────────────────────────────

/**
 * 解析 Anthropic SSE 事件流，将其转换为内部 StreamChunk 序列
 *
 * 状态机：
 * - content_block_start(tool_use) → 记录 toolCallId/name
 * - content_block_delta(input_json_delta) → 累积 arguments
 * - content_block_delta(text_delta) → 直接 yield text_delta
 * - message_delta(stop_reason + usage) → yield message_stop
 */
export class AnthropicStreamParser {
  // 当前正在处理的 tool_use block
  private currentToolCallId: string | null = null;
  private currentToolName: string | null = null;

  // 流结束后的 usage（从 message_delta 事件获取）
  private finalUsage: TokenUsage | null = null;

  /**
   * 处理单个 Anthropic SSE 事件，返回零或多个 StreamChunk
   */
  processEvent(event: AnthropicSSEEvent): readonly StreamChunk[] {
    switch (event.type) {
      case "content_block_start":
        return this.handleContentBlockStart(event);

      case "content_block_delta":
        return this.handleContentBlockDelta(event);

      case "content_block_stop":
        return this.handleContentBlockStop();

      case "message_delta":
        return this.handleMessageDelta(event);

      case "message_stop":
        return this.handleMessageStop();

      default:
        return [];
    }
  }

  private handleContentBlockStart(
    event: AnthropicSSEEvent,
  ): readonly StreamChunk[] {
    const block = event.content_block;
    if (!block) return [];

    if (block.type === "tool_use") {
      this.currentToolCallId = block.id ?? null;
      this.currentToolName = block.name ?? null;

      // 立即 yield tool_use_delta（携带 name，无 argumentsDelta）
      if (this.currentToolCallId) {
        return [
          {
            type: "tool_use_delta",
            toolCallId: this.currentToolCallId,
            name: this.currentToolName ?? undefined,
          },
        ];
      }
    }

    return [];
  }

  private handleContentBlockDelta(
    event: AnthropicSSEEvent,
  ): readonly StreamChunk[] {
    const delta = event.delta;
    if (!delta) return [];

    if (delta.type === "text_delta" && delta.text) {
      return [{ type: "text_delta", delta: delta.text }];
    }

    if (delta.type === "input_json_delta" && delta.partial_json != null) {
      if (this.currentToolCallId) {
        return [
          {
            type: "tool_use_delta",
            toolCallId: this.currentToolCallId,
            argumentsDelta: delta.partial_json,
          },
        ];
      }
    }

    return [];
  }

  private handleContentBlockStop(): readonly StreamChunk[] {
    // 重置当前 tool_use 状态
    this.currentToolCallId = null;
    this.currentToolName = null;
    return [];
  }

  private handleMessageDelta(event: AnthropicSSEEvent): readonly StreamChunk[] {
    // 保存 usage 和 stop_reason，等待 message_stop 时 yield
    if (event.usage) {
      this.finalUsage = mapUsage(event.usage);
    }
    return [];
  }

  private handleMessageStop(): readonly StreamChunk[] {
    const usage = this.finalUsage ?? {
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    return [
      {
        type: "message_stop",
        finishReason: "stop",
        usage,
      },
    ];
  }
}

// ─── Anthropic SSE 事件类型 ───────────────────────────────────────────────────

export interface AnthropicSSEEvent {
  readonly type: string;
  readonly content_block?: {
    readonly type: string;
    readonly id?: string;
    readonly name?: string;
  };
  readonly delta?: {
    readonly type: string;
    readonly text?: string;
    readonly partial_json?: string;
    readonly stop_reason?: string;
  };
  readonly usage?: AnthropicUsage & {
    readonly output_tokens?: number;
  };
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function mapStopReason(
  reason: AnthropicStopReason["stop_reason"],
): LLMFinishReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    default:
      return "stop";
  }
}

function mapUsage(
  usage: AnthropicUsage & { output_tokens?: number },
): TokenUsage {
  return {
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}
