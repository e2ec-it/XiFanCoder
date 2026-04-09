import { describe, expect, it } from 'vitest';

import * as pluginOi from '../index.js';

describe('plugin-oi public exports', () => {
  it('re-exports executor and rpc entry points', () => {
    expect(typeof pluginOi.OpenInterpreterExecutor).toBe('function');
    expect(typeof pluginOi.runProcessCommand).toBe('function');
    expect(typeof pluginOi.createOiRpcHandler).toBe('function');
    expect(typeof pluginOi.startOiPluginServer).toBe('function');
  });
});
