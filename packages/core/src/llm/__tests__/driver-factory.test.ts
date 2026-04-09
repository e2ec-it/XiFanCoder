import { describe, expect, it } from 'vitest';

import { createDriver } from '../driver-factory.js';
import { BuiltinTSDriver } from '../builtin-ts-driver.js';
import { LiteLLMProxyDriver } from '../litellm-proxy-driver.js';
import type { ProviderConfig } from '../types.js';

describe('createDriver', () => {
  it('creates anthropic driver', () => {
    const config: ProviderConfig = {
      type: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'test-key',
    };
    const driver = createDriver(config);
    expect(driver).toBeInstanceOf(BuiltinTSDriver);
    expect(driver.providerType).toBe('anthropic');
  });

  it('creates openai driver', () => {
    const config: ProviderConfig = {
      type: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
    };
    const driver = createDriver(config);
    expect(driver).toBeInstanceOf(BuiltinTSDriver);
    expect(driver.providerType).toBe('openai');
  });

  it('creates ollama driver with default baseUrl', () => {
    const config: ProviderConfig = {
      type: 'ollama',
      model: 'llama3',
    };
    const driver = createDriver(config);
    expect(driver).toBeInstanceOf(BuiltinTSDriver);
    expect(driver.providerType).toBe('ollama');
  });

  it('creates ollama driver with custom baseUrl', () => {
    const config: ProviderConfig = {
      type: 'ollama',
      model: 'llama3',
      baseUrl: 'http://custom:1234/v1',
    };
    const driver = createDriver(config);
    expect(driver).toBeInstanceOf(BuiltinTSDriver);
  });

  it('creates litellm-proxy driver', () => {
    const config: ProviderConfig = {
      type: 'litellm-proxy',
      model: 'gpt-4o',
    };
    const driver = createDriver(config);
    expect(driver).toBeInstanceOf(LiteLLMProxyDriver);
  });

  it('passes onUsage callback to anthropic driver', () => {
    const onUsage = () => {};
    const config: ProviderConfig = { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'k' };
    const driver = createDriver(config, onUsage);
    expect(driver).toBeInstanceOf(BuiltinTSDriver);
  });
});
