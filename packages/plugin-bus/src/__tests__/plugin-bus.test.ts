import { describe, expect, it } from 'vitest';

import { PluginLoader } from '../loader.js';
import { PluginBus, InMemoryPluginProcessFactory } from '../plugin-bus.js';
import { PluginRegistry } from '../registry.js';
import type { PluginDiscoverer } from '../types.js';

const NOOP_PATHS = {
  globalPluginsDir: '/tmp/global',
  projectPluginsDir: '/tmp/project',
  nodeModulesDir: '/tmp/node_modules',
  explicitConfig: '/tmp/plugins.json',
} as const;

describe('PluginBus', () => {
  it('loads enabled plugins and disables L3 plugins that are not whitelisted', async () => {
    const loaded: string[] = [];
    const discoverer: PluginDiscoverer = {
      discover: async () => [
        {
          name: 'safe',
          version: '1.0.0',
          description: '',
          type: 'node',
          module: '@xifan/plugin-safe',
          enabled: true,
          requireConfirmation: false,
          permissionLevel: 1,
          source: 'explicit',
        },
        {
          name: 'disabled-config',
          version: '1.0.0',
          description: '',
          type: 'node',
          module: '@xifan/plugin-disabled',
          enabled: false,
          requireConfirmation: false,
          permissionLevel: 1,
          source: 'explicit',
        },
        {
          name: 'danger',
          version: '1.0.0',
          description: '',
          type: 'python',
          module: '@xifan/plugin-danger',
          enabled: true,
          requireConfirmation: true,
          permissionLevel: 3,
          source: 'explicit',
        },
      ],
    };

    const registry = new PluginRegistry();
    const factory = new InMemoryPluginProcessFactory(async (manifest) => ({
      pid: 9527,
      init: async () => {
        loaded.push(manifest.name);
        return { tools: [] };
      },
      executeTool: async () => ({
        content: null,
      }),
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory, () => 1000);
    const bus = new PluginBus({
      discoverer,
      registry,
      loader,
      enabledL3Plugins: [],
    });

    await bus.bootstrap(NOOP_PATHS);

    const byName = new Map(bus.listPlugins().map((entry) => [entry.manifest.name, entry]));
    expect(loaded).toEqual(['safe']);
    expect(byName.get('safe')?.status).toBe('ready');
    expect(byName.get('disabled-config')?.status).toBe('disabled');
    expect(byName.get('danger')?.status).toBe('disabled');
    expect(byName.get('danger')?.error).toContain('enabledL3Plugins');
  });

  it('loads L3 plugin when included in whitelist', async () => {
    const loaded: string[] = [];
    const discoverer: PluginDiscoverer = {
      discover: async () => [
        {
          name: 'danger',
          version: '1.0.0',
          description: '',
          type: 'python',
          module: '@xifan/plugin-danger',
          enabled: true,
          requireConfirmation: true,
          permissionLevel: 3,
          source: 'explicit',
        },
      ],
    };

    const registry = new PluginRegistry();
    const factory = new InMemoryPluginProcessFactory(async (manifest) => ({
      pid: 2048,
      init: async () => {
        loaded.push(manifest.name);
        return { tools: [] };
      },
      executeTool: async () => ({
        content: null,
      }),
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory, () => 2000);
    const bus = new PluginBus({
      discoverer,
      registry,
      loader,
      enabledL3Plugins: ['danger'],
    });

    await bus.bootstrap(NOOP_PATHS);

    expect(loaded).toEqual(['danger']);
    expect(bus.listPlugins()[0]?.status).toBe('ready');
  });

  it('loadPlugin resolves without returning init result', async () => {
    const discoverer: PluginDiscoverer = {
      discover: async () => [
        {
          name: 'alpha',
          version: '1.0.0',
          description: '',
          type: 'node',
          module: '@xifan/plugin-alpha',
          enabled: true,
          requireConfirmation: false,
          permissionLevel: 1,
          source: 'explicit',
        },
      ],
    };

    const registry = new PluginRegistry();
    const factory = new InMemoryPluginProcessFactory(async () => ({
      pid: 100,
      init: async () => ({ tools: ['t1'] }),
      executeTool: async () => ({ content: null }),
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory, () => 1000);
    const bus = new PluginBus({ discoverer, registry, loader });

    await bus.bootstrap(NOOP_PATHS);

    // loadPlugin wraps loader.load() and discards its return value
    const result = await bus.loadPlugin('alpha');
    expect(result).toBeUndefined();
  });

  it('executes tool via loaded plugin and keeps ready state after success', async () => {
    const discoverer: PluginDiscoverer = {
      discover: async () => [
        {
          name: 'safe',
          version: '1.0.0',
          description: '',
          type: 'node',
          module: '@xifan/plugin-safe',
          enabled: true,
          requireConfirmation: false,
          permissionLevel: 1,
          source: 'explicit',
        },
      ],
    };

    const registry = new PluginRegistry();
    const factory = new InMemoryPluginProcessFactory(async () => ({
      pid: 9527,
      init: async () => ({ tools: ['safe_echo'] }),
      executeTool: async (_toolName, args) => ({
        content: args,
      }),
      destroy: async () => undefined,
    }));
    const loader = new PluginLoader(registry, factory, () => 3000);
    const bus = new PluginBus({
      discoverer,
      registry,
      loader,
      enabledL3Plugins: [],
    });

    await bus.bootstrap(NOOP_PATHS);

    const result = await bus.executeTool('safe', 'safe_echo', { msg: 'hello' });
    expect(result.content).toEqual({ msg: 'hello' });
    expect(bus.listPlugins()[0]?.status).toBe('ready');
  });
});
