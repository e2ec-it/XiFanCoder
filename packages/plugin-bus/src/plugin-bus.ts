import { DefaultPluginDiscoverer } from './discovery.js';
import { PluginLoader } from './loader.js';
import { PluginRegistry } from './registry.js';
import type {
  IPluginBus,
  PluginDiscoverer,
  PluginProcessFactory,
  PluginRegistryEntry,
  PluginSearchPaths,
  PluginToolExecuteResult,
} from './types.js';

export interface PluginBusOptions {
  readonly discoverer?: PluginDiscoverer;
  readonly registry?: PluginRegistry;
  readonly loader: PluginLoader;
  readonly enabledL3Plugins?: readonly string[];
}

export class PluginBus implements IPluginBus {
  private readonly discoverer: PluginDiscoverer;
  private readonly registry: PluginRegistry;
  private readonly loader: PluginLoader;
  private readonly enabledL3Plugins: ReadonlySet<string>;

  constructor(options: PluginBusOptions) {
    this.discoverer = options.discoverer ?? new DefaultPluginDiscoverer();
    this.registry = options.registry ?? new PluginRegistry();
    this.loader = options.loader;
    this.enabledL3Plugins = new Set(options.enabledL3Plugins ?? []);
  }

  async bootstrap(searchPaths: PluginSearchPaths): Promise<void> {
    this.registry.clear();

    const manifests = await this.discoverer.discover(searchPaths);
    for (const manifest of manifests) {
      if (manifest.permissionLevel === 3 && !this.enabledL3Plugins.has(manifest.name)) {
        this.registry.register(
          {
            ...manifest,
            enabled: false,
          },
          'disabled',
        );
        this.registry.update(manifest.name, {
          error: 'permissionLevel=3 plugin is not in enabledL3Plugins',
        });
        continue;
      }

      this.registry.register(manifest, manifest.enabled ? 'unloaded' : 'disabled');
    }

    for (const entry of this.registry.getAll()) {
      if (entry.manifest.enabled) {
        await this.loader.load(entry.manifest.name);
      }
    }
  }

  loadPlugin(name: string): Promise<void> {
    return this.loader.load(name).then(() => undefined);
  }

  unloadPlugin(name: string): Promise<void> {
    return this.loader.unload(name);
  }

  executeTool(
    pluginName: string,
    toolName: string,
    args: unknown,
  ): Promise<PluginToolExecuteResult> {
    return this.loader.executeTool(pluginName, toolName, args);
  }

  listPlugins(): readonly PluginRegistryEntry[] {
    return this.registry.getAll();
  }
}

export class InMemoryPluginProcessFactory implements PluginProcessFactory {
  private readonly processes = new Map<string, Awaited<ReturnType<PluginProcessFactory['create']>>>();
  constructor(private readonly createImpl: PluginProcessFactory['create']) {}

  async create(manifest: Parameters<PluginProcessFactory['create']>[0]): Promise<Awaited<ReturnType<PluginProcessFactory['create']>>> {
    const process = await this.createImpl(manifest);
    this.processes.set(manifest.name, process);
    return process;
  }

  get(name: string): Awaited<ReturnType<PluginProcessFactory['create']>> | undefined {
    return this.processes.get(name);
  }
}
