import type { LLMMessage, LLMTool } from './types.js';

/**
 * 本地 token 数量估算（不发 API 请求）
 *
 * 策略：字符数 / 4（cl100k_base 平均每 token ~4 字符）
 * 精度：±20%，仅供参考（精确计数需调用 API 的 countTokens 端点）
 */

const CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD = 4;  // OpenAI 规范：每条消息 4 token 固定开销

/**
 * 估算文本内容的 token 数
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * 估算单条消息的 token 数
 */
function estimateMessageTokens(message: LLMMessage): number {
  let count = MESSAGE_OVERHEAD;

  // 角色名
  count += estimateTextTokens(message.role);

  // 消息内容
  if (typeof message.content === 'string') {
    count += estimateTextTokens(message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text') count += estimateTextTokens(part.text);
    }
  }

  // 工具调用
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      count += estimateTextTokens(tc.function.name);
      count += estimateTextTokens(tc.function.arguments);
    }
  }

  // tool role 的 tool_call_id
  if (message.tool_call_id) count += estimateTextTokens(message.tool_call_id);

  return count;
}

/**
 * 估算工具定义的 token 数
 */
function estimateToolTokens(tool: LLMTool): number {
  const fn = tool.function;
  const schemaStr = JSON.stringify(fn.parameters);
  return (
    estimateTextTokens(fn.name) +
    estimateTextTokens(fn.description) +
    estimateTextTokens(schemaStr)
  );
}

/**
 * 估算整个请求的 token 数（消息 + 工具定义）
 */
export function countTokens(
  messages: readonly LLMMessage[],
  tools?: readonly LLMTool[],
): number {
  let total = 0;

  for (const message of messages) {
    total += estimateMessageTokens(message);
  }

  if (tools) {
    for (const tool of tools) {
      total += estimateToolTokens(tool);
    }
    // 工具列表固定开销
    total += 12;
  }

  return total;
}
