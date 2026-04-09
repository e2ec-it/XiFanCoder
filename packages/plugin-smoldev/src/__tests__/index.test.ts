import { describe, expect, it } from 'vitest';

import * as pluginSmoldev from '../index.js';

describe('plugin-smoldev public exports', () => {
  it('re-exports generator and rpc entry points', () => {
    expect(typeof pluginSmoldev.smoldevGenerate).toBe('function');
    expect(typeof pluginSmoldev.createSmoldevRpcHandler).toBe('function');
    expect(typeof pluginSmoldev.startSmoldevPluginServer).toBe('function');
  });
});
