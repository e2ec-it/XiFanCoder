import { describe, expect, it } from 'vitest';

import * as pluginAider from '../index.js';

describe('plugin-aider public exports', () => {
  it('re-exports runtime entry points', () => {
    expect(typeof pluginAider.AiderExecutor).toBe('function');
    expect(typeof pluginAider.runProcessCommand).toBe('function');
    expect(typeof pluginAider.createAiderRpcHandler).toBe('function');
    expect(typeof pluginAider.startAiderPluginServer).toBe('function');
  });
});
