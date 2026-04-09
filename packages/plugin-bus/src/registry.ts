import type {
  DiscoveredPluginManifest,
  PluginRegistryEntry,
  PluginStatus,
} from './types.js';

export class PluginRegistry {
  private readonly entries = new Map<string, PluginRegistryEntry>();

  clear(): void {
    this.entries.clear();
  }

  register(
    manifest: DiscoveredPluginManifest,
    initialStatus: PluginStatus = 'unloaded',
  ): void {
    this.entries.set(manifest.name, {
      manifest,
      status: initialStatus,
    });
  }

  update(name: string, update: Partial<Omit<PluginRegistryEntry, 'manifest'>>): void {
    const existing = this.entries.get(name);
    if (!existing) {
      throw new Error(`plugin not found: ${name}`);
    }

    this.entries.set(name, {
      ...existing,
      ...update,
    });
  }

  get(name: string): PluginRegistryEntry | undefined {
    return this.entries.get(name);
  }

  getAll(): readonly PluginRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  getByStatus(status: PluginStatus): readonly PluginRegistryEntry[] {
    return this.getAll().filter((entry) => entry.status === status);
  }
}
