import { describe, expect, it } from 'vitest';

import { estimateCost, findModelPricing } from '../model-pricing.js';

describe('findModelPricing', () => {
  it('returns exact match for known model', () => {
    const pricing = findModelPricing('gpt-4o');
    expect(pricing).toBeDefined();
    expect(pricing?.modelId).toBe('gpt-4o');
  });

  it('returns prefix match for dated model ID', () => {
    const pricing = findModelPricing('claude-sonnet-4-6-20251201');
    expect(pricing).toBeDefined();
    expect(pricing?.modelId).toBe('claude-sonnet-4-6');
  });

  it('returns undefined for unknown model', () => {
    expect(findModelPricing('totally-unknown-model')).toBeUndefined();
  });
});

describe('estimateCost', () => {
  it('returns 0 for unknown model', () => {
    const cost = estimateCost('unknown-model', {
      promptTokens: 1000,
      completionTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(cost).toBe(0);
  });

  it('computes cost for model without cacheWritePerMToken', () => {
    // gpt-4o has cacheReadPerMToken but no cacheWritePerMToken
    const cost = estimateCost('gpt-4o', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    // inputCost = 2.50, outputCost = 10.00, cacheReadCost = 1.25, cacheWriteCost = 0
    expect(cost).toBeCloseTo(13.75);
  });

  it('computes cost for model without any cache pricing', () => {
    // gemini-2.0-flash has no cacheReadPerMToken and no cacheWritePerMToken
    const cost = estimateCost('gemini-2.0-flash', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    // inputCost = 0.10, outputCost = 0.40, cacheReadCost = 0, cacheWriteCost = 0
    expect(cost).toBeCloseTo(0.50);
  });

  it('includes cache write cost when pricing is available', () => {
    // claude-opus-4-6 has both cacheReadPerMToken and cacheWritePerMToken
    const cost = estimateCost('claude-opus-4-6', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    // inputCost = 15.00, outputCost = 75.00, cacheReadCost = 1.50, cacheWriteCost = 18.75
    expect(cost).toBeCloseTo(110.25);
  });
});
