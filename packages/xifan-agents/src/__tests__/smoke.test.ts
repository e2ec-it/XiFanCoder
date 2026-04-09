import { describe, it, expect } from 'vitest';

describe('xifan-agents package', () => {
  it('exports plugin entry point', async () => {
    const mod = await import('../plugin/router.js');
    expect(mod.routeTool).toBeDefined();
  });
});
