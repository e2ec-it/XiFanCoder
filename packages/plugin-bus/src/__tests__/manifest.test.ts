import { describe, expect, it } from 'vitest';

import {
  parseDiscoveredPluginManifest,
  parseExplicitPluginsConfig,
  parsePluginManifest,
  PluginManifestError,
} from '../manifest.js';

describe('plugin manifest schema', () => {
  it('parses stdio plugin with defaults', () => {
    const manifest = parsePluginManifest({
      name: 'crush',
      type: 'stdio',
      command: 'crush',
      permissionLevel: 2,
    });

    expect(manifest.enabled).toBe(true);
    expect(manifest.timeout).toBe(30_000);
    expect(manifest.args).toEqual([]);
  });

  it('rejects L3 plugin without mandatory confirmation', () => {
    expect(() =>
      parsePluginManifest({
        name: 'danger-plugin',
        type: 'node',
        module: '@xifan/plugin-danger',
        permissionLevel: 3,
        requireConfirmation: false,
      }),
    ).toThrowError('permissionLevel=3 requires requireConfirmation=true');
  });

  it('adds source metadata for discovered manifests', () => {
    const manifest = parseDiscoveredPluginManifest('explicit', {
      name: 'aider',
      type: 'python',
      module: '@xifan/plugin-aider',
      permissionLevel: 3,
      requireConfirmation: true,
      enabled: true,
    });

    expect(manifest.source).toBe('explicit');
  });

  it('creates PluginManifestError with causeValue', () => {
    const cause = new Error('original');
    const err = new PluginManifestError('wrapped', cause);
    expect(err.message).toBe('wrapped');
    expect(err.name).toBe('PluginManifestError');
    expect(err.causeValue).toBe(cause);
  });

  it('rejects stdio plugin without command', () => {
    expect(() =>
      parsePluginManifest({
        name: 'no-cmd',
        type: 'stdio',
        permissionLevel: 1,
      }),
    ).toThrowError('stdio plugin requires command');
  });

  it('rejects node plugin without module', () => {
    expect(() =>
      parsePluginManifest({
        name: 'no-mod',
        type: 'node',
        permissionLevel: 1,
      }),
    ).toThrowError('node plugin requires module');
  });

  it('rejects python plugin without module', () => {
    expect(() =>
      parsePluginManifest({
        name: 'no-mod-py',
        type: 'python',
        permissionLevel: 1,
      }),
    ).toThrowError('python plugin requires module');
  });

  it('throws PluginManifestError for invalid explicit config format', () => {
    expect(() => parseExplicitPluginsConfig('not-an-object')).toThrowError(
      'invalid plugins config format',
    );
  });

  it('parses explicit config plugins array', () => {
    const plugins = parseExplicitPluginsConfig({
      plugins: [{ name: 'alpha' }],
    });

    expect(plugins).toHaveLength(1);
  });
});
