/**
 * LLM Driver 工厂函数
 *
 * 根据 ProviderConfig.type 创建对应的 ILLMDriver 实例。
 * ollama 复用 OpenAI 适配器（设置不同 baseURL），
 * litellm-proxy 使用独立 LiteLLMProxyDriver（内置健康检查/可选自启动）。
 *
 * 对应 llm-driver-design.md §8.4
 */

import type { ILLMDriver, ProviderConfig, TokenUsageHandler } from './types.js';
import { AnthropicAdapter } from './adapters/anthropic-adapter.js';
import { OpenAIAdapter } from './adapters/openai-adapter.js';
import { BuiltinTSDriver } from './builtin-ts-driver.js';
import { LiteLLMProxyDriver } from './litellm-proxy-driver.js';

/**
 * 根据配置创建 LLM Driver
 *
 * @param config  Provider 配置
 * @param onUsage 可选的 token 用量回调（用于统计和费用追踪）
 */
export function createDriver(
  config: ProviderConfig,
  onUsage?: TokenUsageHandler,
): ILLMDriver {
  switch (config.type) {
    case 'anthropic': {
      const adapter = new AnthropicAdapter(
        config.apiKey ?? '',
        config.baseUrl,
      );
      return new BuiltinTSDriver(adapter, config, onUsage);
    }

    case 'openai': {
      const adapter = new OpenAIAdapter(
        config.apiKey ?? '',
        'openai',
        config.baseUrl,
      );
      return new BuiltinTSDriver(adapter, config, onUsage);
    }

    case 'ollama': {
      // Ollama 复用 OpenAI 适配器，默认 baseURL = http://localhost:11434/v1
      const baseUrl = config.baseUrl ?? 'http://localhost:11434/v1';
      const adapter = new OpenAIAdapter('ollama', 'ollama', baseUrl);
      return new BuiltinTSDriver(adapter, config, onUsage);
    }

    case 'litellm-proxy': {
      return new LiteLLMProxyDriver(config, onUsage);
    }

    /* v8 ignore next 5 -- TypeScript exhaustive check: unreachable at runtime */
    default: {
      const _exhaustive: never = config.type;
      throw new Error(`Unknown provider type: ${String(_exhaustive)}`);
    }
  }
}
