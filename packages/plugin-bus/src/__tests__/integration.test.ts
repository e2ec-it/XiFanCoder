import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DefaultPluginDiscoverer } from '../discovery.js';
import { PluginLoader } from '../loader.js';
import { PluginBus } from '../plugin-bus.js';
import { ChildProcessPluginFactory } from '../process.js';
import { PluginRegistry } from '../registry.js';

const tempDirs: string[] = [];

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeExecutableScript(filePath: string, code: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, code, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function createSandboxPaths(prefix: string): {
  root: string;
  globalPluginsDir: string;
  projectPluginsDir: string;
  nodeModulesDir: string;
  explicitConfig: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return {
    root,
    globalPluginsDir: path.join(root, 'global-plugins'),
    projectPluginsDir: path.join(root, 'project-plugins'),
    nodeModulesDir: path.join(root, 'node_modules'),
    explicitConfig: path.join(root, 'plugins.json'),
  };
}

function createPluginBus(): PluginBus {
  const registry = new PluginRegistry();
  const loader = new PluginLoader(registry, new ChildProcessPluginFactory(), () => Date.now());
  return new PluginBus({
    discoverer: new DefaultPluginDiscoverer(),
    registry,
    loader,
    enabledL3Plugins: [],
  });
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('PluginBus integration', () => {
  it('boots smoldev plugin from explicit config and executes smoldev_generate', async () => {
    const paths = createSandboxPaths('xifan-plugin-int-smoldev-');
    const script = path.join(paths.root, 'plugin-smoldev.mjs');
    writeExecutableScript(
      script,
      [
        "import readline from 'node:readline';",
        "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'for await (const line of rl) {',
        '  const req = JSON.parse(line);',
        "  if (req.method === 'plugin/init') {",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: ['smoldev_generate'] } }));",
        "  } else if (req.method === 'plugin/executeTool') {",
        '    const args = req.params?.args ?? {};',
        "    if (req.params?.toolName !== 'smoldev_generate') {",
        "      console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32001, message: 'unknown_tool' } }));",
        '      continue;',
        '    }',
        "    const task = String(args.task ?? '');",
        "    const model = process.env.MOCK_LLM_MODEL ?? 'mock-llm';",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { content: { model, task, plan: ['Analyze task', 'Scaffold files', 'Implement logic'], files: ['src/index.ts', 'README.md'] } } }));",
        "  } else if (req.method === 'plugin/destroy') {",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }));",
        '    process.exit(0);',
        '  }',
        '}',
      ].join('\n'),
    );

    writeJson(paths.explicitConfig, {
      plugins: [
        {
          name: 'smoldev',
          type: 'node',
          module: script,
          enabled: true,
          requireConfirmation: false,
          permissionLevel: 1,
          timeout: 2_000,
          env: {
            MOCK_LLM_MODEL: 'mock-llm',
          },
        },
      ],
    });

    const bus = createPluginBus();
    await bus.bootstrap(paths);

    const result = await bus.executeTool('smoldev', 'smoldev_generate', {
      task: 'build hello api',
    });
    expect(result.content).toMatchObject({
      model: 'mock-llm',
      task: 'build hello api',
    });

    const smoldev = bus.listPlugins().find((item) => item.manifest.name === 'smoldev');
    expect(smoldev?.status).toBe('ready');
    await bus.unloadPlugin('smoldev');
  });

  it('auto-recovers from plugin crash by reloading process and retrying execute', async () => {
    const paths = createSandboxPaths('xifan-plugin-int-crash-');
    const script = path.join(paths.root, 'plugin-crashy.mjs');
    const markerFile = path.join(paths.root, '.crashed-once');
    writeExecutableScript(
      script,
      [
        "import fs from 'node:fs';",
        "import readline from 'node:readline';",
        "const marker = process.env.CRASH_MARKER_FILE;",
        "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'for await (const line of rl) {',
        '  const req = JSON.parse(line);',
        "  if (req.method === 'plugin/init') {",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: ['crashy_tool'] } }));",
        "  } else if (req.method === 'plugin/executeTool') {",
        '    if (marker && !fs.existsSync(marker)) {',
        "      fs.writeFileSync(marker, '1', 'utf8');",
        '      process.exit(1);',
        '    }',
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { content: { recovered: true } } }));",
        "  } else if (req.method === 'plugin/destroy') {",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }));",
        '    process.exit(0);',
        '  }',
        '}',
      ].join('\n'),
    );

    writeJson(paths.explicitConfig, {
      plugins: [
        {
          name: 'crashy',
          type: 'node',
          module: script,
          enabled: true,
          requireConfirmation: false,
          permissionLevel: 1,
          timeout: 2_000,
          env: {
            CRASH_MARKER_FILE: markerFile,
          },
        },
      ],
    });

    const bus = createPluginBus();
    await bus.bootstrap(paths);

    const result = await bus.executeTool('crashy', 'crashy_tool', {});
    expect(result.content).toEqual({ recovered: true });

    const crashy = bus.listPlugins().find((item) => item.manifest.name === 'crashy');
    expect(crashy?.status).toBe('ready');
    expect(fs.existsSync(markerFile)).toBe(true);

    await bus.unloadPlugin('crashy');
  });
});
