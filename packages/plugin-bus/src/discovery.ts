import fs from 'node:fs';
import path from 'node:path';

import {
  parseDiscoveredPluginManifest,
  parseExplicitPluginsConfig,
  PluginManifestError,
} from './manifest.js';
import type {
  DiscoveredPluginManifest,
  PluginDiscoverer,
  PluginSearchPaths,
  PluginSource,
} from './types.js';

interface PackageJsonWithPlugin extends Record<string, unknown> {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly xifanPlugin?: {
    readonly name?: string;
    readonly type?: 'stdio' | 'node' | 'python';
    readonly command?: string;
    readonly args?: readonly string[];
    readonly module?: string;
    readonly enabled?: boolean;
    readonly requireConfirmation?: boolean;
    readonly permissionLevel?: 0 | 1 | 2 | 3;
    readonly timeout?: number;
    readonly env?: Readonly<Record<string, string>>;
    readonly manifestFile?: string;
  };
}

function existsAsDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function existsAsFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readJson(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    throw new PluginManifestError(`failed to read JSON file: ${filePath}`, error);
  }
}

function toManifestFromPackageJson(
  pkgDir: string,
  pkg: PackageJsonWithPlugin,
): DiscoveredPluginManifest {
  const pluginField = pkg.xifanPlugin ?? {};

  if (pluginField.manifestFile) {
    const manifestPath = path.resolve(pkgDir, pluginField.manifestFile);
    const manifest = readJson(manifestPath);
    return parseDiscoveredPluginManifest('npm', manifest);
  }

  const packageName = pkg.name ?? path.basename(pkgDir);
  const inferredName = packageName.replace(/^@xifan\/plugin-/, '');
  const inferredType = pluginField.type ?? 'node';
  const inferredModule =
    inferredType === 'stdio' ? undefined : (pluginField.module ?? packageName);

  return parseDiscoveredPluginManifest('npm', {
    name: pluginField.name ?? inferredName,
    version: pkg.version ?? '0.0.0',
    description: pkg.description ?? '',
    type: inferredType,
    command: pluginField.command,
    args: pluginField.args,
    module: inferredModule,
    enabled: pluginField.enabled ?? true,
    requireConfirmation: pluginField.requireConfirmation ?? false,
    permissionLevel: pluginField.permissionLevel ?? 1,
    timeout: pluginField.timeout ?? 30_000,
    env: pluginField.env ?? {},
  });
}

export class DefaultPluginDiscoverer implements PluginDiscoverer {
  async discover(searchPaths: PluginSearchPaths): Promise<readonly DiscoveredPluginManifest[]> {
    const manifests = new Map<string, DiscoveredPluginManifest>();

    for (const manifest of this.scanNpmPackages(searchPaths.nodeModulesDir)) {
      manifests.set(manifest.name, manifest);
    }

    for (const manifest of this.scanPluginDir(searchPaths.globalPluginsDir, 'global')) {
      manifests.set(manifest.name, manifest);
    }

    for (const manifest of this.scanPluginDir(searchPaths.projectPluginsDir, 'project')) {
      manifests.set(manifest.name, manifest);
    }

    for (const manifest of this.loadExplicitConfig(searchPaths.explicitConfig)) {
      manifests.set(manifest.name, manifest);
    }

    return Array.from(manifests.values());
  }

  scanNpmPackages(nodeModulesDir: string): readonly DiscoveredPluginManifest[] {
    const scopeDir = path.join(nodeModulesDir, '@xifan');
    if (!existsAsDirectory(scopeDir)) {
      return [];
    }

    const manifests: DiscoveredPluginManifest[] = [];
    for (const entry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (!entry.name.startsWith('plugin-')) {
        continue;
      }

      const pkgDir = path.join(scopeDir, entry.name);
      const pkgJsonPath = path.join(pkgDir, 'package.json');
      if (!existsAsFile(pkgJsonPath)) {
        continue;
      }

      const pkgJsonRaw = readJson(pkgJsonPath);
      const pkg = pkgJsonRaw as PackageJsonWithPlugin;
      const hasKeyword = Array.isArray(pkg.keywords) && pkg.keywords.includes('xifan-plugin');
      if (!hasKeyword) {
        continue;
      }

      manifests.push(toManifestFromPackageJson(pkgDir, pkg));
    }

    return manifests;
  }

  scanPluginDir(dir: string, source: Exclude<PluginSource, 'npm' | 'explicit'>): readonly DiscoveredPluginManifest[] {
    if (!existsAsDirectory(dir)) {
      return [];
    }

    const manifests: DiscoveredPluginManifest[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifestPath = path.join(dir, entry.name, 'plugin.json');
      if (!existsAsFile(manifestPath)) {
        continue;
      }

      const manifestRaw = readJson(manifestPath);
      manifests.push(parseDiscoveredPluginManifest(source, manifestRaw));
    }

    return manifests;
  }

  loadExplicitConfig(configPath: string): readonly DiscoveredPluginManifest[] {
    if (!existsAsFile(configPath)) {
      return [];
    }

    const configRaw = readJson(configPath);
    const pluginItems = parseExplicitPluginsConfig(configRaw);
    return pluginItems.map((item) => parseDiscoveredPluginManifest('explicit', item));
  }
}
