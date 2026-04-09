/**
 * Anthropic SDK 适配器
 *
 * 封装 @anthropic-ai/sdk，实现 ILLMAdapter 接口。
 * 处理：非流式请求、流式请求、token 计数、模型列表。
 *
 * 对应 llm-driver-design.md §7.1
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages.js";
import type {
  LLMRequest,
  LLMResponse,
  StreamChunk,
  LLMMessage,
  LLMTool,
  ModelInfo,
  ILLMAdapter,
} from "../types.js";
import { LLMStreamError, LLMNetworkError } from "../../errors/index.js";
import { mapHttpError } from "../error-mapper.js";
import { countTokens } from "../token-counter.js";
import { toAnthropicRequest } from "../converters/to-anthropic.js";
import {
  fromAnthropicResponse,
  AnthropicStreamParser,
} from "../converters/from-anthropic.js";

export class AnthropicAdapter implements ILLMAdapter {
  private readonly client: Anthropic;

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new Anthropic({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
  }

  // ─── chat ─────────────────────────────────────────────────────────────────

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const startMs = Date.now();
    const body = toAnthropicRequest(request, false);

    let raw: Message;
    try {
      raw = await this.client.messages.create({
        ...(body as Anthropic.MessageCreateParamsNonStreaming),
        stream: false,
      });
    } catch (err) {
      throw this.mapError(err, request);
    }

    return fromAnthropicResponse(
      {
        content: raw.content as Parameters<
          typeof fromAnthropicResponse
        >[0]["content"],
        stop_reason: raw.stop_reason,
        usage: raw.usage,
        id: raw.id,
      },
      Date.now() - startMs,
    );
  }

  // ─── stream ───────────────────────────────────────────────────────────────

  async *stream(request: LLMRequest): AsyncGenerator<StreamChunk> {
    const body = toAnthropicRequest(request, true);
    const parser = new AnthropicStreamParser();

    let stream: Awaited<ReturnType<typeof this.client.messages.stream>>;
    try {
      stream = this.client.messages.stream(
        body as Parameters<typeof this.client.messages.stream>[0],
      );
    } catch (err) {
      throw new LLMStreamError(
        err instanceof Error ? err.message : String(err),
        err,
      );
    }

    try {
      for await (const event of stream) {
        const chunks = parser.processEvent(
          event as Parameters<typeof parser.processEvent>[0],
        );
        for (const chunk of chunks) {
          yield chunk;
        }
      }
    } catch (err) {
      throw new LLMStreamError(
        err instanceof Error ? err.message : String(err),
        err,
      );
    }
  }

  // ─── countTokens ──────────────────────────────────────────────────────────

  countTokens(
    messages: readonly LLMMessage[],
    tools?: readonly LLMTool[],
  ): number {
    return countTokens(messages, tools);
  }

  // ─── getModels ────────────────────────────────────────────────────────────

  async getModels(): Promise<readonly ModelInfo[]> {
    // Anthropic SDK 没有公开 /models 端点，返回静态列表
    return ANTHROPIC_MODELS;
  }

  // ─── 错误映射 ──────────────────────────────────────────────────────────────

  private mapError(err: unknown, request: LLMRequest): Error {
    // Anthropic SDK 抛出的 APIError 带有 status 字段
    if (typeof err === "object" && err !== null) {
      const e = err as Record<string, unknown>;
      if (typeof e["status"] === "number") {
        return mapHttpError(
          e["status"],
          e["error"] ?? e["message"],
          request.model,
        );
      }
    }
    return new LLMNetworkError(
      request.model,
      err instanceof Error ? err.message : String(err),
      err,
    );
  }
}

// ─── 静态模型列表 ──────────────────────────────────────────────────────────────

const ANTHROPIC_MODELS: readonly ModelInfo[] = [
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    supportsFunctionCalling: true,
    supportsStreaming: true,
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsFunctionCalling: true,
    supportsStreaming: true,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsFunctionCalling: true,
    supportsStreaming: true,
  },
  {
    id: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsFunctionCalling: true,
    supportsStreaming: true,
  },
  {
    id: "claude-3-5-haiku-20241022",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsFunctionCalling: true,
    supportsStreaming: true,
  },
];
