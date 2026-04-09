/**
 * 内置模型价格表（L1 层本地估算用，不依赖外部定价 API）
 *
 * 价格单位：美元/每百万 tokens
 * 最后更新：2026-02-19（基于各厂商官方定价页面）
 * 注意：仅供估算，不作为计费依据。L2（LiteLLM）会覆盖为精确值。
 */

export interface ModelPricing {
  readonly modelId: string;
  readonly inputPerMToken: number;
  readonly outputPerMToken: number;
  readonly cacheReadPerMToken?: number;   // Prompt Cache 命中（比输入便宜）
  readonly cacheWritePerMToken?: number;  // Prompt Cache 写入（比输入贵）
}

export const BUILTIN_PRICING: readonly ModelPricing[] = [
  // Anthropic Claude 4 系列
  { modelId: 'claude-opus-4-6', inputPerMToken: 15.00, outputPerMToken: 75.00, cacheReadPerMToken: 1.50, cacheWritePerMToken: 18.75 },
  { modelId: 'claude-sonnet-4-6', inputPerMToken: 3.00, outputPerMToken: 15.00, cacheReadPerMToken: 0.30, cacheWritePerMToken: 3.75 },
  { modelId: 'claude-haiku-4-5', inputPerMToken: 0.80, outputPerMToken: 4.00, cacheReadPerMToken: 0.08, cacheWritePerMToken: 1.00 },

  // Anthropic Claude 3.5 系列（兼容）
  { modelId: 'claude-3-5-sonnet-20241022', inputPerMToken: 3.00, outputPerMToken: 15.00, cacheReadPerMToken: 0.30, cacheWritePerMToken: 3.75 },
  { modelId: 'claude-3-5-haiku-20241022', inputPerMToken: 0.80, outputPerMToken: 4.00, cacheReadPerMToken: 0.08, cacheWritePerMToken: 1.00 },
  { modelId: 'claude-3-opus-20240229', inputPerMToken: 15.00, outputPerMToken: 75.00, cacheReadPerMToken: 1.50, cacheWritePerMToken: 18.75 },

  // OpenAI GPT-4o 系列
  { modelId: 'gpt-4o', inputPerMToken: 2.50, outputPerMToken: 10.00, cacheReadPerMToken: 1.25 },
  { modelId: 'gpt-4o-mini', inputPerMToken: 0.15, outputPerMToken: 0.60, cacheReadPerMToken: 0.075 },

  // OpenAI o1/o3 推理系列
  { modelId: 'o1', inputPerMToken: 15.00, outputPerMToken: 60.00, cacheReadPerMToken: 7.50 },
  { modelId: 'o3-mini', inputPerMToken: 1.10, outputPerMToken: 4.40, cacheReadPerMToken: 0.55 },

  // Gemini 系列
  { modelId: 'gemini-2.0-flash', inputPerMToken: 0.10, outputPerMToken: 0.40 },
  { modelId: 'gemini-1.5-pro', inputPerMToken: 1.25, outputPerMToken: 5.00 },
] as const;

/**
 * 查找模型价格条目（精确匹配优先，其次前缀匹配）
 *
 * 前缀匹配用于处理带日期后缀的模型 ID，如
 * "claude-sonnet-4-6-20251201" → 匹配 "claude-sonnet-4-6"
 */
export function findModelPricing(modelId: string): ModelPricing | undefined {
  const exact = BUILTIN_PRICING.find((p) => p.modelId === modelId);
  if (exact) return exact;
  return BUILTIN_PRICING.find((p) => modelId.startsWith(p.modelId));
}

/**
 * 根据 token 用量和价格表估算费用（单位：美元）
 * 未知模型返回 0。
 */
export function estimateCost(
  modelId: string,
  usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
  },
): number {
  const pricing = findModelPricing(modelId);
  if (!pricing) return 0;

  const inputCost = (usage.promptTokens / 1_000_000) * pricing.inputPerMToken;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPerMToken;
  const cacheReadCost =
    pricing.cacheReadPerMToken != null
      ? (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMToken
      : 0;
  const cacheWriteCost =
    pricing.cacheWritePerMToken != null
      ? (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMToken
      : 0;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}
