import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createDefaultSlashRouter,
  createInitialReplState,
  updateUsageSummary,
} from '../slash-router.js';

function writeExecutableScript(filePath: string, code: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, code, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

describe('SlashCommandRouter', () => {
  it('detects slash command and rejects unknown command', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    expect(router.isSlashCommand('/help')).toBe(true);
    expect(router.isSlashCommand('plain message')).toBe(false);

    const out = await router.dispatch('/unknown', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('error');
    expect(out.message).toContain('/unknown');
    expect(prints).toHaveLength(0);
  });

  it('supports /model, /style, /cost, /undo and /compact mutations', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    await router.dispatch('/model gpt-4o', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });
    expect(state.model).toBe('gpt-4o');

    await router.dispatch('/style concise', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });
    expect(state.outputStyle).toBe('concise');

    await router.dispatch('/style', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });
    expect(prints.join('\n')).toContain('style=concise');

    state.turns.push({ role: 'user', content: 'u1' });
    state.turns.push({ role: 'assistant', content: 'a1' });
    state.turns.push({ role: 'user', content: 'u2' });
    state.turns.push({ role: 'assistant', content: 'a2' });
    updateUsageSummary(state, {
      userText: 'u1 u2',
      assistantText: 'a1 a2',
    });

    await router.dispatch('/cost', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });
    expect(prints.join('\n')).toContain('prompt_tokens=');
    expect(prints.join('\n')).toContain('cost_usd=$');

    await router.dispatch('/undo', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });
    expect(state.turns).toHaveLength(2);

    for (let i = 0; i < 8; i += 1) {
      state.turns.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg-${i}` });
    }
    await router.dispatch('/compact', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });
    expect(state.turns[0]?.content).toContain('[compact-summary]');
  });

  it('runs /init to create project context file', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-router-'));
    const prints: string[] = [];

    await router.dispatch('/init --force', {
      state,
      cwd: root,
      print: (line) => {
        prints.push(line);
      },
    });

    expect(fs.existsSync(path.join(root, '.xifan', 'XIFAN.md'))).toBe(true);
    expect(prints.join('\n')).toContain('action=init');
  });

  it('runs /plugin list with explicit search paths', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-router-plugin-list-'));
    const globalDir = path.join(root, 'global');
    const projectDir = path.join(root, 'project');
    const nodeModulesDir = path.join(root, 'node_modules');
    const configPath = path.join(root, 'plugins.json');
    const prints: string[] = [];

    fs.mkdirSync(globalDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.writeFileSync(
      configPath,
      `${JSON.stringify({ plugins: [] }, null, 2)}\n`,
      'utf8',
    );

    const out = await router.dispatch(
      `/plugin list --global ${globalDir} --project ${projectDir} --node-modules ${nodeModulesDir} --config ${configPath}`,
      {
        state,
        cwd: root,
        print: (line) => {
          prints.push(line);
        },
      },
    );

    expect(out.type).toBe('success');
    expect(prints.join('\n')).toContain('plugins=0');
  });

  it('runs /memory search and prints structured result', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch('/memory search --query auth --db :memory:', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('success');
    expect(prints.join('\n')).toContain('action=search');
    expect(prints.join('\n')).toContain('count=0');
  });

  it.skipIf(process.platform === 'win32')('runs /plugin <name> <args> through plugin-exec', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    state.mode = 'plan';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-router-plugin-exec-'));
    const script = path.join(root, 'echo-plugin.mjs');
    const configPath = path.join(root, 'plugins.json');
    const prints: string[] = [];

    writeExecutableScript(
      script,
      [
        "import readline from 'node:readline';",
        "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'for await (const line of rl) {',
        '  const req = JSON.parse(line);',
        "  if (req.method === 'plugin/init') {",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: ['echo'] } }));",
        "  } else if (req.method === 'plugin/executeTool') {",
        "    const payload = { echoed: req.params.args?.message ?? req.params.args?.input ?? null };",
        "    console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { content: payload } }));",
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
              name: 'echo',
              version: '1.0.0',
              description: 'echo plugin',
              type: 'stdio',
              command: process.execPath,
              args: [script],
              enabled: true,
              requireConfirmation: false,
              permissionLevel: 0,
              timeout: 2_000,
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const out = await router.dispatch(
      `/plugin echo {"message":"hello-router"} --config ${configPath} --global ${path.join(root, 'global')} --project ${path.join(root, 'project')} --node-modules ${path.join(root, 'node_modules')}`,
      {
        state,
        cwd: root,
        print: (line) => {
          prints.push(line);
        },
      },
    );

    expect(out.type).toBe('success');
    expect(prints.join('\n')).toContain('plugin=echo');
    expect(prints.join('\n')).toContain('executed=true');
    expect(prints.join('\n')).toContain('"echoed":"hello-router"');
  });

  it('runs /tools and falls back to builtin tools when crush is unavailable', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch('/tools --crush-cmd /tmp/not-installed-crush', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('success');
    expect(prints.join('\n')).toContain('tools=5');
    expect(prints.join('\n')).toContain('crushAvailable=false');
    expect(prints.join('\n')).not.toContain('[crush]');
  });

  it('returns all unique commands sorted from getAllCommands', () => {
    const router = createDefaultSlashRouter();
    const all = router.getAllCommands();
    expect(all.length).toBeGreaterThan(0);
    // Verify sorted
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1]!.name.localeCompare(all[i]!.name)).toBeLessThanOrEqual(0);
    }
    // Verify uniqueness by name
    const names = all.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('dispatch returns noop for non-slash input', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const out = await router.dispatch('plain text', {
      state,
      cwd: process.cwd(),
      print: () => {},
    });
    expect(out).toEqual({ type: 'noop' });
  });

  it('dispatch returns error for empty slash command', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const out = await router.dispatch('/', {
      state,
      cwd: process.cwd(),
      print: () => {},
    });
    expect(out.type).toBe('error');
    expect(out.message).toContain('/help');
  });

  it('dispatch returns error for whitespace-only slash command', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const out = await router.dispatch('/   ', {
      state,
      cwd: process.cwd(),
      print: () => {},
    });
    expect(out.type).toBe('error');
    expect(out.message).toContain('/help');
  });

  it('runs /help and prints help text', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch('/help', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('success');
    expect(prints.join('\n')).toContain('/help');
    expect(prints.join('\n')).toContain('/exit');
  });

  it('runs /mode with invalid value and returns error', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch('/mode invalid', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('error');
    expect(out.message).toContain('build');
    expect(out.message).toContain('plan');
  });

  it('runs /model with no args to get current model', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch('/model', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('success');
    expect(prints.join('\n')).toContain(`model=${state.model}`);
  });

  it('runs /undo with no turns and returns error', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch('/undo', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('error');
    expect(out.message).toContain('没有可撤销');
  });

  it('runs /compact with few turns and does not compact', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    state.turns.push({ role: 'user', content: 'u1' });
    state.turns.push({ role: 'assistant', content: 'a1' });
    const prints: string[] = [];

    const out = await router.dispatch('/compact', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('success');
    expect(prints.join('\n')).toContain('history_compacted=false');
    expect(state.turns).toHaveLength(2);
  });

  it('runs /memory with no args and returns error', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch('/memory', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('error');
    expect(out.message).toContain('/memory search');
  });

  it('runs /plugin with no args and returns error', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch('/plugin', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('error');
    expect(out.message).toContain('/plugin list');
  });

  it('runs /memory with invalid subcommand and returns parse error', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch('/memory invalid', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('error');
    expect(out.message).toContain('Unknown memory subcommand');
  });

  it('runs /plugin with parse error returns error message', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    // Trigger an error through conflicting flags
    const out = await router.dispatch('/plugin safe --yes --no', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('error');
    expect(out.message).toContain('mutually exclusive');
  });

  it('runs /mode get (no args) to read current mode', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch('/mode', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('success');
    expect(prints.join('\n')).toContain('action=get');
  });

  it('runs /mode set build', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch('/mode build', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('success');
    expect(state.mode).toBe('build');
    expect(prints.join('\n')).toContain('action=set');
  });

  it('runs /mode set plan', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch('/mode plan', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('success');
    expect(state.mode).toBe('plan');
  });

  it('splitSlashArgs handles quoted args with /memory search', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    // Use quoted args to trigger splitSlashArgs quote handling
    const out = await router.dispatch('/memory search --query "auth flow" --db :memory:', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('success');
    expect(prints.join('\n')).toContain('action=search');
  });

  it('splitSlashArgs handles single-quoted args', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch("/memory search --query 'my query' --db :memory:", {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('success');
    expect(prints.join('\n')).toContain('action=search');
  });

  it('splitSlashArgs handles escaped characters', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    // Use backslash escape to trigger escaping logic
    const out = await router.dispatch('/memory search --query auth\\ flow --db :memory:', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('success');
    expect(prints.join('\n')).toContain('action=search');
  });

  it('splitSlashArgs handles trailing backslash', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();

    // Trailing backslash triggers the escaping + end-of-input path in splitSlashArgs.
    // Use /mode (no FTS5/SQLite) to avoid cross-platform issues with special chars in queries.
    const out = await router.dispatch('/mode set build\\', {
      state,
      cwd: process.cwd(),
      print: () => {},
    });

    // 'build\' is not a valid mode, so it returns an error — but the trailing
    // backslash path in splitSlashArgs has been exercised.
    expect(out.type).toBe('error');
  });

  it('uses /m alias for /model', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    const out = await router.dispatch('/m gpt-4o-mini', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('success');
    expect(state.model).toBe('gpt-4o-mini');
  });

  it.skipIf(process.platform === 'win32')('runs /tools and marks crush-sourced tools when crush is available', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-router-tools-'));
    const fakeCrush = path.join(root, 'fake-crush.sh');
    const prints: string[] = [];

    writeExecutableScript(
      fakeCrush,
      ['#!/bin/sh', 'if [ "$1" = "--version" ]; then exit 0; fi', 'exit 1'].join('\n'),
    );

    const out = await router.dispatch(`/tools --crush-cmd ${fakeCrush}`, {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(out.type).toBe('success');
    expect(prints.join('\n')).toContain('crushAvailable=true');
    expect(prints.join('\n')).toContain('[crush] crush_file_read');
  });
});
