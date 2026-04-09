import type { CliCommand, ToolLevel } from './types.js';

function getArgValue(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  return args[i + 1];
}

function getListArg(args: readonly string[], flag: string): readonly string[] {
  const raw = getArgValue(args, flag);
  if (!raw) return [];
  return raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function parseLevel(value: string | undefined): ToolLevel {
  if (value === 'L0' || value === 'L1' || value === 'L2' || value === 'L3') return value;
  throw new Error(`Invalid --level: ${value ?? '<empty>'}`);
}

function parseDriverMode(value: string | undefined): 'auto' | 'builtin' | 'litellm' {
  const mode = value ?? 'auto';
  if (mode === 'auto' || mode === 'builtin' || mode === 'litellm') return mode;
  throw new Error(`Invalid --driver: ${mode}`);
}

function parseAgentMode(value: string | undefined): 'build' | 'plan' {
  const mode = (value ?? 'build') as 'build' | 'plan';
  if (mode !== 'build' && mode !== 'plan') {
    throw new Error(`Invalid --mode: ${mode}`);
  }
  return mode;
}

function parsePolicyMode(value: string | undefined): 'compat' | 'strict' {
  const policyMode = (value ?? 'compat') as 'compat' | 'strict';
  if (policyMode !== 'compat' && policyMode !== 'strict') {
    throw new Error(`Invalid --policy-mode: ${policyMode}`);
  }
  return policyMode;
}

function parseJsonValue(raw: string | undefined, flag: string): unknown {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON for ${flag}`);
  }
}

function parsePluginInlineArgs(args: readonly string[]): unknown {
  const explicit = getArgValue(args, '--args-json');
  if (explicit) {
    return parseJsonValue(explicit, '--args-json');
  }

  const flagsWithValue = new Set([
    '--tool',
    '--args-json',
    '--mode',
    '--policy-mode',
    '--allowed-tools',
    '--denied-tools',
    '--global',
    '--project',
    '--node-modules',
    '--config',
    '--enabled-l3',
  ]);
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    /* v8 ignore next 3 -- defensive: array index within bounds always yields a string */
    if (!token) {
      continue;
    }
    if (token.startsWith('--')) {
      if (flagsWithValue.has(token)) {
        i += 1;
      }
      continue;
    }
    positional.push(token);
  }

  if (positional.length === 0) {
    return {};
  }

  const raw = positional.join(' ');
  try {
    return JSON.parse(raw);
  } catch {
    return {
      input: raw,
    };
  }
}

function parseIntegerFlag(
  args: readonly string[],
  flag: string,
  defaultValue: number,
): number {
  const raw = getArgValue(args, flag);
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid integer for ${flag}: ${raw}`);
  }
  return parsed;
}

function parsePositiveIntegerFlag(
  args: readonly string[],
  flag: string,
  defaultValue: number,
): number {
  const value = parseIntegerFlag(args, flag, defaultValue);
  if (value <= 0) {
    throw new Error(`Invalid integer for ${flag}: ${value}`);
  }
  return value;
}

function getRequiredArg(args: readonly string[], flag: string): string {
  const value = getArgValue(args, flag);
  if (!value) {
    throw new Error(`Missing required flag: ${flag}`);
  }
  return value;
}

function parseConfirmMode(args: readonly string[]): 'ask' | 'yes' | 'no' {
  const hasYes = hasFlag(args, '--yes');
  const hasNo = hasFlag(args, '--no');
  if (hasYes && hasNo) {
    throw new Error('Flags --yes and --no are mutually exclusive');
  }
  return hasYes ? 'yes' : hasNo ? 'no' : 'ask';
}

