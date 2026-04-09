import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DefaultPluginDiscoverer } from '../discovery.js';

const tempDirs: string[] = [];

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('DefaultPluginDiscoverer', () => {
  it('applies source precedence npm < global < project < explicit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-discovery-'));
    const globalDir = path.join(root, 'global');
    const projectDir = path.join(root, 'project');
    const nodeModulesDir = path.join(root, 'node_modules');
    const explicitConfig = path.join(root, 'plugins.json');

    writeJson(path.join(nodeModulesDir, '@xifan', 'plugin-alpha', 'package.json'), {
      name: '@xifan/plugin-alpha',
      version: '1.0.0',
      keywords: ['xifan-plugin'],
      xifanPlugin: {
        type: 'node',
        module: '@xifan/plugin-alpha',
      },
    });

    writeJson(path.join(globalDir, 'alpha', 'plugin.json'), {
      name: 'alpha',
      version: '2.0.0',
      type: 'node',
      module: '@xifan/plugin-alpha-global',
      permissionLevel: 1,
    });

    writeJson(path.join(projectDir, 'alpha', 'plugin.json'), {
      name: 'alpha',
      version: '3.0.0',
      type: 'node',
      module: '@xifan/plugin-alpha-project',
      permissionLevel: 1,
    });

    writeJson(explicitConfig, {
      plugins: [
        {
          name: 'alpha',
          version: '4.0.0',
          type: 'node',
          module: '@xifan/plugin-alpha-explicit',
          permissionLevel: 1,
        },
        {
          name: 'beta',
          type: 'stdio',
          command: 'beta-plugin',
          permissionLevel: 2,
        },
      ],
    });

    const discoverer = new DefaultPluginDiscoverer();
    const manifests = await discoverer.discover({
      globalPluginsDir: globalDir,
      projectPluginsDir: projectDir,
      nodeModulesDir,
      explicitConfig,
    });

    const byName = new Map(manifests.map((item) => [item.name, item]));
    expect(byName.get('alpha')?.version).toBe('4.0.0');
    expect(byName.get('alpha')?.source).toBe('explicit');
    expect(byName.get('beta')?.source).toBe('explicit');
  });

  it('existsAsFile returns false for nonexistent path', () => {
    const discoverer = new DefaultPluginDiscoverer();
    const result = discoverer.loadExplicitConfig('/tmp/nonexistent-xifan-config-12345.json');
    expect(result).toEqual([]);
  });

  it('scanNpmPackages returns empty when scope dir does not exist', () => {
    const discoverer = new DefaultPluginDiscoverer();
    const result = discoverer.scanNpmPackages('/tmp/nonexistent-xifan-nm-12345');
    expect(result).toEqual([]);
  });

  it('scanNpmPackages skips non-directory entries in scope dir', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-disc-nondir-'));
    tempDirs.push(root);
    const scopeDir = path.join(root, 'node_modules', '@xifan');
    fs.mkdirSync(scopeDir, { recursive: true });
    // Create a file (not a directory) inside @xifan
    fs.writeFileSync(path.join(scopeDir, 'plugin-fake'), 'not a dir', 'utf8');

    const discoverer = new DefaultPluginDiscoverer();
    const result = discoverer.scanNpmPackages(path.join(root, 'node_modules'));
    expect(result).toEqual([]);
  });

  it('scanNpmPackages skips packages not starting with plugin-', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-disc-noprefix-'));
    tempDirs.push(root);
    const scopeDir = path.join(root, 'node_modules', '@xifan');
    const pkgDir = path.join(scopeDir, 'core');
    fs.mkdirSync(pkgDir, { recursive: true });
    writeJson(path.join(pkgDir, 'package.json'), {
      name: '@xifan/core',
      keywords: ['xifan-plugin'],
    });

    const discoverer = new DefaultPluginDiscoverer();
    const result = discoverer.scanNpmPackages(path.join(root, 'node_modules'));
    expect(result).toEqual([]);
  });

  it('scanNpmPackages skips packages without package.json file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-disc-nopkg-'));
    tempDirs.push(root);
    const scopeDir = path.join(root, 'node_modules', '@xifan');
    const pkgDir = path.join(scopeDir, 'plugin-empty');
    fs.mkdirSync(pkgDir, { recursive: true });
    // No package.json

    const discoverer = new DefaultPluginDiscoverer();
    const result = discoverer.scanNpmPackages(path.join(root, 'node_modules'));
    expect(result).toEqual([]);
  });

  it('scanNpmPackages skips packages without xifan-plugin keyword', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-disc-nokw-'));
    tempDirs.push(root);
    const scopeDir = path.join(root, 'node_modules', '@xifan');
    const pkgDir = path.join(scopeDir, 'plugin-nope');
    fs.mkdirSync(pkgDir, { recursive: true });
    writeJson(path.join(pkgDir, 'package.json'), {
      name: '@xifan/plugin-nope',
      keywords: ['other'],
      xifanPlugin: { type: 'node', module: 'foo' },
    });

    const discoverer = new DefaultPluginDiscoverer();
    const result = discoverer.scanNpmPackages(path.join(root, 'node_modules'));
    expect(result).toEqual([]);
  });

  it('scanPluginDir returns empty when dir does not exist', () => {
    const discoverer = new DefaultPluginDiscoverer();
    const result = discoverer.scanPluginDir('/tmp/nonexistent-xifan-plugdir-12345', 'global');
    expect(result).toEqual([]);
  });

  it('scanPluginDir skips non-directory entries', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-disc-plugdir-file-'));
    tempDirs.push(root);
    const plugDir = path.join(root, 'plugins');
    fs.mkdirSync(plugDir, { recursive: true });
    fs.writeFileSync(path.join(plugDir, 'not-a-dir'), 'file', 'utf8');

    const discoverer = new DefaultPluginDiscoverer();
    const result = discoverer.scanPluginDir(plugDir, 'project');
    expect(result).toEqual([]);
  });

  it('scanPluginDir skips subdirs without plugin.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-disc-plugdir-nojson-'));
    tempDirs.push(root);
    const plugDir = path.join(root, 'plugins');
    const subDir = path.join(plugDir, 'some-plugin');
    fs.mkdirSync(subDir, { recursive: true });
    // No plugin.json inside

    const discoverer = new DefaultPluginDiscoverer();
    const result = discoverer.scanPluginDir(plugDir, 'global');
    expect(result).toEqual([]);
  });

  it('readJson throws PluginManifestError for invalid JSON file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-disc-badjson-'));
    tempDirs.push(root);
    const scopeDir = path.join(root, 'node_modules', '@xifan');
    const pkgDir = path.join(scopeDir, 'plugin-badjson');
    fs.mkdirSync(pkgDir, { recursive: true });
    // Write a valid package.json first
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@xifan/plugin-badjson',
        keywords: ['xifan-plugin'],
        xifanPlugin: { manifestFile: 'bad.json' },
      }),
      'utf8',
    );
    // Write invalid JSON content
    fs.writeFileSync(path.join(pkgDir, 'bad.json'), '{ not valid json', 'utf8');

    const discoverer = new DefaultPluginDiscoverer();
    expect(() => discoverer.scanNpmPackages(path.join(root, 'node_modules'))).toThrowError(
      'failed to read JSON file',
    );
  });

  it('toManifestFromPackageJson uses manifestFile field when present', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-disc-manifestfile-'));
    tempDirs.push(root);
    const scopeDir = path.join(root, 'node_modules', '@xifan');
    const pkgDir = path.join(scopeDir, 'plugin-ext');
    fs.mkdirSync(pkgDir, { recursive: true });

    writeJson(path.join(pkgDir, 'custom-manifest.json'), {
      name: 'ext',
      version: '2.0.0',
      type: 'stdio',
      command: 'ext-cli',
      permissionLevel: 1,
    });

    writeJson(path.join(pkgDir, 'package.json'), {
      name: '@xifan/plugin-ext',
      version: '1.0.0',
      keywords: ['xifan-plugin'],
      xifanPlugin: {
        manifestFile: 'custom-manifest.json',
      },
    });

    const discoverer = new DefaultPluginDiscoverer();
    const result = discoverer.scanNpmPackages(path.join(root, 'node_modules'));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('ext');
    expect(result[0].version).toBe('2.0.0');
    expect(result[0].source).toBe('npm');
  });
});
