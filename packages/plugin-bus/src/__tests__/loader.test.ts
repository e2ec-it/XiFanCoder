import { describe, expect, it } from 'vitest';

import { PluginLoader } from '../loader.js';
import { InMemoryPluginProcessFactory } from '../plugin-bus.js';
import { PluginRegistry } from '../registry.js';
import type { DiscoveredPluginManifest, PluginToolExecuteResult } from '../types.js';

function makeManifest(overrides: Partial<DiscoveredPluginManifest> = {}): DiscoveredPluginManifest {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    description: '',
    type: 'node',
    module: '@xifan/plugin-test',
    enabled: true,
    requireConfirmation: false,
    permissionLevel: 1,
    source: 'explicit',
    env: {},
    ...overrides,
  };
}

describe('PluginLoader', () => {
  it('throws when loading a plugin that is not registered', async () => {
    const registry = new PluginRegistry();
    const factory = new InMemoryPluginProcessFactory(async () => ({
      pid: 1,
      init: async () => ({ tools: [] }),
      executeTool: async () => ({ content: null }),
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory);

    await expect(loader.load('nonexistent')).rejects.toThrowError('plugin not found: nonexistent');
  });

  it('returns undefined and sets disabled status when plugin is not enabled', async () => {
    const registry = new PluginRegistry();
    const manifest = makeManifest({ name: 'disabled-one', enabled: false });
    registry.register(manifest, 'unloaded');

    const factory = new InMemoryPluginProcessFactory(async () => ({
      pid: 1,
      init: async () => ({ tools: [] }),
      executeTool: async () => ({ content: null }),
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory);

    const result = await loader.load('disabled-one');
    expect(result).toBeUndefined();
    expect(registry.get('disabled-one')?.status).toBe('disabled');
  });

  it('sets error status when process creation fails', async () => {
    const registry = new PluginRegistry();
    const manifest = makeManifest({ name: 'broken' });
    registry.register(manifest, 'unloaded');

    const factory = new InMemoryPluginProcessFactory(async () => {
      throw new Error('spawn failed');
    });
    const loader = new PluginLoader(registry, factory);

    await expect(loader.load('broken')).rejects.toThrowError('spawn failed');
    expect(registry.get('broken')?.status).toBe('error');
    expect(registry.get('broken')?.error).toBe('spawn failed');
  });

  it('sets error status with String conversion for non-Error throws', async () => {
    const registry = new PluginRegistry();
    const manifest = makeManifest({ name: 'broken2' });
    registry.register(manifest, 'unloaded');

    const factory = new InMemoryPluginProcessFactory(async () => {
      throw 'string-error';
    });
    const loader = new PluginLoader(registry, factory);

    await expect(loader.load('broken2')).rejects.toBe('string-error');
    expect(registry.get('broken2')?.error).toBe('string-error');
  });

  it('unload does nothing for unregistered plugin', async () => {
    const registry = new PluginRegistry();
    const factory = new InMemoryPluginProcessFactory(async () => ({
      pid: 1,
      init: async () => ({ tools: [] }),
      executeTool: async () => ({ content: null }),
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory);

    // Should not throw
    await loader.unload('nonexistent');
  });

  it('executeTool throws when plugin not found', async () => {
    const registry = new PluginRegistry();
    const factory = new InMemoryPluginProcessFactory(async () => ({
      pid: 1,
      init: async () => ({ tools: [] }),
      executeTool: async () => ({ content: null }),
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory);

    await expect(loader.executeTool('missing', 'tool', {})).rejects.toThrowError(
      'plugin not found: missing',
    );
  });

  it('executeTool throws when plugin is not ready', async () => {
    const registry = new PluginRegistry();
    const manifest = makeManifest({ name: 'loading-one' });
    registry.register(manifest, 'loading');

    const factory = new InMemoryPluginProcessFactory(async () => ({
      pid: 1,
      init: async () => ({ tools: [] }),
      executeTool: async () => ({ content: null }),
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory);

    await expect(loader.executeTool('loading-one', 'tool', {})).rejects.toThrowError(
      'plugin is not ready: loading-one status=loading',
    );
  });

  it('executeTool throws when process is not found', async () => {
    const registry = new PluginRegistry();
    const manifest = makeManifest({ name: 'no-proc' });
    registry.register(manifest, 'ready');

    // Factory that never created a process, so get() returns undefined
    const factory = new InMemoryPluginProcessFactory(async () => ({
      pid: 1,
      init: async () => ({ tools: [] }),
      executeTool: async () => ({ content: null }),
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory);

    await expect(loader.executeTool('no-proc', 'tool', {})).rejects.toThrowError(
      'plugin process not found: no-proc',
    );
  });

  it('executeTool retries after crash error and succeeds', async () => {
    const registry = new PluginRegistry();
    const manifest = makeManifest({ name: 'crashy' });
    registry.register(manifest, 'unloaded');

    let callCount = 0;
    const factory = new InMemoryPluginProcessFactory(async () => ({
      pid: 42,
      init: async () => ({ tools: ['t1'] }),
      executeTool: async (): Promise<PluginToolExecuteResult> => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('plugin process exited');
        }
        return { content: 'recovered' };
      },
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory, () => 1000);

    // First load to make it ready
    await loader.load('crashy');
    expect(registry.get('crashy')?.status).toBe('ready');

    // Execute should crash first time, reload, and retry
    const result = await loader.executeTool('crashy', 't1', {});
    expect(result.content).toBe('recovered');
  });

  it('executeTool does not retry on non-crash errors and sets error status', async () => {
    const registry = new PluginRegistry();
    const manifest = makeManifest({ name: 'bad-tool' });
    registry.register(manifest, 'unloaded');

    const factory = new InMemoryPluginProcessFactory(async () => ({
      pid: 42,
      init: async () => ({ tools: ['t1'] }),
      executeTool: async (): Promise<PluginToolExecuteResult> => {
        throw new Error('some random error');
      },
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory, () => 1000);

    await loader.load('bad-tool');

    await expect(loader.executeTool('bad-tool', 't1', {})).rejects.toThrowError(
      'some random error',
    );
    expect(registry.get('bad-tool')?.status).toBe('error');
    expect(registry.get('bad-tool')?.error).toBe('some random error');
  });

  it('executeTool rethrows crash error when reload returns undefined', async () => {
    const registry = new PluginRegistry();
    const manifest = makeManifest({ name: 'reload-disabled', enabled: true });
    registry.register(manifest, 'unloaded');

    let loaded = false;
    const factory = new InMemoryPluginProcessFactory(async () => ({
      pid: 42,
      init: async () => {
        // On second load the manifest will be disabled
        if (loaded) {
          return { tools: [] };
        }
        loaded = true;
        return { tools: ['t1'] };
      },
      executeTool: async (): Promise<PluginToolExecuteResult> => {
        throw new Error('plugin process exited');
      },
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory, () => 1000);

    await loader.load('reload-disabled');
    expect(registry.get('reload-disabled')?.status).toBe('ready');

    // Make the plugin disabled so reload returns undefined
    registry.update('reload-disabled', { status: 'ready' });
    // Manually set enabled=false on manifest by re-registering
    const disabledManifest = makeManifest({ name: 'reload-disabled', enabled: false });
    registry.register(disabledManifest, 'ready');

    await expect(loader.executeTool('reload-disabled', 't1', {})).rejects.toThrowError(
      'plugin process exited',
    );
  });

  it('executeTool rethrows crash error when restarted process is not found', async () => {
    const registry = new PluginRegistry();
    const manifest = makeManifest({ name: 'ghost' });
    registry.register(manifest, 'unloaded');

    let execCount = 0;
    // Custom factory where get() returns undefined after reload
    const customFactory = {
      async create(_m: DiscoveredPluginManifest) {
        return {
          pid: 42,
          init: async () => ({ tools: ['t1'] }),
          executeTool: async (): Promise<PluginToolExecuteResult> => {
            execCount += 1;
            if (execCount === 1) {
              throw new Error('plugin process not found');
            }
            return { content: 'ok' };
          },
          destroy: async () => undefined,
        };
      },
      get(_name: string) {
        // After crash, return undefined to simulate missing process
        if (execCount >= 1) {
          return undefined;
        }
        return {
          pid: 42,
          init: async () => ({ tools: ['t1'] }),
          executeTool: async (): Promise<PluginToolExecuteResult> => {
            execCount += 1;
            throw new Error('plugin process not found');
          },
          destroy: async () => undefined,
        };
      },
    };
    const loader = new PluginLoader(registry, customFactory, () => 1000);

    await loader.load('ghost');

    await expect(loader.executeTool('ghost', 't1', {})).rejects.toThrowError(
      'plugin process not found',
    );
  });

  it('executeTool sets error on non-Error throw via String conversion', async () => {
    const registry = new PluginRegistry();
    const manifest = makeManifest({ name: 'str-err' });
    registry.register(manifest, 'unloaded');

    const factory = new InMemoryPluginProcessFactory(async () => ({
      pid: 42,
      init: async () => ({ tools: ['t1'] }),
      executeTool: async (): Promise<PluginToolExecuteResult> => {
        throw 'string-exec-error';
      },
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory, () => 1000);

    await loader.load('str-err');

    await expect(loader.executeTool('str-err', 't1', {})).rejects.toBe('string-exec-error');
    expect(registry.get('str-err')?.error).toBe('string-exec-error');
  });
});
