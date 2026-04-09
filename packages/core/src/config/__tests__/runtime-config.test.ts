import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig } from '../runtime-config.js';

describe('runtime config schema', () => {
  it('fills defaults for empty input', () => {
    const cfg = parseRuntimeConfig({});

    expect(cfg.agent.mode).toBe('build');
    expect(cfg.agent.maxRounds).toBe(50);
    expect(cfg.permissions.policyMode).toBe('compat');
    expect(cfg.providers.catalogSource).toBe('embedded');
    expect(cfg.skills.enabled).toBe(true);
    expect(cfg.lsp.enabled).toBe(true);
    expect(cfg.security.promptInjection.mode).toBe('warn');
    expect(cfg.llm.driver).toBe('auto');
    expect(cfg.llm.litellmBaseUrl).toBe('http://localhost:4000');
    expect(cfg.mcpServers.crush.enabled).toBe(true);
    expect(cfg.mcpServers.crush.transport).toBe('stdio');
    expect(cfg.mcpServers.crush.command).toBe('crush');
    expect(cfg.mcpServers.crush.args).toEqual(['--mcp-server']);
  });

  it('parses custom overrides and mcp_servers alias', () => {
    const cfg = parseRuntimeConfig({
      agent: { mode: 'plan', maxRounds: 20 },
      permissions: {
        headless: true,
        policyMode: 'strict',
        allowedTools: ['read_file'],
        deniedTools: ['bash_execute'],
      },
      providers: { catalogSource: 'https://example.com/catalog.json' },
      skills: { enabled: false, roots: ['/tmp/skills'] },
      lsp: { enabled: false, languages: [] },
      security: {
        promptInjection: {
          mode: 'block',
        },
      },
      llm: { driver: 'litellm', litellmBaseUrl: 'http://localhost:4000/v1' },
      mcp_servers: {
        crush: {
          enabled: false,
          command: 'crush-dev',
          args: ['--mcp-server', '--stdio'],
        },
      },
    });

    expect(cfg.agent.mode).toBe('plan');
    expect(cfg.permissions.headless).toBe(true);
    expect(cfg.permissions.policyMode).toBe('strict');
    expect(cfg.permissions.allowedTools).toEqual(['read_file']);
    expect(cfg.providers.catalogSource).toBe('https://example.com/catalog.json');
    expect(cfg.skills.enabled).toBe(false);
    expect(cfg.lsp.enabled).toBe(false);
    expect(cfg.security.promptInjection.mode).toBe('block');
    expect(cfg.llm.driver).toBe('litellm');
    expect(cfg.llm.litellmBaseUrl).toBe('http://localhost:4000/v1');
    expect(cfg.mcpServers.crush.enabled).toBe(false);
    expect(cfg.mcpServers.crush.command).toBe('crush-dev');
    expect(cfg.mcpServers.crush.args).toEqual(['--mcp-server', '--stdio']);
  });

  it('rejects invalid mode', () => {
    expect(() => parseRuntimeConfig({ agent: { mode: 'invalid' } })).toThrowError();
  });

  it('fills defaults when input is null or undefined', () => {
    const cfgNull = parseRuntimeConfig(null);
    expect(cfgNull.agent.mode).toBe('build');

    const cfgUndefined = parseRuntimeConfig(undefined);
    expect(cfgUndefined.agent.mode).toBe('build');
  });
});
