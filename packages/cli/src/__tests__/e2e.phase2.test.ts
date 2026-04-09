import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { MemoryManager } from '@xifan-coder/mem';

import { executeCommandDetailed } from '../commands.js';
import { runCli } from '../cli.js';
import { parseCliArgs } from '../parse.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function makeWorkspaceTemp(prefix: string): string {
  const base = path.join(process.cwd(), '.tmp-e2e');
  fs.mkdirSync(base, { recursive: true });
  const created = fs.mkdtempSync(path.join(base, `${prefix}-`));
  tempDirs.push(created);
  return created;
}

function writeExecutableScript(filePath: string, code: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, code, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function writePluginConfig(
  targetPath: string,
  plugin: {
    name: string;
    command: string;
    args: readonly string[];
    permissionLevel: 0 | 1 | 2 | 3;
  },
): void {
  fs.writeFileSync(
    targetPath,
    `${JSON.stringify(
      {
        plugins: [
          {
            name: plugin.name,
            version: '1.0.0',
            description: `${plugin.name} plugin`,
            type: 'stdio',
            command: plugin.command,
            args: plugin.args,
            enabled: true,
            requireConfirmation: false,
            permissionLevel: plugin.permissionLevel,
            timeout: 5_000,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function runCliJson(
  argv: readonly string[],
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  json?: unknown;
}> {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const code = await runCli([...argv, '--output', 'json'], {
    printStdout: (line) => {
      stdoutLines.push(line);
    },
    printStderr: (line) => {
      stderrLines.push(line);
    },
  });

  const stdout = stdoutLines.join('\n');
  return {
    code,
    stdout,
    stderr: stderrLines.join('\n'),
    json: stdout.trim().length > 0 ? JSON.parse(stdout) : undefined,
  };
}

describe('phase2 e2e', () => {
  it('scenario1: smol-dev style plugin generates skeleton files', async () => {
    const root = makeWorkspaceTemp('xifan-e2e-p2-smol');
    const outputDir = path.join(root, 'generated');
    const pluginScript = path.join(root, 'smoldev-plugin.mjs');
    const configPath = path.join(root, 'plugins.json');
    const globalDir = path.join(root, 'global');
    const projectDir = path.join(root, 'project');
    const nodeModulesDir = path.join(root, 'node_modules');

    writeExecutableScript(
      pluginScript,
      [
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "import readline from 'node:readline';",
        "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'for await (const line of rl) {',
        '  const req = JSON.parse(line);',
        "  if (req.method === 'plugin/init') {",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: ['smoldev_generate'] } }));",
        "  } else if (req.method === 'plugin/executeTool') {",
        '    const out = req.params.args?.outputDir;',
        "    fs.mkdirSync(path.join(out, 'src'), { recursive: true });",
        "    fs.writeFileSync(path.join(out, 'src', 'main.ts'), 'export const app = true;\\n', 'utf8');",
        "    fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: 'generated-app' }, null, 2) + '\\n', 'utf8');",
        '    const payload = { filesCreated: [path.join(out, "src", "main.ts"), path.join(out, "package.json")] };',
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { content: payload } }));",
        "  } else if (req.method === 'plugin/destroy') {",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }));",
        '    process.exit(0);',
        '  }',
        '}',
      ].join('\n'),
    );

    writePluginConfig(configPath, {
      name: 'smoldev',
      command: process.execPath,
      args: [pluginScript],
      permissionLevel: 1,
    });

    const run = await runCliJson([
      'plugin-exec',
      '--plugin',
      'smoldev',
      '--tool',
      'smoldev_generate',
      '--args-json',
      JSON.stringify({
        spec: 'todo app',
        outputDir,
      }),
      '--allow-write',
      '--yes',
      '--global',
      globalDir,
      '--project',
      projectDir,
      '--node-modules',
      nodeModulesDir,
      '--config',
      configPath,
    ]);

    expect(run.code).toBe(0);
    const payload = run.json as {
      type: string;
      executed: boolean;
      result?: { content?: { filesCreated?: string[] } };
    };
    expect(payload.type).toBe('plugin-exec');
    expect(payload.executed).toBe(true);
    expect(payload.result?.content?.filesCreated?.length).toBe(2);
    expect(fs.existsSync(path.join(outputDir, 'src', 'main.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'package.json'))).toBe(true);
  });

  it('scenario2: memory search sees records saved across turns', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-e2e-p2-mem-'));
    const dbPath = path.join(root, 'memory.db');
    const project = '/repo/demo';

    const before = await runCliJson([
      'memory',
      'search',
      '--query',
      'websocket',
      '--project',
      project,
      '--db',
      dbPath,
    ]);
    expect(before.code).toBe(0);
    const beforePayload = before.json as {
      type: string;
      action: string;
      results: unknown[];
    };
    expect(beforePayload.type).toBe('memory');
    expect(beforePayload.action).toBe('search');
    expect(beforePayload.results).toHaveLength(0);

    const manager = new MemoryManager({
      dbPath,
      defaultProject: project,
      allowExternalDbPath: true,
    });
    manager.save('implemented websocket reconnect', 'Reconnect logic', {
      project,
      filesModified: ['src/ws.ts'],
      type: 'decision',
      promptNumber: 1,
    });
    manager.close();

    const after = await runCliJson([
      'memory',
      'search',
      '--query',
      'websocket',
      '--project',
      project,
      '--db',
      dbPath,
    ]);
    expect(after.code).toBe(0);
    const afterPayload = after.json as {
      type: string;
      action: string;
      results: Array<{ id: string }>;
    };
    expect(afterPayload.type).toBe('memory');
    expect(afterPayload.action).toBe('search');
    expect(afterPayload.results.length).toBeGreaterThanOrEqual(1);
  });

  it('scenario3: aider style plugin edits multi files and git diff is present', async () => {
    const root = makeWorkspaceTemp('xifan-e2e-p2-aider');
    const repo = path.join(root, 'repo');
    const pluginScript = path.join(root, 'aider-plugin.mjs');
    const configPath = path.join(root, 'plugins.json');
    const globalDir = path.join(root, 'global');
    const projectDir = path.join(root, 'project');
    const nodeModulesDir = path.join(root, 'node_modules');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'b.ts'), 'export const b = 2;\n', 'utf8');
    execSync('git init -q', { cwd: repo });
    execSync('git config user.email "bot@example.com"', { cwd: repo });
    execSync('git config user.name "bot"', { cwd: repo });
    execSync('git add . && git commit -m "init" -q', { cwd: repo });

    writeExecutableScript(
      pluginScript,
      [
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "import readline from 'node:readline';",
        "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'for await (const line of rl) {',
        '  const req = JSON.parse(line);',
        "  if (req.method === 'plugin/init') {",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: ['aider_edit'] } }));",
        "  } else if (req.method === 'plugin/executeTool') {",
        '    const files = req.params.args?.files ?? [];',
        '    for (const file of files) {',
        '      const full = path.isAbsolute(file) ? file : path.join(process.cwd(), file);',
        "      fs.appendFileSync(full, '// edited by aider plugin\\n', 'utf8');",
        '    }',
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { content: { changedFiles: files } } }));",
        "  } else if (req.method === 'plugin/destroy') {",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }));",
        '    process.exit(0);',
        '  }',
        '}',
      ].join('\n'),
    );

    writePluginConfig(configPath, {
      name: 'aider',
      command: process.execPath,
      args: [pluginScript],
      permissionLevel: 1,
    });

    const run = await runCliJson([
      'plugin-exec',
      '--plugin',
      'aider',
      '--tool',
      'aider_edit',
      '--args-json',
      JSON.stringify({
        files: [path.join(repo, 'a.ts'), path.join(repo, 'b.ts')],
        instruction: 'append comments',
      }),
      '--allow-write',
      '--yes',
      '--global',
      globalDir,
      '--project',
      projectDir,
      '--node-modules',
      nodeModulesDir,
      '--config',
      configPath,
    ]);

    expect(run.code).toBe(0);
    const diffNames = execSync('git diff --name-only', { cwd: repo, encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
    expect(diffNames).toContain('a.ts');
    expect(diffNames).toContain('b.ts');
  });

  it('scenario4: plugin crash recovery reloads process and continues', async () => {
    const root = makeWorkspaceTemp('xifan-e2e-p2-crash');
    const pluginScript = path.join(root, 'crashy-plugin.mjs');
    const marker = path.join(root, '.crashed-once');
    const configPath = path.join(root, 'plugins.json');
    const globalDir = path.join(root, 'global');
    const projectDir = path.join(root, 'project');
    const nodeModulesDir = path.join(root, 'node_modules');

    writeExecutableScript(
      pluginScript,
      [
        "import fs from 'node:fs';",
        "import readline from 'node:readline';",
        'const marker = process.argv[2];',
        "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'for await (const line of rl) {',
        '  const req = JSON.parse(line);',
        "  if (req.method === 'plugin/init') {",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: ['crashy_tool'] } }));",
        "  } else if (req.method === 'plugin/executeTool') {",
        '    if (!marker || !fs.existsSync(marker)) {',
        "      if (marker) fs.writeFileSync(marker, '1', 'utf8');",
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

    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          plugins: [
            {
              name: 'crashy',
              version: '1.0.0',
              description: 'crashy plugin',
              type: 'stdio',
              command: process.execPath,
              args: [pluginScript, marker],
              enabled: true,
              requireConfirmation: false,
              permissionLevel: 0,
              timeout: 5_000,
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const run = await runCliJson([
      'plugin-exec',
      '--plugin',
      'crashy',
      '--tool',
      'crashy_tool',
      '--args-json',
      '{}',
      '--global',
      globalDir,
      '--project',
      projectDir,
      '--node-modules',
      nodeModulesDir,
      '--config',
      configPath,
    ]);

    expect(run.code).toBe(0);
    const payload = run.json as {
      type: string;
      executed: boolean;
      result?: { content?: { recovered?: boolean } };
    };
    expect(payload.type).toBe('plugin-exec');
    expect(payload.executed).toBe(true);
    expect(payload.result?.content?.recovered).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('scenario5: /tools lists crush_* tools when crush is available', async () => {
    const root = makeWorkspaceTemp('xifan-e2e-p2-crush');
    const fakeCrush = path.join(root, 'fake-crush.sh');
    writeExecutableScript(
      fakeCrush,
      ['#!/bin/sh', 'if [ "$1" = "--version" ]; then exit 0; fi', 'exit 1'].join('\n'),
    );

    const run = await runCliJson([
      '/tools',
      '--crush-cmd',
      fakeCrush,
    ]);
    expect(run.code).toBe(0);
    const payload = run.json as {
      type: string;
      crushAvailable: boolean;
      tools: Array<{ name: string; source: string }>;
    };
    expect(payload.type).toBe('tools');
    expect(payload.crushAvailable).toBe(true);
    expect(payload.tools.some((tool) => tool.name === 'crush_search' && tool.source === 'crush')).toBe(
      true,
    );
  });

  it('scenario6: /memory open serves on ephemeral port when socket binding is permitted', async () => {
    const port = 49177;
    let server: Server | undefined;

    const command = parseCliArgs([
      '/memory',
      'open',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--db',
      ':memory:',
    ]);
    expect(command.type).toBe('memory');

    let result:
      | {
          type: 'memory';
          action: 'open';
          started: boolean;
          host: string;
          port: number;
          url: string;
        }
      | undefined;
    try {
      const output = await executeCommandDetailed(command, {
        createMemoryViewer: () => {
          return {
            start: async () => {
              server = createServer((_request, response) => {
                response.writeHead(200, {
                  'content-type': 'application/json; charset=utf-8',
                });
                response.end(JSON.stringify({ ok: true }));
              });
              await new Promise<void>((resolve, reject) => {
                server?.once('error', reject);
                server?.listen(port, '127.0.0.1', () => resolve());
              });
              return {
                started: true,
                host: '127.0.0.1',
                port,
                url: `http://127.0.0.1:${port}`,
              };
            },
            stop: async () => {
              await new Promise<void>((resolve) => {
                server?.close(() => resolve());
              });
            },
          };
        },
      });

      if (output.type !== 'memory' || output.action !== 'open') {
        throw new Error('memory open result mismatch');
      }
      result = output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('EPERM')) {
        // Sandbox may disallow local socket binding; in unrestricted CI this path should run fully.
        return;
      }
      throw error;
    }

    if (!result) {
      throw new Error('memory open did not return result');
    }
    expect(result.started).toBe(true);
    expect(result.port).toBe(port);
    expect(result.url).toBe(`http://127.0.0.1:${port}`);

    const response = await fetch(result.url);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"ok":true');

    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });
});
