/**
 * OpenAI SDK 适配器（兼容 Ollama / LiteLLM Proxy）
 *
 * 封装 openai npm 包，实现 ILLMAdapter 接口。
 * Ollama 和 LiteLLM Proxy 通过设置 baseURL 复用此适配器。
 *
 * 对应 llm-driver-design.md §7.2
 */

import OpenAI from "openai";
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
import {
  fromOpenAIResponse,
  OpenAIStreamParser,
} from "../converters/from-openai.js";

export type OpenAIAdapterVariant = "openai" | "ollama" | "litellm-proxy";

export class OpenAIAdapter implements ILLMAdapter {
  private readonly client: OpenAI;
  private readonly variant: OpenAIAdapterVariant;

  constructor(
    apiKey: string,
    variant: OpenAIAdapterVariant = "openai",
    baseUrl?: string,
  ) {
    this.variant = variant;

    // Ollama 不需要真实 API Key
    const resolvedKey = variant === "ollama" ? apiKey || "ollama" : apiKey;

    this.client = new OpenAI({
      apiKey: resolvedKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
  }

  // ─── chat ─────────────────────────────────────────────────────────────────

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const startMs = Date.now();
    const body = this.buildRequestBody(request, false);

    let raw: OpenAI.Chat.Completions.ChatCompletion;
    try {
      raw = await this.client.chat.completions.create(
        body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      );
    } catch (err) {
      throw this.mapError(err, request);
    }

    return fromOpenAIResponse(
      raw as Parameters<typeof fromOpenAIResponse>[0],
      Date.now() - startMs,
    );
  }

  // ─── stream ───────────────────────────────────────────────────────────────

  async *stream(request: LLMRequest): AsyncGenerator<StreamChunk> {
    const body = this.buildRequestBody(request, true);
    const parser = new OpenAIStreamParser();

    let streamObj: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      streamObj = await this.client.chat.completions.create(
        body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
      );
    } catch (err) {
      throw new LLMStreamError(
        err instanceof Error ? err.message : String(err),
        err,
      );
    }

    try {
      for await (const chunk of streamObj) {
        const chunks = parser.processChunk(
          chunk as Parameters<typeof parser.processChunk>[0],
        );
        for (const c of chunks) {
          yield c;
        }
      }
    } catch (err) {
      throw new LLMStreamError(
        err instanceof Error ? err.message : String(err),
        err,
      );
    }

    yield parser.finish();
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
    if (this.variant === "ollama" || this.variant === "litellm-proxy") {
      try {
        const list = await this.client.models.list();
        return list.data.map((m) => ({
          id: m.id,
          provider: this.variant,
          contextWindow: 128_000,
          maxOutputTokens: 8_192,
          supportsFunctionCalling: true,
          supportsStreaming: true,
        }));
      } catch {
        return [];
      }
    }

    // OpenAI 静态常用模型列表（避免每次调用 API）
    return OPENAI_MODELS;
  }

  // ─── 请求体构建 ────────────────────────────────────────────────────────────

  private buildRequestBody(
    request: LLMRequest,
    stream: boolean,
  ): Record<string, unknown> {
    const messages = buildOpenAIMessages(request);

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      ...(stream
        ? {
            stream: true,
            stream_options: { include_usage: true },
          }
        : {}),
    };

    if (request.tools && request.tools.length > 0) {
      body["tools"] = request.tools;
      body["tool_choice"] = request.tool_choice ?? "auto";
    }

    if (request.maxTokens !== undefined) body["max_tokens"] = request.maxTokens;
    if (request.temperature !== undefined)
      body["temperature"] = request.temperature;

    return body;
  }

  // ─── 错误映射 ──────────────────────────────────────────────────────────────

  private mapError(err: unknown, request: LLMRequest): Error {
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

// ─── OpenAI 消息格式转换 ───────────────────────────────────────────────────────

function buildOpenAIMessages(request: LLMRequest): unknown[] {
  const messages: unknown[] = [];

  // 将 systemPrompt 便捷字段转为第一条 system 消息
  if (request.systemPrompt) {
    messages.push({ role: "system", content: request.systemPrompt });
  }

  for (const msg of request.messages) {
    if (msg.role === "system" && request.systemPrompt) {
      // 如果已有 systemPrompt，跳过消息列表中的 system（避免重复）
      continue;
    }
    messages.push(msg);
  }

  return messages;
}

// ─── 静态模型列表 ──────────────────────────────────────────────────────────────

const OPENAI_MODELS: readonly ModelInfo[] = [
  {
    id: "gpt-4o",
    provider: "openai",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsFunctionCalling: true,
    supportsStreaming: true,
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsFunctionCalling: true,
    supportsStreaming: true,
  },
  {
    id: "o1",
    provider: "openai",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsFunctionCalling: true,
    supportsStreaming: false,
  },
  {
    id: "o3-mini",
    provider: "openai",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsFunctionCalling: true,
    supportsStreaming: true,
  },
];
