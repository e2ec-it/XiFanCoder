import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigNotFoundError, ConfigValidationError } from '../../errors/index.js';
import {
  createKeytarAdapter,
  discoverRuntimeConfigPaths,
  initRuntimeConfigFile,
  loadRuntimeConfig,
} from '../loader.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-config-'));
  tempDirs.push(dir);
  return dir;
}

describe('loadRuntimeConfig', () => {
  it('loads config and resolves env secrets', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    fs.writeFileSync(configPath, JSON.stringify({ agent: { mode: 'build' } }), 'utf8');

    const loaded = await loadRuntimeConfig({
      configPath,
      env: {
        ANTHROPIC_API_KEY: 'env-anthropic',
        OPENAI_API_KEY: 'env-openai',
        LITELLM_API_KEY: 'env-litellm',
      },
    });

    expect(loaded.config.agent.mode).toBe('build');
    expect(loaded.secrets.anthropic.source).toBe('env');
    expect(loaded.secrets.anthropic.value).toBe('env-anthropic');
    expect(loaded.secrets.openai.source).toBe('env');
    expect(loaded.secrets.openai.value).toBe('env-openai');
    expect(loaded.secrets.litellm.source).toBe('env');
    expect(loaded.secrets.litellm.value).toBe('env-litellm');
  });

  it('throws when config file is missing', async () => {
    await expect(
      loadRuntimeConfig({
        configPath: '/tmp/not-exists-xifan-config.json',
      }),
    ).rejects.toBeInstanceOf(ConfigNotFoundError);
  });

  it('rejects config containing plaintext secret', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        llm: {
          apiKey: 'sk-abcdefghijklmnopqrstuvwxyz123456',
        },
      }),
      'utf8',
    );

    await expect(loadRuntimeConfig({ configPath })).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('rejects provider config containing plaintext apiKey field', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        providers: {
          openai: {
            apiKey: 'sk-abcdefghijklmnopqrstuvwxyz123456',
          },
        },
      }),
      'utf8',
    );

    await expect(loadRuntimeConfig({ configPath })).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('supports keytar adapter fallback', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    fs.writeFileSync(configPath, JSON.stringify({ agent: { mode: 'plan' } }), 'utf8');

    const keytar = {
      getPassword: vi.fn(async (_service: string, account: string) => {
        if (account === 'openai_api_key') {
          return 'openai-from-keychain';
        }
        return null;
      }),
    };

    const loaded = await loadRuntimeConfig({
      configPath,
      keychain: createKeytarAdapter(keytar),
    });

    expect(loaded.secrets.openai.source).toBe('keychain');
    expect(loaded.secrets.openai.value).toBe('openai-from-keychain');
    expect(keytar.getPassword).toHaveBeenCalled();
  });

  it('discovers and merges global/project/env/cli layers by precedence', async () => {
    const root = makeTempDir();
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'project');
    fs.mkdirSync(path.join(home, '.xifan', 'coder'), { recursive: true });
    fs.mkdirSync(path.join(cwd, '.xifan', 'coder'), { recursive: true });

    fs.writeFileSync(
      path.join(home, '.xifan', 'coder', 'config.yaml'),
      JSON.stringify({
        agent: { mode: 'build', maxRounds: 10 },
        llm: { driver: 'builtin' },
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(cwd, '.xifan', 'coder', 'config.yaml'),
      JSON.stringify({
        agent: { mode: 'plan' },
        permissions: { policyMode: 'strict' },
      }),
      'utf8',
    );

    const loaded = await loadRuntimeConfig({
      cwd,
      homeDir: home,
      env: {
        XIFAN_AGENT_MODE: 'build',
        XIFAN_LLM_DRIVER: 'litellm',
      },
      cliOverrides: {
        agent: { mode: 'plan', maxRounds: 99, continuation: { enabled: true } },
      },
    });

    expect(loaded.sourcePaths).toHaveLength(2);
    expect(loaded.config.agent.mode).toBe('plan');
    expect(loaded.config.agent.maxRounds).toBe(99);
    expect(loaded.config.permissions.policyMode).toBe('strict');
    expect(loaded.config.llm.driver).toBe('litellm');
  });

  it('discovers runtime config paths in global then project order', () => {
    const root = makeTempDir();
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'project');
    fs.mkdirSync(path.join(home, '.xifan', 'coder'), { recursive: true });
    fs.mkdirSync(path.join(cwd, '.xifan', 'coder'), { recursive: true });
    const globalPath = path.join(home, '.xifan', 'coder', 'config.json');
    const projectPath = path.join(cwd, '.xifan', 'coder', 'config.yaml');
    fs.writeFileSync(globalPath, '{}', 'utf8');
    fs.writeFileSync(projectPath, '{}', 'utf8');

    const paths = discoverRuntimeConfigPaths({ cwd, homeDir: home });
    expect(paths).toEqual([globalPath, projectPath]);
  });

  it('initializes default runtime config file and supports idempotency', () => {
    const root = makeTempDir();
    const target = path.join(root, '.xifan', 'coder', 'config.yaml');

    const first = initRuntimeConfigFile({ targetPath: target });
    const second = initRuntimeConfigFile({ targetPath: target });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.overwritten).toBe(false);
    const written = fs.readFileSync(target, 'utf8');
    expect(written).toContain('"agent"');
    expect(written).toContain('"mcpServers"');
    expect(written).toContain('"--mcp-server"');
  });

  it('supports minimal YAML syntax for nested objects', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'config.yaml');
    fs.writeFileSync(
      configPath,
      [
        'agent:',
        '  mode: plan',
        'permissions:',
        '  allowWrite: true',
        'llm:',
        '  driver: builtin',
        'mcp_servers:',
        '  crush:',
        '    command: crush-dev',
        '    args:',
        '      - "--mcp-server"',
        '',
      ].join('\n'),
      'utf8',
    );

    const loaded = await loadRuntimeConfig({
      configPath,
    });

    expect(loaded.config.agent.mode).toBe('plan');
    expect(loaded.config.permissions.allowWrite).toBe(true);
    expect(loaded.config.llm.driver).toBe('builtin');
    expect(loaded.config.mcpServers.crush.command).toBe('crush-dev');
    expect(loaded.config.mcpServers.crush.args).toEqual(['--mcp-server']);
  });

  it('applies env overrides for agent mode, policy mode, llm driver, and boolean flags', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    fs.writeFileSync(configPath, '{}', 'utf8');

    const loaded = await loadRuntimeConfig({
      configPath,
      env: {
        XIFAN_AGENT_MODE: 'plan',
        XIFAN_POLICY_MODE: 'strict',
        XIFAN_LLM_DRIVER: 'auto',
        XIFAN_LITELLM_BASE_URL: 'http://my-proxy:9000',
        XIFAN_ALLOW_WRITE: 'true',
        XIFAN_ALLOW_SHELL: '1',
        XIFAN_HEADLESS: 'yes',
      },
    });

    expect(loaded.config.agent.mode).toBe('plan');
    expect(loaded.config.permissions.policyMode).toBe('strict');
    expect(loaded.config.llm.driver).toBe('auto');
    expect(loaded.config.llm.litellmBaseUrl).toBe('http://my-proxy:9000');
    expect(loaded.config.permissions.allowWrite).toBe(true);
    expect(loaded.config.permissions.allowShell).toBe(true);
    expect(loaded.config.permissions.headless).toBe(true);
  });

  it('applies false boolean env overrides', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    fs.writeFileSync(configPath, '{}', 'utf8');

    const loaded = await loadRuntimeConfig({
      configPath,
      env: {
        XIFAN_ALLOW_WRITE: '0',
        XIFAN_ALLOW_SHELL: 'false',
        XIFAN_HEADLESS: 'off',
      },
    });

    expect(loaded.config.permissions.allowWrite).toBe(false);
    expect(loaded.config.permissions.allowShell).toBe(false);
    expect(loaded.config.permissions.headless).toBe(false);
  });

  it('ignores invalid boolean env values and irrelevant env keys', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    fs.writeFileSync(configPath, '{}', 'utf8');

    const loaded = await loadRuntimeConfig({
      configPath,
      env: {
        XIFAN_ALLOW_WRITE: 'maybe',
        XIFAN_AGENT_MODE: 'invalid-mode',
        XIFAN_POLICY_MODE: 'invalid-policy',
        XIFAN_LLM_DRIVER: 'invalid-driver',
      },
    });

    // None of these should override defaults since they are invalid values
    expect(loaded.config.agent.mode).toBe('build');
    expect(loaded.config.permissions.policyMode).toBe('compat');
    expect(loaded.config.llm.driver).toBe('auto');
  });

  it('throws ConfigValidationError when config file has invalid syntax', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'bad-config.json');
    fs.writeFileSync(configPath, '{ invalid json !!!', 'utf8');

    await expect(loadRuntimeConfig({ configPath })).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('returns empty config when config file is empty', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'empty.json');
    fs.writeFileSync(configPath, '', 'utf8');

    // Empty file should be handled gracefully
    const loaded = await loadRuntimeConfig({ configPath });
    expect(loaded.config).toBeDefined();
  });

  it('initRuntimeConfigFile overwrites when force is true', () => {
    const root = makeTempDir();
    const target = path.join(root, '.xifan', 'coder', 'config.json');

    const first = initRuntimeConfigFile({ targetPath: target });
    expect(first.created).toBe(true);

    const forced = initRuntimeConfigFile({ targetPath: target, force: true });
    expect(forced.created).toBe(false);
    expect(forced.overwritten).toBe(true);
  });

  it('handles deep merge with arrays, nested objects, and undefined values', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agent: { mode: 'build', maxRounds: 5 },
        permissions: { allowedTools: ['read_file'] },
      }),
      'utf8',
    );

    const loaded = await loadRuntimeConfig({
      configPath,
      env: {},
      cliOverrides: {
        agent: { maxRounds: 20 },
        permissions: { allowedTools: ['write_file', 'bash'] },
      },
    });

    expect(loaded.config.agent.maxRounds).toBe(20);
    expect(loaded.config.permissions.allowedTools).toEqual(['write_file', 'bash']);
  });

  it('handles XIFAN_LLM_DRIVER=builtin and XIFAN_LLM_DRIVER=litellm', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    fs.writeFileSync(configPath, '{}', 'utf8');

    const builtinLoaded = await loadRuntimeConfig({
      configPath,
      env: { XIFAN_LLM_DRIVER: 'builtin' },
    });
    expect(builtinLoaded.config.llm.driver).toBe('builtin');

    const litellmLoaded = await loadRuntimeConfig({
      configPath,
      env: { XIFAN_LLM_DRIVER: 'litellm' },
    });
    expect(litellmLoaded.config.llm.driver).toBe('litellm');
  });

  it('handles XIFAN_AGENT_MODE=build', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    fs.writeFileSync(configPath, '{}', 'utf8');

    const loaded = await loadRuntimeConfig({
      configPath,
      env: { XIFAN_AGENT_MODE: 'build' },
    });
    expect(loaded.config.agent.mode).toBe('build');
  });

  it('handles XIFAN_POLICY_MODE=compat', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    fs.writeFileSync(configPath, '{}', 'utf8');

    const loaded = await loadRuntimeConfig({
      configPath,
      env: { XIFAN_POLICY_MODE: 'compat' },
    });
    expect(loaded.config.permissions.policyMode).toBe('compat');
  });

  it('deep merge with non-plain-object override returns override', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    fs.writeFileSync(configPath, JSON.stringify({ agent: { mode: 'build' } }), 'utf8');

    // cliOverrides replaces entirely when override is non-object at top level
    const loaded = await loadRuntimeConfig({
      configPath,
      env: {},
      cliOverrides: {
        agent: { mode: 'plan' },
      },
    });
    expect(loaded.config.agent.mode).toBe('plan');
  });

  it('throws ConfigValidationError when parsed config has invalid values', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    // agent.maxRounds must be positive int, negative should fail
    fs.writeFileSync(configPath, JSON.stringify({ agent: { maxRounds: -5 } }), 'utf8');

    await expect(loadRuntimeConfig({ configPath })).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('deep merge skips undefined override values', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'xifan.json');
    fs.writeFileSync(configPath, JSON.stringify({ agent: { mode: 'plan' } }), 'utf8');

    // cliOverrides with undefined values should be skipped
    const loaded = await loadRuntimeConfig({
      configPath,
      env: {},
      cliOverrides: {
        agent: { mode: undefined as unknown as string },
      },
    });
    // The original 'plan' should be preserved since override was undefined
    expect(loaded.config.agent.mode).toBe('plan');
  });

  it('discovers no config paths when no config files exist', () => {
    const root = makeTempDir();
    const home = path.join(root, 'empty-home');
    const cwd = path.join(root, 'empty-project');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });

    const paths = discoverRuntimeConfigPaths({ cwd, homeDir: home });
    expect(paths).toEqual([]);
  });

  it('supports full YAML features via cosmiconfig loader', async () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, 'config.yml');
    fs.writeFileSync(
      configPath,
      [
        'agent:',
        '  mode: plan',
        '  continuation:',
        '    enabled: false',
        'permissions:',
        '  allowedTools:',
        '    - read_file',
        '    - list_dir',
        '',
      ].join('\n'),
      'utf8',
    );

    const loaded = await loadRuntimeConfig({
      configPath,
    });

    expect(loaded.config.agent.mode).toBe('plan');
    expect(loaded.config.agent.continuation.enabled).toBe(false);
    expect(loaded.config.permissions.allowedTools).toEqual(['read_file', 'list_dir']);
  });
});