export function parseCliArgs(argv: readonly string[]): CliCommand {
  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return { type: 'help' };
  }

  if (command === '--session') {
    const subcommand = rest[0];
    const args = rest.slice(1);
    if (subcommand === 'resume') {
      return {
        type: 'session',
        action: 'resume',
        id: getArgValue(args, '--id'),
        dbPath: getArgValue(args, '--db'),
      };
    }
    throw new Error(`Unknown --session subcommand: ${subcommand ?? '<empty>'}`);
  }

  if (command === 'check-tool') {
    const toolName = getArgValue(rest, '--tool');
    if (!toolName) {
      throw new Error('Missing required flag: --tool');
    }

    const level = parseLevel(getArgValue(rest, '--level'));
    const mode = parseAgentMode(getArgValue(rest, '--mode'));
    const policyMode = parsePolicyMode(getArgValue(rest, '--policy-mode'));

    return {
      type: 'check-tool',
      toolName,
      level,
      mode,
      headless: hasFlag(rest, '--headless'),
      allowWrite: hasFlag(rest, '--allow-write'),
      allowShell: hasFlag(rest, '--allow-shell'),
      allowDangerous: hasFlag(rest, '--allow-dangerous'),
      allowedTools: getListArg(rest, '--allowed-tools'),
      deniedTools: getListArg(rest, '--denied-tools'),
      policyMode,
      dangerouslySkipPermissions: hasFlag(rest, '--dangerously-skip-permissions'),
    };
  }

  if (command === 'provider-update') {
    const source = rest[0] ?? 'embedded';
    const targetPath = getArgValue(rest, '--target') ?? '.xifan/coder/providers/catalog.json';
    return {
      type: 'provider-update',
      source,
      targetPath,
    };
  }

  if (command === 'tools' || command === '/tools') {
    return {
      type: 'tools',
      crushCommand: getArgValue(rest, '--crush-cmd') ?? 'crush',
    };
  }

  if (command === 'resolve-llm-driver') {
    return {
      type: 'resolve-llm-driver',
      mode: parseDriverMode(getArgValue(rest, '--driver')),
      headless: hasFlag(rest, '--headless'),
      litellmBaseUrl: getArgValue(rest, '--litellm-url') ?? 'http://localhost:4000',
      confirm: parseConfirmMode(rest),
    };
  }

  if (command === 'mode' || command === '/mode') {
    const action = rest[0];
    const storePath = getArgValue(rest, '--store');

    if (!action || action === 'get') {
      return {
        type: 'mode',
        action: 'get',
        storePath,
      };
    }

    if (action === 'set') {
      const value = rest[1];
      if (value !== 'build' && value !== 'plan') {
        throw new Error(`Invalid mode value: ${value ?? '<empty>'}`);
      }
      return {
        type: 'mode',
        action: 'set',
        value,
        storePath,
      };
    }

    if (action === 'build' || action === 'plan') {
      return {
        type: 'mode',
        action: 'set',
        value: action,
        storePath,
      };
    }

    throw new Error(`Unknown mode subcommand: ${action}`);
  }

  if (command === 'lsp' || command === '/lsp') {
    const subcommand = rest[0];
    const args = rest.slice(1);
    const language = getArgValue(args, '--language') ?? 'typescript';
    const rootDir = getArgValue(args, '--root');

    if (subcommand === 'diagnostics') {
      return {
        type: 'lsp',
        action: 'diagnostics',
        language,
        filePath: getRequiredArg(args, '--file'),
        content: getArgValue(args, '--content'),
        rootDir,
      };
    }

    if (subcommand === 'workspace-symbols') {
      return {
        type: 'lsp',
        action: 'workspace-symbols',
        language,
        query: getRequiredArg(args, '--query'),
        rootDir,
      };
    }

    if (subcommand === 'references') {
      return {
        type: 'lsp',
        action: 'references',
        language,
        filePath: getRequiredArg(args, '--file'),
        line: parseIntegerFlag(args, '--line', 1),
        character: parseIntegerFlag(args, '--character', 1),
        rootDir,
      };
    }

    if (subcommand === 'rename-preview') {
      return {
        type: 'lsp',
        action: 'rename-preview',
        language,
        filePath: getRequiredArg(args, '--file'),
        line: parseIntegerFlag(args, '--line', 1),
        character: parseIntegerFlag(args, '--character', 1),
        newName: getRequiredArg(args, '--new-name'),
        rootDir,
      };
    }

    throw new Error(`Unknown lsp subcommand: ${subcommand ?? '<empty>'}`);
  }

  if (command === 'daemon' || command === '/daemon') {
    const subcommand = rest[0];
    const args = rest.slice(1);
    const host = getArgValue(args, '--host') ?? '127.0.0.1';
    const port = parseIntegerFlag(args, '--port', 9321);
    const token = getArgValue(args, '--token') ?? process.env.XIFAN_DAEMON_TOKEN;
    if (!token) {
      throw new Error('Missing daemon token: use --token or set XIFAN_DAEMON_TOKEN');
    }

    if (subcommand === 'ping') {
      return {
        type: 'daemon',
        action: 'ping',
        host,
        port,
        token,
      };
    }

    if (subcommand === 'serve') {
      return {
        type: 'daemon',
        action: 'serve',
        host,
        port,
        token,
      };
    }

    if (subcommand === 'get') {
      return {
        type: 'daemon',
        action: 'get',
        host,
        port,
        token,
        sessionId: getRequiredArg(args, '--session'),
      };
    }

    if (subcommand === 'append') {
      return {
        type: 'daemon',
        action: 'append',
        host,
        port,
        token,
        sessionId: getRequiredArg(args, '--session'),
        content: getRequiredArg(args, '--content'),
        role: (getArgValue(args, '--role') as 'user' | 'assistant' | 'system' | undefined) ?? 'user',
        source: (getArgValue(args, '--source') as 'cli' | 'desktop' | 'daemon' | undefined) ?? 'cli',
      };
    }

    throw new Error(`Unknown daemon subcommand: ${subcommand ?? '<empty>'}`);
  }

  if (command === 'mcp' || command === '/mcp') {
    const subcommand = rest[0];
    const args =
      !subcommand || subcommand === 'serve'
        ? rest.slice(1)
        : rest;
    const action = !subcommand || subcommand === 'serve' ? 'serve' : undefined;
    if (!action) {
      throw new Error(`Unknown mcp subcommand: ${subcommand}`);
    }

    const disableTls = hasFlag(args, '--no-tls') || hasFlag(args, '--insecure-no-tls');
    const requireTls = !disableTls;
    const tlsKeyPath = getArgValue(args, '--tls-key');
    const tlsCertPath = getArgValue(args, '--tls-cert');
    if ((tlsKeyPath && !tlsCertPath) || (!tlsKeyPath && tlsCertPath)) {
      throw new Error('mcp serve requires both --tls-key and --tls-cert when custom TLS files are used');
    }

    return {
      type: 'mcp',
      action: 'serve',
      host: getArgValue(args, '--host') ?? '127.0.0.1',
      port: parseIntegerFlag(args, '--port', 7890),
      path: getArgValue(args, '--path') ?? '/mcp',
      token: getArgValue(args, '--token') ?? process.env.XIFAN_MCP_TOKEN,
      tokenFilePath: getArgValue(args, '--token-file'),
      maxConnections: parsePositiveIntegerFlag(args, '--max-connections', 10),
      requireTls,
      tlsKeyPath,
      tlsCertPath,
      autoStartMemory: hasFlag(args, '--auto-memory'),
      memoryDbPath: getArgValue(args, '--memory-db'),
    };
  }

  if (command === 'memory' || command === '/memory') {
    const subcommand = rest[0];
    const args = subcommand ? rest.slice(1) : rest;

    if (!subcommand || subcommand === 'serve') {
      return {
        type: 'memory',
        action: 'serve',
        dbPath: getArgValue(args, '--db'),
      };
    }

    if (subcommand === 'search') {
      return {
        type: 'memory',
        action: 'search',
        dbPath: getArgValue(args, '--db'),
        query: getRequiredArg(args, '--query'),
        project: getArgValue(args, '--project'),
        limit: parsePositiveIntegerFlag(args, '--limit', 20),
      };
    }

    if (subcommand === 'open') {
      return {
        type: 'memory',
        action: 'open',
        dbPath: getArgValue(args, '--db'),
        host: getArgValue(args, '--host') ?? '127.0.0.1',
        port: parseIntegerFlag(args, '--port', 37777),
      };
    }

    throw new Error(`Unknown memory subcommand: ${subcommand}`);
  }

  if (command === 'context' || command === '/context') {
    const subcommand = rest[0];
    const args =
      !subcommand || subcommand === 'show' || subcommand === 'init'
        ? rest.slice(1)
        : rest;
    const action =
      !subcommand || subcommand.startsWith('--') || subcommand === 'show'
        ? 'show'
        : subcommand === 'init'
          ? 'init'
          : undefined;

    if (!action) {
      throw new Error(`Unknown context subcommand: ${subcommand}`);
    }

    return {
      type: 'context',
      action,
      cwd: getArgValue(args, '--cwd') ?? process.cwd(),
      homeDir: getArgValue(args, '--home'),
      force: hasFlag(args, '--force'),
    };
  }

  if (command === 'init' || command === '/init') {
    if (hasFlag(rest, '--config')) {
      const cwd = getArgValue(rest, '--cwd') ?? process.cwd();
      return {
        type: 'config',
        action: 'init',
        targetPath: getArgValue(rest, '--target') ?? `${cwd}/.xifan/coder/config.yaml`,
        force: hasFlag(rest, '--force'),
      };
    }

    return {
      type: 'context',
      action: 'init',
      cwd: getArgValue(rest, '--cwd') ?? process.cwd(),
      homeDir: getArgValue(rest, '--home'),
      force: hasFlag(rest, '--force'),
    };
  }

  if (command === 'config' || command === '/config') {
    const subcommand = rest[0];
    const args = rest.slice(1);

    if (subcommand === 'init') {
      const cwd = getArgValue(args, '--cwd') ?? process.cwd();
      return {
        type: 'config',
        action: 'init',
        targetPath: getArgValue(args, '--target') ?? `${cwd}/.xifan/coder/config.yaml`,
        force: hasFlag(args, '--force'),
      };
    }

    throw new Error(`Unknown config subcommand: ${subcommand ?? '<empty>'}`);
  }

  if (command === 'session' || command === '/session') {
    const subcommand = rest[0];
    const args = rest.slice(1);

    if (subcommand === 'list' || !subcommand) {
      const listArgs = subcommand ? args : rest;
      return {
        type: 'session',
        action: 'list',
        projectPath: getArgValue(listArgs, '--project'),
        dbPath: getArgValue(listArgs, '--db'),
        limit: parsePositiveIntegerFlag(listArgs, '--limit', 20),
      };
    }

    if (subcommand === 'resume') {
      return {
        type: 'session',
        action: 'resume',
        id: getRequiredArg(args, '--id'),
        dbPath: getArgValue(args, '--db'),
      };
    }

    if (subcommand === 'create') {
      const projectPath = getArgValue(args, '--project') ?? process.cwd();
      const model = getRequiredArg(args, '--model');
      const provider = getRequiredArg(args, '--provider');
      return {
        type: 'session',
        action: 'create',
        projectPath,
        model,
        provider,
        dbPath: getArgValue(args, '--db'),
      };
    }

    throw new Error(`Unknown session subcommand: ${subcommand}`);
  }

  if (command === 'cost' || command === '/cost') {
    const sessionId = getArgValue(rest, '--session');
    const today = hasFlag(rest, '--today');
    const model = getArgValue(rest, '--model');
    const selected = [sessionId ? 1 : 0, today ? 1 : 0, model ? 1 : 0].reduce(
      (sum, item) => sum + item,
      0,
    );
    if (selected > 1) {
      throw new Error('cost command only accepts one selector among --session/--today/--model');
    }
    return {
      type: 'cost',
      sessionId,
      today,
      model,
      dbPath: getArgValue(rest, '--db'),
    };
  }

  if (command === 'skill' || command === '/skill') {
    const subcommand = rest[0];
    const args = rest.slice(1);

    if (subcommand === 'list') {
      return {
        type: 'skill-list',
        globalSkillsDir: getArgValue(args, '--global-skills'),
        projectSkillsDir: getArgValue(args, '--project-skills'),
      };
    }

    if (subcommand === 'use') {
      const skillName = getArgValue(args, '--name') ?? args[0];
      if (!skillName) {
        throw new Error('Missing required skill name: use --name <skill> or skill use <skill>');
      }

      return {
        type: 'skill-use',
        skillName,
        globalSkillsDir: getArgValue(args, '--global-skills'),
        projectSkillsDir: getArgValue(args, '--project-skills'),
        mode: parseAgentMode(getArgValue(args, '--mode')),
        headless: hasFlag(args, '--headless'),
        allowWrite: hasFlag(args, '--allow-write'),
        allowShell: hasFlag(args, '--allow-shell'),
        allowDangerous: hasFlag(args, '--allow-dangerous'),
        policyMode: parsePolicyMode(getArgValue(args, '--policy-mode')),
        allowedTools: getListArg(args, '--allowed-tools'),
        deniedTools: getListArg(args, '--denied-tools'),
      };
    }

    throw new Error(`Unknown skill subcommand: ${subcommand ?? '<empty>'}`);
  }

  if (command === 'todo' || command === '/todo') {
    const subcommand = rest[0];
    const args = rest.slice(1);
    const storePath = getArgValue(args, '--store');

    if (subcommand === 'list') {
      return {
        type: 'todo',
        action: 'list',
        storePath,
      };
    }

    if (subcommand === 'add') {
      const id = getArgValue(args, '--id');
      const title = getArgValue(args, '--title');
      if (!id) {
        throw new Error('Missing required flag: --id');
      }
      if (!title) {
        throw new Error('Missing required flag: --title');
      }
      return {
        type: 'todo',
        action: 'add',
        storePath,
        id,
        title,
      };
    }

    if (subcommand === 'start' || subcommand === 'done') {
      const id = getArgValue(args, '--id');
      if (!id) {
        throw new Error('Missing required flag: --id');
      }
      return {
        type: 'todo',
        action: subcommand,
        storePath,
        id,
      };
    }

    if (subcommand === 'block') {
      const id = getArgValue(args, '--id');
      const reason = getArgValue(args, '--reason');
      if (!id) {
        throw new Error('Missing required flag: --id');
      }
      if (!reason) {
        throw new Error('Missing required flag: --reason');
      }
      return {
        type: 'todo',
        action: 'block',
        storePath,
        id,
        reason,
      };
    }

    if (subcommand === 'guard') {
      return {
        type: 'todo',
        action: 'guard',
        storePath,
        currentRound: parseIntegerFlag(args, '--current-round', 1),
        maxRounds: parseIntegerFlag(args, '--max-rounds', 50),
        budgetExceeded: hasFlag(args, '--budget-exceeded'),
      };
    }

    throw new Error(`Unknown todo subcommand: ${subcommand ?? '<empty>'}`);
  }

  if (command === 'plugin-discover') {
    return {
      type: 'plugin-discover',
      globalPluginsDir: getArgValue(rest, '--global'),
      projectPluginsDir: getArgValue(rest, '--project'),
      nodeModulesDir: getArgValue(rest, '--node-modules'),
      explicitConfig: getArgValue(rest, '--config'),
    };
  }

  if (command === 'plugin-bootstrap') {
    return {
      type: 'plugin-bootstrap',
      globalPluginsDir: getArgValue(rest, '--global'),
      projectPluginsDir: getArgValue(rest, '--project'),
      nodeModulesDir: getArgValue(rest, '--node-modules'),
      explicitConfig: getArgValue(rest, '--config'),
      enabledL3Plugins: getListArg(rest, '--enabled-l3'),
    };
  }

  if (command === 'plugin-exec') {
    const pluginName = getArgValue(rest, '--plugin');
    const toolName = getArgValue(rest, '--tool');
    if (!pluginName) {
      throw new Error('Missing required flag: --plugin');
    }
    if (!toolName) {
      throw new Error('Missing required flag: --tool');
    }

    return {
      type: 'plugin-exec',
      pluginName,
      toolName,
      args: parseJsonValue(getArgValue(rest, '--args-json'), '--args-json'),
      confirm: parseConfirmMode(rest),
      mode: parseAgentMode(getArgValue(rest, '--mode')),
      headless: hasFlag(rest, '--headless'),
      allowWrite: hasFlag(rest, '--allow-write'),
      allowShell: hasFlag(rest, '--allow-shell'),
      allowDangerous: hasFlag(rest, '--allow-dangerous'),
      policyMode: parsePolicyMode(getArgValue(rest, '--policy-mode')),
      allowedTools: getListArg(rest, '--allowed-tools'),
      deniedTools: getListArg(rest, '--denied-tools'),
      globalPluginsDir: getArgValue(rest, '--global'),
      projectPluginsDir: getArgValue(rest, '--project'),
      nodeModulesDir: getArgValue(rest, '--node-modules'),
      explicitConfig: getArgValue(rest, '--config'),
      enabledL3Plugins: getListArg(rest, '--enabled-l3'),
      dangerouslySkipPermissions: hasFlag(rest, '--dangerously-skip-permissions'),
    };
  }

  if (command === 'plugin' || command === '/plugin') {
    const subcommand = rest[0];
    const args = rest.slice(1);
    if (subcommand === 'list') {
      return {
        type: 'plugin-discover',
        globalPluginsDir: getArgValue(args, '--global'),
        projectPluginsDir: getArgValue(args, '--project'),
        nodeModulesDir: getArgValue(args, '--node-modules'),
        explicitConfig: getArgValue(args, '--config'),
      };
    }

    if (!subcommand) {
      throw new Error('Unknown plugin subcommand: <empty>');
    }

    return {
      type: 'plugin-exec',
      pluginName: subcommand,
      toolName: getArgValue(args, '--tool') ?? subcommand,
      args: parsePluginInlineArgs(args),
      confirm: parseConfirmMode(args),
      mode: parseAgentMode(getArgValue(args, '--mode')),
      headless: hasFlag(args, '--headless'),
      allowWrite: hasFlag(args, '--allow-write'),
      allowShell: hasFlag(args, '--allow-shell'),
      allowDangerous: hasFlag(args, '--allow-dangerous'),
      policyMode: parsePolicyMode(getArgValue(args, '--policy-mode')),
      allowedTools: getListArg(args, '--allowed-tools'),
      deniedTools: getListArg(args, '--denied-tools'),
      globalPluginsDir: getArgValue(args, '--global'),
      projectPluginsDir: getArgValue(args, '--project'),
      nodeModulesDir: getArgValue(args, '--node-modules'),
      explicitConfig: getArgValue(args, '--config'),
      enabledL3Plugins: getListArg(args, '--enabled-l3'),
      dangerouslySkipPermissions: hasFlag(args, '--dangerously-skip-permissions'),
    };
  }

  if (command === 'setup') {
    return {
      type: 'setup',
      server: getArgValue(rest, '--server'),
      apiKey: getArgValue(rest, '--api-key'),
      uninstall: hasFlag(rest, '--uninstall'),
    };
  }

  throw new Error(`Unknown command: ${command}`);
}
