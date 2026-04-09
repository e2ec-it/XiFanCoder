/**
 * 内置 TypeScript LLM Driver
 *
 * 将所有操作委托给对应的 Adapter，并叠加：
 * - withRetry()：自动重试（指数退避）
 * - streamWithFallback()：流式降级
 * - TokenUsageHandler 回调：用量上报
 *
 * 对应 llm-driver-design.md §8
 */

import type {
  ILLMDriver,
  ILLMAdapter,
  LLMRequest,
  LLMResponse,
  StreamChunk,
  LLMMessage,
  LLMTool,
  ModelInfo,
  ProviderConfig,
  ProviderType,
  TokenUsageHandler,
} from "./types.js";
import { withRetry, streamWithFallback } from "./retry.js";

export class BuiltinTSDriver implements ILLMDriver {
  readonly driverName = "builtin-ts";
  readonly providerType: ProviderType;

  private readonly adapter: ILLMAdapter;
  private readonly onUsage?: TokenUsageHandler;

  constructor(
    adapter: ILLMAdapter,
    config: ProviderConfig,
    onUsage?: TokenUsageHandler,
  ) {
    this.adapter = adapter;
    this.providerType = config.type;
    this.onUsage = onUsage;
  }

  // ─── chat ─────────────────────────────────────────────────────────────────

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const response = await withRetry(() => this.adapter.chat(request));

    // 上报 token 用量
    this.onUsage?.(response.usage, request.model, response.requestId);

    return response;
  }

  // ─── stream ───────────────────────────────────────────────────────────────

  async *stream(request: LLMRequest): AsyncGenerator<StreamChunk> {
    yield* streamWithFallback(
      request,
      (req) => this.adapter.stream(req),
      (req) => this.adapter.chat(req),
    );
  }

  // ─── countTokens ──────────────────────────────────────────────────────────

  countTokens(
    messages: readonly LLMMessage[],
    tools?: readonly LLMTool[],
  ): number {
    return this.adapter.countTokens(messages, tools);
  }

  // ─── getModels ────────────────────────────────────────────────────────────

  async getModels(): Promise<readonly ModelInfo[]> {
    return this.adapter.getModels();
  }
}
