import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../parse.js';

describe('parseCliArgs', () => {
  it('parses help command for empty args', () => {
    expect(parseCliArgs([])).toEqual({ type: 'help' });
  });

  it('parses check-tool command', () => {
    const cmd = parseCliArgs([
      'check-tool',
      '--tool',
      'write_file',
      '--level',
      'L1',
      '--mode',
      'plan',
      '--headless',
      '--allowed-tools',
      'read_file,write_file',
      '--denied-tools',
      'bash_execute',
      '--policy-mode',
      'strict',
    ]);

    expect(cmd.type).toBe('check-tool');
    if (cmd.type === 'check-tool') {
      expect(cmd.toolName).toBe('write_file');
      expect(cmd.level).toBe('L1');
      expect(cmd.mode).toBe('plan');
      expect(cmd.headless).toBe(true);
      expect(cmd.allowedTools).toEqual(['read_file', 'write_file']);
      expect(cmd.deniedTools).toEqual(['bash_execute']);
      expect(cmd.policyMode).toBe('strict');
      expect(cmd.dangerouslySkipPermissions).toBe(false);
    }
  });

  it('parses check-tool dangerously skip permissions flag', () => {
    const cmd = parseCliArgs([
      'check-tool',
      '--tool',
      'bash_execute',
      '--level',
      'L2',
      '--dangerously-skip-permissions',
    ]);

    expect(cmd.type).toBe('check-tool');
    if (cmd.type === 'check-tool') {
      expect(cmd.dangerouslySkipPermissions).toBe(true);
    }
  });

  it('parses provider-update command', () => {
    const cmd = parseCliArgs(['provider-update', 'embedded', '--target', '/tmp/catalog.json']);

    expect(cmd).toEqual({
      type: 'provider-update',
      source: 'embedded',
      targetPath: '/tmp/catalog.json',
    });
  });

  it('parses resolve-llm-driver command', () => {
    const cmd = parseCliArgs([
      'resolve-llm-driver',
      '--driver',
      'auto',
      '--litellm-url',
      'http://localhost:4000',
      '--yes',
    ]);

    expect(cmd).toEqual({
      type: 'resolve-llm-driver',
      mode: 'auto',
      headless: false,
      litellmBaseUrl: 'http://localhost:4000',
      confirm: 'yes',
    });
  });

  it('parses tools command with custom crush binary', () => {
    const cmd = parseCliArgs(['tools', '--crush-cmd', 'crush-dev']);
    expect(cmd).toEqual({
      type: 'tools',
      crushCommand: 'crush-dev',
    });
  });

  it('parses /tools alias with default crush binary', () => {
    const cmd = parseCliArgs(['/tools']);
    expect(cmd).toEqual({
      type: 'tools',
      crushCommand: 'crush',
    });
  });

  it('rejects conflicting confirmation flags', () => {
    expect(() =>
      parseCliArgs(['resolve-llm-driver', '--yes', '--no']),
    ).toThrowError('Flags --yes and --no are mutually exclusive');
  });

  it('parses mode get command', () => {
    const cmd = parseCliArgs(['mode', 'get', '--store', '/tmp/mode.json']);
    expect(cmd).toEqual({
      type: 'mode',
      action: 'get',
      storePath: '/tmp/mode.json',
    });
  });

  it('parses mode set command', () => {
    const cmd = parseCliArgs(['/mode', 'set', 'plan']);
    expect(cmd).toEqual({
      type: 'mode',
      action: 'set',
      value: 'plan',
      storePath: undefined,
    });
  });

  it('rejects invalid mode value', () => {
    expect(() => parseCliArgs(['mode', 'set', 'invalid'])).toThrowError(
      'Invalid mode value: invalid',
    );
  });

  it('parses lsp diagnostics command', () => {
    const cmd = parseCliArgs([
      'lsp',
      'diagnostics',
      '--file',
      'src/a.ts',
      '--language',
      'typescript',
      '--content',
      'const = 1;',
    ]);

    expect(cmd).toEqual({
      type: 'lsp',
      action: 'diagnostics',
      language: 'typescript',
      filePath: 'src/a.ts',
      content: 'const = 1;',
      rootDir: undefined,
    });
  });

  it('parses lsp rename-preview command', () => {
    const cmd = parseCliArgs([
      '/lsp',
      'rename-preview',
      '--file',
      'src/a.ts',
      '--line',
      '5',
      '--character',
      '3',
      '--new-name',
      'nextName',
      '--root',
      '/tmp/project',
    ]);

    expect(cmd).toEqual({
      type: 'lsp',
      action: 'rename-preview',
      language: 'typescript',
      filePath: 'src/a.ts',
      line: 5,
      character: 3,
      newName: 'nextName',
      rootDir: '/tmp/project',
    });
  });

  it('throws for unknown lsp subcommand', () => {
    expect(() => parseCliArgs(['lsp', 'unknown'])).toThrowError(
      'Unknown lsp subcommand: unknown',
    );
  });

  it('parses daemon ping command', () => {
    const cmd = parseCliArgs([
      'daemon',
      'ping',
      '--host',
      '127.0.0.1',
      '--port',
      '9900',
      '--token',
      'secret',
    ]);

    expect(cmd).toEqual({
      type: 'daemon',
      action: 'ping',
      host: '127.0.0.1',
      port: 9900,
      token: 'secret',
    });
  });

  it('parses daemon serve command', () => {
    const cmd = parseCliArgs([
      'daemon',
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      '9500',
      '--token',
      'secret',
    ]);

    expect(cmd).toEqual({
      type: 'daemon',
      action: 'serve',
      host: '127.0.0.1',
      port: 9500,
      token: 'secret',
    });
  });

  it('parses daemon append command', () => {
    const cmd = parseCliArgs([
      '/daemon',
      'append',
      '--session',
      's1',
      '--content',
      'hello',
      '--token',
      'secret',
      '--role',
      'assistant',
      '--source',
      'desktop',
    ]);

    expect(cmd).toEqual({
      type: 'daemon',
      action: 'append',
      host: '127.0.0.1',
      port: 9321,
      token: 'secret',
      sessionId: 's1',
      content: 'hello',
      role: 'assistant',
      source: 'desktop',
    });
  });

  it('throws for unknown daemon subcommand', () => {
    expect(() => parseCliArgs(['daemon', 'unknown', '--token', 'secret'])).toThrowError(
      'Unknown daemon subcommand: unknown',
    );
  });

  it('parses mcp serve command', () => {
    const cmd = parseCliArgs([
      'mcp',
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      '7890',
      '--path',
      '/mcp',
      '--token-file',
      '/tmp/xifan.session.token',
      '--max-connections',
      '20',
    ]);

    expect(cmd).toEqual({
      type: 'mcp',
      action: 'serve',
      host: '127.0.0.1',
      port: 7890,
      path: '/mcp',
      token: undefined,
      tokenFilePath: '/tmp/xifan.session.token',
      maxConnections: 20,
      requireTls: true,
      tlsKeyPath: undefined,
      tlsCertPath: undefined,
      autoStartMemory: false,
      memoryDbPath: undefined,
    });
  });

  it('allows mcp serve with --no-tls', () => {
    const cmd = parseCliArgs(['mcp', 'serve', '--no-tls']);
    expect(cmd).toEqual({
      type: 'mcp',
      action: 'serve',
      host: '127.0.0.1',
      port: 7890,
      path: '/mcp',
      token: undefined,
      tokenFilePath: undefined,
      maxConnections: 10,
      requireTls: false,
      tlsKeyPath: undefined,
      tlsCertPath: undefined,
      autoStartMemory: false,
      memoryDbPath: undefined,
    });
  });

  it('parses mcp serve auto memory flags', () => {
    const cmd = parseCliArgs(['mcp', 'serve', '--auto-memory', '--memory-db', '/tmp/memory.db']);
    expect(cmd).toEqual({
      type: 'mcp',
      action: 'serve',
      host: '127.0.0.1',
      port: 7890,
      path: '/mcp',
      token: undefined,
      tokenFilePath: undefined,
      maxConnections: 10,
      requireTls: true,
      tlsKeyPath: undefined,
      tlsCertPath: undefined,
      autoStartMemory: true,
      memoryDbPath: '/tmp/memory.db',
    });
  });

  it('requires full custom tls key/cert pair when one path is missing', () => {
    expect(() => parseCliArgs(['mcp', 'serve', '--tls-key', '/tmp/key.pem'])).toThrowError(
      'mcp serve requires both --tls-key and --tls-cert when custom TLS files are used',
    );
  });

  it('throws for unknown mcp subcommand', () => {
    expect(() => parseCliArgs(['mcp', 'invalid'])).toThrowError(
      'Unknown mcp subcommand: invalid',
    );
  });

  it('parses memory serve command', () => {
    const cmd = parseCliArgs([
      'memory',
      'serve',
      '--db',
      '/tmp/xifan-memory.db',
    ]);

    expect(cmd).toEqual({
      type: 'memory',
      action: 'serve',
      dbPath: '/tmp/xifan-memory.db',
    });
  });

  it('parses memory search command', () => {
    const cmd = parseCliArgs([
      'memory',
      'search',
      '--query',
      'auth',
      '--project',
      '/repo/demo',
      '--limit',
      '8',
      '--db',
      '/tmp/xifan-memory.db',
    ]);

    expect(cmd).toEqual({
      type: 'memory',
      action: 'search',
      dbPath: '/tmp/xifan-memory.db',
      query: 'auth',
      project: '/repo/demo',
      limit: 8,
    });
  });

  it('parses /memory open command with defaults', () => {
    const cmd = parseCliArgs(['/memory', 'open']);

    expect(cmd).toEqual({
      type: 'memory',
      action: 'open',
      dbPath: undefined,
      host: '127.0.0.1',
      port: 37777,
    });
  });

  it('throws for unknown memory subcommand', () => {
    expect(() => parseCliArgs(['memory', 'invalid'])).toThrowError(
      'Unknown memory subcommand: invalid',
    );
  });

  it('parses context show command', () => {
    const cmd = parseCliArgs([
      'context',
      'show',
      '--cwd',
      '/tmp/project',
      '--home',
      '/tmp/home',
    ]);

    expect(cmd).toEqual({
      type: 'context',
      action: 'show',
      cwd: '/tmp/project',
      homeDir: '/tmp/home',
      force: false,
    });
  });

  it('parses context init command', () => {
    const cmd = parseCliArgs([
      '/context',
      'init',
      '--cwd',
      '/tmp/project',
      '--force',
    ]);

    expect(cmd).toEqual({
      type: 'context',
      action: 'init',
      cwd: '/tmp/project',
      homeDir: undefined,
      force: true,
    });
  });

  it('parses /init alias command', () => {
    const cmd = parseCliArgs(['/init', '--cwd', '/tmp/project']);

    expect(cmd).toEqual({
      type: 'context',
      action: 'init',
      cwd: '/tmp/project',
      homeDir: undefined,
      force: false,
    });
  });

  it('parses /init --config alias as config init', () => {
    const cmd = parseCliArgs([
      '/init',
      '--config',
      '--cwd',
      '/tmp/project',
      '--target',
      '/tmp/project/.xifan/config.yaml',
      '--force',
    ]);

    expect(cmd).toEqual({
      type: 'config',
      action: 'init',
      targetPath: '/tmp/project/.xifan/config.yaml',
      force: true,
    });
  });

  it('throws for unknown context subcommand', () => {
    expect(() => parseCliArgs(['context', 'unknown'])).toThrowError(
      'Unknown context subcommand: unknown',
    );
  });

  it('parses session list command', () => {
    const cmd = parseCliArgs([
      'session',
      'list',
      '--project',
      '/tmp/project',
      '--limit',
      '10',
      '--db',
      '/tmp/sessions.db',
    ]);

    expect(cmd).toEqual({
      type: 'session',
      action: 'list',
      projectPath: '/tmp/project',
      dbPath: '/tmp/sessions.db',
      limit: 10,
    });
  });

  it('parses session create command', () => {
    const cmd = parseCliArgs([
      '/session',
      'create',
      '--project',
      '/tmp/project',
      '--model',
      'gpt-4o',
      '--provider',
      'openai',
    ]);

    expect(cmd).toEqual({
      type: 'session',
      action: 'create',
      projectPath: '/tmp/project',
      model: 'gpt-4o',
      provider: 'openai',
      dbPath: undefined,
    });
  });

  it('parses session resume command', () => {
    const cmd = parseCliArgs([
      'session',
      'resume',
      '--id',
      's1',
      '--db',
      '/tmp/sessions.db',
    ]);

    expect(cmd).toEqual({
      type: 'session',
      action: 'resume',
      id: 's1',
      dbPath: '/tmp/sessions.db',
    });
  });

  it('parses --session resume startup alias', () => {
    const cmd = parseCliArgs([
      '--session',
      'resume',
      '--db',
      '/tmp/sessions.db',
    ]);

    expect(cmd).toEqual({
      type: 'session',
      action: 'resume',
      id: undefined,
      dbPath: '/tmp/sessions.db',
    });
  });

  it('throws for unknown --session subcommand', () => {
    expect(() => parseCliArgs(['--session', 'unknown'])).toThrowError(
      'Unknown --session subcommand: unknown',
    );
  });

  it('throws for unknown session subcommand', () => {
    expect(() => parseCliArgs(['session', 'invalid'])).toThrowError(
      'Unknown session subcommand: invalid',
    );
  });

  it('parses config init command', () => {
    const cmd = parseCliArgs([
      'config',
      'init',
      '--cwd',
      '/tmp/project',
    ]);

    expect(cmd).toEqual({
      type: 'config',
      action: 'init',
      targetPath: '/tmp/project/.xifan/coder/config.yaml',
      force: false,
    });
  });

  it('throws for unknown config subcommand', () => {
    expect(() => parseCliArgs(['config', 'unknown'])).toThrowError(
      'Unknown config subcommand: unknown',
    );
  });

  it('parses skill list command', () => {
    const cmd = parseCliArgs([
      'skill',
      'list',
      '--global-skills',
      '/tmp/global-skills',
      '--project-skills',
      '/tmp/project-skills',
    ]);

    expect(cmd).toEqual({
      type: 'skill-list',
      globalSkillsDir: '/tmp/global-skills',
      projectSkillsDir: '/tmp/project-skills',
    });
  });

  it('parses skill use command with positional skill name', () => {
    const cmd = parseCliArgs([
      '/skill',
      'use',
      'alpha',
      '--mode',
      'plan',
      '--policy-mode',
      'strict',
      '--allowed-tools',
      'skill_use:alpha',
    ]);

    expect(cmd).toEqual({
      type: 'skill-use',
      skillName: 'alpha',
      globalSkillsDir: undefined,
      projectSkillsDir: undefined,
      mode: 'plan',
      headless: false,
      allowWrite: false,
      allowShell: false,
      allowDangerous: false,
      policyMode: 'strict',
      allowedTools: ['skill_use:alpha'],
      deniedTools: [],
    });
  });

  it('throws for unknown skill subcommand', () => {
    expect(() => parseCliArgs(['skill', 'unknown'])).toThrowError(
      'Unknown skill subcommand: unknown',
    );
  });

  it('parses todo list command', () => {
    const cmd = parseCliArgs(['todo', 'list', '--store', '/tmp/tasks.json']);

    expect(cmd).toEqual({
      type: 'todo',
      action: 'list',
      storePath: '/tmp/tasks.json',
    });
  });

  it('parses todo guard command', () => {
    const cmd = parseCliArgs([
      '/todo',
      'guard',
      '--current-round',
      '10',
      '--max-rounds',
      '20',
      '--budget-exceeded',
    ]);

    expect(cmd).toEqual({
      type: 'todo',
      action: 'guard',
      storePath: undefined,
      currentRound: 10,
      maxRounds: 20,
      budgetExceeded: true,
    });
  });

  it('throws for unknown todo subcommand', () => {
    expect(() => parseCliArgs(['todo', 'unknown'])).toThrowError(
      'Unknown todo subcommand: unknown',
    );
  });

  it('parses /cost selectors', () => {
    const bySession = parseCliArgs(['cost', '--session', 'sid-1', '--db', '/tmp/x.db']);
    expect(bySession).toEqual({
      type: 'cost',
      sessionId: 'sid-1',
      today: false,
      model: undefined,
      dbPath: '/tmp/x.db',
    });

    const byToday = parseCliArgs(['/cost', '--today']);
    expect(byToday).toEqual({
      type: 'cost',
      sessionId: undefined,
      today: true,
      model: undefined,
      dbPath: undefined,
    });

    const byModel = parseCliArgs(['cost', '--model', 'gpt-4o']);
    expect(byModel).toEqual({
      type: 'cost',
      sessionId: undefined,
      today: false,
      model: 'gpt-4o',
      dbPath: undefined,
    });
  });

  it('rejects conflicting /cost selectors', () => {
    expect(() => parseCliArgs(['cost', '--today', '--model', 'gpt-4o'])).toThrowError(
      'cost command only accepts one selector among --session/--today/--model',
    );
  });

  it('parses plugin-discover command with path overrides', () => {
    const cmd = parseCliArgs([
      'plugin-discover',
      '--global',
      '/tmp/global',
      '--project',
      '/tmp/project',
      '--node-modules',
      '/tmp/node_modules',
      '--config',
      '/tmp/plugins.json',
    ]);

    expect(cmd).toEqual({
      type: 'plugin-discover',
      globalPluginsDir: '/tmp/global',
      projectPluginsDir: '/tmp/project',
      nodeModulesDir: '/tmp/node_modules',
      explicitConfig: '/tmp/plugins.json',
    });
  });

  it('parses plugin-bootstrap command', () => {
    const cmd = parseCliArgs([
      'plugin-bootstrap',
      '--global',
      '/tmp/global',
      '--project',
      '/tmp/project',
      '--node-modules',
      '/tmp/node_modules',
      '--config',
      '/tmp/plugins.json',
      '--enabled-l3',
      'danger,aider',
    ]);

    expect(cmd).toEqual({
      type: 'plugin-bootstrap',
      globalPluginsDir: '/tmp/global',
      projectPluginsDir: '/tmp/project',
      nodeModulesDir: '/tmp/node_modules',
      explicitConfig: '/tmp/plugins.json',
      enabledL3Plugins: ['danger', 'aider'],
    });
  });

  it('parses plugin-exec command', () => {
    const cmd = parseCliArgs([
      'plugin-exec',
      '--plugin',
      'safe',
      '--tool',
      'safe_echo',
      '--args-json',
      '{"message":"hello"}',
      '--allowed-tools',
      'safe:safe_echo',
      '--denied-tools',
      'safe:safe_delete',
      '--enabled-l3',
      'danger',
    ]);

    expect(cmd).toEqual({
      type: 'plugin-exec',
      pluginName: 'safe',
      toolName: 'safe_echo',
      args: { message: 'hello' },
      confirm: 'ask',
      mode: 'build',
      headless: false,
      allowWrite: false,
      allowShell: false,
      allowDangerous: false,
      policyMode: 'compat',
      dangerouslySkipPermissions: false,
      allowedTools: ['safe:safe_echo'],
      deniedTools: ['safe:safe_delete'],
      globalPluginsDir: undefined,
      projectPluginsDir: undefined,
      nodeModulesDir: undefined,
      explicitConfig: undefined,
      enabledL3Plugins: ['danger'],
    });
  });

  it('parses plugin list shorthand command', () => {
    const cmd = parseCliArgs([
      'plugin',
      'list',
      '--global',
      '/tmp/global',
      '--project',
      '/tmp/project',
      '--node-modules',
      '/tmp/node_modules',
      '--config',
      '/tmp/plugins.json',
    ]);

    expect(cmd).toEqual({
      type: 'plugin-discover',
      globalPluginsDir: '/tmp/global',
      projectPluginsDir: '/tmp/project',
      nodeModulesDir: '/tmp/node_modules',
      explicitConfig: '/tmp/plugins.json',
    });
  });

  it('parses /plugin <name> <args> shorthand into plugin-exec', () => {
    const cmd = parseCliArgs([
      '/plugin',
      'safe',
      'hello',
      'world',
      '--tool',
      'safe_echo',
      '--mode',
      'plan',
    ]);

    expect(cmd).toEqual({
      type: 'plugin-exec',
      pluginName: 'safe',
      toolName: 'safe_echo',
      args: {
        input: 'hello world',
      },
      confirm: 'ask',
      mode: 'plan',
      headless: false,
      allowWrite: false,
      allowShell: false,
      allowDangerous: false,
      policyMode: 'compat',
      dangerouslySkipPermissions: false,
      allowedTools: [],
      deniedTools: [],
      globalPluginsDir: undefined,
      projectPluginsDir: undefined,
      nodeModulesDir: undefined,
      explicitConfig: undefined,
      enabledL3Plugins: [],
    });
  });

  it('parses /plugin JSON positional payload', () => {
    const cmd = parseCliArgs([
      '/plugin',
      'safe',
      '{"message":"hello"}',
    ]);

    expect(cmd).toEqual({
      type: 'plugin-exec',
      pluginName: 'safe',
      toolName: 'safe',
      args: { message: 'hello' },
      confirm: 'ask',
      mode: 'build',
      headless: false,
      allowWrite: false,
      allowShell: false,
      allowDangerous: false,
      policyMode: 'compat',
      dangerouslySkipPermissions: false,
      allowedTools: [],
      deniedTools: [],
      globalPluginsDir: undefined,
      projectPluginsDir: undefined,
      nodeModulesDir: undefined,
      explicitConfig: undefined,
      enabledL3Plugins: [],
    });
  });

  it('parses plugin-exec confirmation flags', () => {
    const cmd = parseCliArgs([
      'plugin-exec',
      '--plugin',
      'safe',
      '--tool',
      'safe_echo',
      '--yes',
    ]);

    expect(cmd.type).toBe('plugin-exec');
    if (cmd.type === 'plugin-exec') {
      expect(cmd.confirm).toBe('yes');
    }
  });

  it('rejects plugin-exec conflicting confirmation flags', () => {
    expect(() =>
      parseCliArgs(['plugin-exec', '--plugin', 'safe', '--tool', 'safe_echo', '--yes', '--no']),
    ).toThrowError('Flags --yes and --no are mutually exclusive');
  });

  it('rejects plugin-exec invalid args JSON', () => {
    expect(() =>
      parseCliArgs(['plugin-exec', '--plugin', 'safe', '--tool', 'safe_echo', '--args-json', '{']),
    ).toThrowError('Invalid JSON for --args-json');
  });

  it('throws for unknown plugin subcommand', () => {
    expect(() => parseCliArgs(['plugin'])).toThrowError('Unknown plugin subcommand: <empty>');
  });

  it('throws on unknown command', () => {
    expect(() => parseCliArgs(['unknown'])).toThrowError('Unknown command: unknown');
  });

  // --- Coverage: parseDriverMode invalid ---
  it('throws for invalid --driver value', () => {
    expect(() =>
      parseCliArgs(['resolve-llm-driver', '--driver', 'invalid']),
    ).toThrowError('Invalid --driver: invalid');
  });

  // --- Coverage: parseAgentMode invalid ---
  it('throws for invalid --mode value in check-tool', () => {
    expect(() =>
      parseCliArgs(['check-tool', '--tool', 'x', '--level', 'L0', '--mode', 'invalid']),
    ).toThrowError('Invalid --mode: invalid');
  });

  // --- Coverage: parsePolicyMode invalid ---
  it('throws for invalid --policy-mode value in check-tool', () => {
    expect(() =>
      parseCliArgs(['check-tool', '--tool', 'x', '--level', 'L0', '--policy-mode', 'invalid']),
    ).toThrowError('Invalid --policy-mode: invalid');
  });

  // --- Coverage: parsePluginInlineArgs with explicit --args-json ---
  it('parses /plugin with explicit --args-json flag', () => {
    const cmd = parseCliArgs(['/plugin', 'safe', '--args-json', '{"key":"val"}']);
    expect(cmd.type).toBe('plugin-exec');
    if (cmd.type === 'plugin-exec') {
      expect(cmd.args).toEqual({ key: 'val' });
    }
  });

  // --- Coverage: parsePluginInlineArgs with empty token (line 85) ---
  // The empty-token `continue` branch in parsePluginInlineArgs is triggered by
  // a gap in the args array. In practice, this branch is unreachable because
  // Array iteration in JS never yields `undefined` for sparse slots via for-loop
  // on .length. We cover it indirectly below via the no-positional path.

  // --- Coverage: parsePluginInlineArgs no positional args (line 97-98) ---
  it('parses /plugin with no positional args and no --args-json returns empty object', () => {
    const cmd = parseCliArgs(['/plugin', 'safe', '--tool', 'safe_echo']);
    expect(cmd.type).toBe('plugin-exec');
    if (cmd.type === 'plugin-exec') {
      expect(cmd.args).toEqual({});
    }
  });

  // --- Coverage: parseIntegerFlag invalid integer (line 121-122) ---
  it('throws for invalid integer flag (non-number)', () => {
    expect(() =>
      parseCliArgs(['daemon', 'ping', '--token', 'secret', '--port', 'abc']),
    ).toThrowError('Invalid integer for --port: abc');
  });

  it('throws for negative integer flag', () => {
    expect(() =>
      parseCliArgs(['daemon', 'ping', '--token', 'secret', '--port', '-1']),
    ).toThrowError('Invalid integer for --port: -1');
  });

  // --- Coverage: parsePositiveIntegerFlag zero value (line 133-134) ---
  it('throws for zero value in positive integer flag', () => {
    expect(() =>
      parseCliArgs(['mcp', 'serve', '--max-connections', '0']),
    ).toThrowError('Invalid integer for --max-connections: 0');
  });

  // --- Coverage: getRequiredArg missing flag (line 141-142) ---
  it('throws when required --file flag is missing for lsp diagnostics', () => {
    expect(() =>
      parseCliArgs(['lsp', 'diagnostics']),
    ).toThrowError('Missing required flag: --file');
  });

  // --- Coverage: check-tool missing --tool (line 179-180) ---
  it('throws when check-tool is missing --tool flag', () => {
    expect(() =>
      parseCliArgs(['check-tool', '--level', 'L0']),
    ).toThrowError('Missing required flag: --tool');
  });

  // --- Coverage: mode shorthand build/plan as action (line 255-264) ---
  it('parses mode build shorthand', () => {
    const cmd = parseCliArgs(['mode', 'build']);
    expect(cmd).toEqual({
      type: 'mode',
      action: 'set',
      value: 'build',
      storePath: undefined,
    });
  });

  it('parses mode plan shorthand', () => {
    const cmd = parseCliArgs(['/mode', 'plan']);
    expect(cmd).toEqual({
      type: 'mode',
      action: 'set',
      value: 'plan',
      storePath: undefined,
    });
  });

  // --- Coverage: unknown mode subcommand (line 263) ---
  it('throws for unknown mode subcommand', () => {
    expect(() => parseCliArgs(['mode', 'invalid'])).toThrowError(
      'Unknown mode subcommand: invalid',
    );
  });

  // --- Coverage: lsp workspace-symbols (line 284-291) ---
  it('parses lsp workspace-symbols command', () => {
    const cmd = parseCliArgs([
      '/lsp',
      'workspace-symbols',
      '--query',
      'MyClass',
      '--root',
      '/tmp/project',
    ]);

    expect(cmd).toEqual({
      type: 'lsp',
      action: 'workspace-symbols',
      language: 'typescript',
      query: 'MyClass',
      rootDir: '/tmp/project',
    });
  });

  // --- Coverage: lsp references (line 294-303) ---
  it('parses lsp references command', () => {
    const cmd = parseCliArgs([
      'lsp',
      'references',
      '--file',
      'src/a.ts',
      '--line',
      '10',
      '--character',
      '5',
      '--root',
      '/tmp/project',
    ]);

    expect(cmd).toEqual({
      type: 'lsp',
      action: 'references',
      language: 'typescript',
      filePath: 'src/a.ts',
      line: 10,
      character: 5,
      rootDir: '/tmp/project',
    });
  });

  // --- Coverage: daemon missing token (line 328-329) ---
  it('throws when daemon is missing token', () => {
    const original = process.env.XIFAN_DAEMON_TOKEN;
    delete process.env.XIFAN_DAEMON_TOKEN;
    try {
      expect(() =>
        parseCliArgs(['daemon', 'ping']),
      ).toThrowError('Missing daemon token: use --token or set XIFAN_DAEMON_TOKEN');
    } finally {
      if (original !== undefined) {
        process.env.XIFAN_DAEMON_TOKEN = original;
      }
    }
  });

  // --- Coverage: daemon get subcommand (line 352-360) ---
  it('parses daemon get command', () => {
    const cmd = parseCliArgs([
      'daemon',
      'get',
      '--token',
      'secret',
      '--session',
      's1',
    ]);

    expect(cmd).toEqual({
      type: 'daemon',
      action: 'get',
      host: '127.0.0.1',
      port: 9321,
      token: 'secret',
      sessionId: 's1',
    });
  });

  // --- Coverage: skill use missing name (line 590-591) ---
  it('throws when skill use is missing name', () => {
    expect(() =>
      parseCliArgs(['skill', 'use']),
    ).toThrowError('Missing required skill name');
  });

  // --- Coverage: todo add (line 626-641) ---
  it('parses todo add command', () => {
    const cmd = parseCliArgs([
      'todo',
      'add',
      '--id',
      'task-1',
      '--title',
      'Implement feature',
      '--store',
      '/tmp/tasks.json',
    ]);

    expect(cmd).toEqual({
      type: 'todo',
      action: 'add',
      storePath: '/tmp/tasks.json',
      id: 'task-1',
      title: 'Implement feature',
    });
  });

  it('throws when todo add is missing --id', () => {
    expect(() =>
      parseCliArgs(['todo', 'add', '--title', 'Test']),
    ).toThrowError('Missing required flag: --id');
  });

  it('throws when todo add is missing --title', () => {
    expect(() =>
      parseCliArgs(['todo', 'add', '--id', 'task-1']),
    ).toThrowError('Missing required flag: --title');
  });

  // --- Coverage: todo start/done (line 644-654) ---
  it('parses todo start command', () => {
    const cmd = parseCliArgs(['todo', 'start', '--id', 'task-1']);
    expect(cmd).toEqual({
      type: 'todo',
      action: 'start',
      storePath: undefined,
      id: 'task-1',
    });
  });

  it('parses todo done command', () => {
    const cmd = parseCliArgs(['/todo', 'done', '--id', 'task-2']);
    expect(cmd).toEqual({
      type: 'todo',
      action: 'done',
      storePath: undefined,
      id: 'task-2',
    });
  });

  it('throws when todo start is missing --id', () => {
    expect(() =>
      parseCliArgs(['todo', 'start']),
    ).toThrowError('Missing required flag: --id');
  });

  // --- Coverage: todo block (line 657-672) ---
  it('parses todo block command', () => {
    const cmd = parseCliArgs([
      'todo',
      'block',
      '--id',
      'task-1',
      '--reason',
      'waiting for dependency',
    ]);
    expect(cmd).toEqual({
      type: 'todo',
      action: 'block',
      storePath: undefined,
      id: 'task-1',
      reason: 'waiting for dependency',
    });
  });

  it('throws when todo block is missing --id', () => {
    expect(() =>
      parseCliArgs(['todo', 'block', '--reason', 'blocked']),
    ).toThrowError('Missing required flag: --id');
  });

  it('throws when todo block is missing --reason', () => {
    expect(() =>
      parseCliArgs(['todo', 'block', '--id', 'task-1']),
    ).toThrowError('Missing required flag: --reason');
  });

  // --- Coverage: plugin-exec missing --plugin (line 713-714) ---
  it('throws when plugin-exec is missing --plugin', () => {
    expect(() =>
      parseCliArgs(['plugin-exec', '--tool', 'safe_echo']),
    ).toThrowError('Missing required flag: --plugin');
  });

  // --- Coverage: plugin-exec missing --tool (line 716-717) ---
  it('throws when plugin-exec is missing --tool', () => {
    expect(() =>
      parseCliArgs(['plugin-exec', '--plugin', 'safe']),
    ).toThrowError('Missing required flag: --tool');
  });

  // --- Coverage: setup command (line 783-789) ---
  it('parses setup command', () => {
    const cmd = parseCliArgs([
      'setup',
      '--server',
      'https://api.example.com',
      '--api-key',
      'sk-test',
    ]);

    expect(cmd).toEqual({
      type: 'setup',
      server: 'https://api.example.com',
      apiKey: 'sk-test',
      uninstall: false,
    });
  });

  it('parses setup command with --uninstall', () => {
    const cmd = parseCliArgs(['setup', '--uninstall']);
    expect(cmd).toEqual({
      type: 'setup',
      server: undefined,
      apiKey: undefined,
      uninstall: true,
    });
  });

  // --- Coverage: help aliases ---
  it('parses help alias', () => {
    expect(parseCliArgs(['help'])).toEqual({ type: 'help' });
    expect(parseCliArgs(['--help'])).toEqual({ type: 'help' });
    expect(parseCliArgs(['-h'])).toEqual({ type: 'help' });
  });

  // --- Coverage: mcp implicit serve (no subcommand) ---
  it('parses mcp with no subcommand as serve', () => {
    const cmd = parseCliArgs(['/mcp']);
    expect(cmd.type).toBe('mcp');
    if (cmd.type === 'mcp') {
      expect(cmd.action).toBe('serve');
    }
  });

  // --- Coverage: memory default serve (no subcommand) ---
  it('parses memory with no subcommand as serve', () => {
    const cmd = parseCliArgs(['memory']);
    expect(cmd).toEqual({
      type: 'memory',
      action: 'serve',
      dbPath: undefined,
    });
  });

  // --- Coverage: context with no subcommand defaults to show ---
  it('parses context with no subcommand as show', () => {
    const cmd = parseCliArgs(['context', '--cwd', '/tmp/p']);
    expect(cmd).toEqual({
      type: 'context',
      action: 'show',
      cwd: '/tmp/p',
      homeDir: undefined,
      force: false,
    });
  });

  // --- Coverage: session list with no subcommand ---
  it('parses session with no subcommand as list', () => {
    const cmd = parseCliArgs(['session']);
    expect(cmd).toEqual({
      type: 'session',
      action: 'list',
      projectPath: undefined,
      dbPath: undefined,
      limit: 20,
    });
  });

  // --- Coverage: daemon --insecure-no-tls alias ---
  it('parses mcp serve with --insecure-no-tls alias', () => {
    const cmd = parseCliArgs(['mcp', 'serve', '--insecure-no-tls']);
    expect(cmd.type).toBe('mcp');
    if (cmd.type === 'mcp') {
      expect(cmd.requireTls).toBe(false);
    }
  });

  // --- Coverage: parseConfirmMode --no flag ---
  it('parses resolve-llm-driver with --no flag', () => {
    const cmd = parseCliArgs(['resolve-llm-driver', '--no']);
    expect(cmd.type).toBe('resolve-llm-driver');
    if (cmd.type === 'resolve-llm-driver') {
      expect(cmd.confirm).toBe('no');
    }
  });

  // --- Coverage: provider-update defaults ---
  it('parses provider-update with defaults', () => {
    const cmd = parseCliArgs(['provider-update']);
    expect(cmd).toEqual({
      type: 'provider-update',
      source: 'embedded',
      targetPath: '.xifan/coder/providers/catalog.json',
    });
  });

  // --- Coverage: lsp with empty subcommand ---
  it('throws for lsp with no subcommand', () => {
    expect(() => parseCliArgs(['lsp'])).toThrowError(
      'Unknown lsp subcommand: <empty>',
    );
  });

  // --- Coverage: daemon unknown subcommand ---
  it('throws for daemon with unknown subcommand', () => {
    expect(() => parseCliArgs(['daemon', 'invalid', '--token', 'secret'])).toThrowError(
      'Unknown daemon subcommand: invalid',
    );
  });

  // --- Coverage: mode set with empty value ---
  it('throws for mode set with empty value', () => {
    expect(() => parseCliArgs(['mode', 'set'])).toThrowError(
      'Invalid mode value: <empty>',
    );
  });

  // --- Coverage: --session with empty subcommand ---
  it('throws for --session with no subcommand', () => {
    expect(() => parseCliArgs(['--session'])).toThrowError(
      'Unknown --session subcommand: <empty>',
    );
  });

  // --- Coverage: skill with no subcommand ---
  it('throws for skill with no subcommand', () => {
    expect(() => parseCliArgs(['skill'])).toThrowError(
      'Unknown skill subcommand: <empty>',
    );
  });

  // --- Coverage: parseLevel invalid ---
  it('throws for invalid --level value', () => {
    expect(() =>
      parseCliArgs(['check-tool', '--tool', 'x', '--level', 'L9']),
    ).toThrowError('Invalid --level: L9');
  });
});
