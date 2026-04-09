import { describe, expect, it } from 'vitest';

import { PluginRegistry } from '../registry.js';

describe('PluginRegistry', () => {
  it('throws when updating a plugin that does not exist', () => {
    const registry = new PluginRegistry();
    expect(() => registry.update('nonexistent', { status: 'ready' })).toThrowError(
      'plugin not found: nonexistent',
    );
  });

  it('registers and updates entries', () => {
    const registry = new PluginRegistry();
    registry.register({
      name: 'alpha',
      version: '1.0.0',
      description: '',
      type: 'node',
      module: '@xifan/plugin-alpha',
      enabled: true,
      requireConfirmation: false,
      permissionLevel: 1,
      source: 'explicit',
    });

    registry.update('alpha', { status: 'loading' });
    registry.update('alpha', { status: 'ready', pid: 1234, loadedAt: 1000 });

    const entry = registry.get('alpha');
    expect(entry?.status).toBe('ready');
    expect(entry?.pid).toBe(1234);
    expect(registry.getByStatus('ready')).toHaveLength(1);
  });
});
