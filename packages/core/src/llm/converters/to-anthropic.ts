/**
 * OpenAI Function Calling 格式 → Anthropic Messages API 格式转换
 *
 * 核心难点：Anthropic 不支持独立的 tool role 消息，
 * 所有工具结果必须合并到 user 消息的 content 数组中。
 *
 * 对应 llm-driver-design.md §6.3
 */

import type {
  LLMMessage,
  LLMTool,
  LLMRequest,
} from '../types.js';

// ─── Anthropic API 类型 ──────────────────────────────────────────────────────

export interface AnthropicTextBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface AnthropicToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string | readonly AnthropicContentBlock[];
}

export interface AnthropicTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

export interface AnthropicRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly messages: readonly AnthropicMessage[];
  readonly tools?: readonly AnthropicTool[];
  readonly tool_choice?: { readonly type: 'auto' | 'any' | 'none' };
  readonly system?: string;
  readonly temperature?: number;
  readonly stream?: boolean;
}

// ─── 转换入口 ────────────────────────────────────────────────────────────────

/**
 * 将 LLMRequest 转换为 Anthropic API 请求体
 */
export function toAnthropicRequest(
  request: LLMRequest,
  stream = false,
): AnthropicRequest {
  const messages = toAnthropicMessages(request.messages);
  const tools = request.tools ? toAnthropicTools(request.tools) : undefined;
  const tool_choice = toAnthropicToolChoice(request.tool_choice, tools);

  return {
    model: request.model,
    max_tokens: request.maxTokens ?? 8192,
    messages,
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {}),
    ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(stream ? { stream: true } : {}),
  };
}

// ─── 消息转换 ────────────────────────────────────────────────────────────────

/**
 * 将 OpenAI 消息数组转换为 Anthropic 消息数组
 *
 * 关键规则：
 * 1. system 消息提取到顶层 system 字段（调用方处理）
 * 2. 连续多个 tool role 消息合并为一条 user 消息的 content 数组
 * 3. assistant 消息的 tool_calls 转换为 tool_use content block
 */
export function toAnthropicMessages(
  messages: readonly LLMMessage[],
): readonly AnthropicMessage[] {
  const result: AnthropicMessage[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i]!;

    if (msg.role === 'system') {
      // system 消息跳过（由 toAnthropicRequest 处理）
      i++;
      continue;
    }

    if (msg.role === 'tool') {
      // 收集连续的 tool 消息，合并为一条 user 消息
      const toolBlocks: AnthropicToolResultBlock[] = [];
      while (i < messages.length && messages[i]!.role === 'tool') {
        toolBlocks.push(toToolResultBlock(messages[i]!));
        i++;
      }
      result.push({ role: 'user', content: toolBlocks });
      continue;
    }

    if (msg.role === 'assistant') {
      result.push(toAssistantMessage(msg));
      i++;
      continue;
    }

    // user 消息
    result.push(toUserMessage(msg));
    i++;
  }

  return result;
}

// ─── 单条消息转换 ─────────────────────────────────────────────────────────────

function toUserMessage(msg: LLMMessage): AnthropicMessage {
  if (typeof msg.content === 'string') {
    return { role: 'user', content: msg.content };
  }

  if (Array.isArray(msg.content)) {
    const blocks: AnthropicTextBlock[] = msg.content
      .filter((p) => p.type === 'text')
      .map((p) => ({ type: 'text' as const, text: p.text }));
    return { role: 'user', content: blocks };
  }

  return { role: 'user', content: '' };
}

function toAssistantMessage(msg: LLMMessage): AnthropicMessage {
  const blocks: AnthropicContentBlock[] = [];

  // 文本内容
  if (typeof msg.content === 'string' && msg.content) {
    blocks.push({ type: 'text', text: msg.content });
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === 'text' && part.text) {
        blocks.push({ type: 'text', text: part.text });
      }
    }
  }

  // 工具调用 → tool_use blocks
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      const input = safeParseJson(tc.function.arguments);
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  // 如果只有文本且是简单字符串，返回简化格式
  if (blocks.length === 1 && blocks[0]!.type === 'text') {
    return { role: 'assistant', content: (blocks[0] as AnthropicTextBlock).text };
  }

  return { role: 'assistant', content: blocks };
}

function toToolResultBlock(msg: LLMMessage): AnthropicToolResultBlock {
  const content = typeof msg.content === 'string' ? msg.content : '';
  return {
    type: 'tool_result',
    tool_use_id: msg.tool_call_id ?? '',
    content,
  };
}

// ─── 工具定义转换 ─────────────────────────────────────────────────────────────

export function toAnthropicTools(tools: readonly LLMTool[]): readonly AnthropicTool[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

function toAnthropicToolChoice(
  toolChoice: LLMRequest['tool_choice'],
  tools: readonly AnthropicTool[] | undefined,
): AnthropicRequest['tool_choice'] | undefined {
  if (!tools || tools.length === 0) return undefined;

  switch (toolChoice) {
    case 'none': return { type: 'none' };
    case 'required': return { type: 'any' };
    case 'auto':
    default:
      return { type: 'auto' };
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 安全解析 JSON 字符串为对象
 * 失败时返回空对象（避免抛出）
 */
function safeParseJson(jsonStr: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
