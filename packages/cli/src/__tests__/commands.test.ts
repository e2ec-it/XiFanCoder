import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { BudgetExceededError, SessionManager } from '@xifan-coder/core';

import { executeCommand, executeCommandDetailed, formatCommandResultText, helpText, type CommandResult } from '../commands.js';

function writeExecutableScript(filePath: string, code: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, code, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function writeSkillFile(root: string, skillName: string, content: string): string {
  const dir = path.join(root, skillName);
  fs.mkdirSync(dir, { recursive: true });
  const skillFile = path.join(dir, 'SKILL.md');
  fs.writeFileSync(skillFile, content, 'utf8');
  return skillFile;
}

describe('executeCommand', () => {
  it('returns help text', async () => {
    const out = await executeCommand({ type: 'help' });
    expect(out).toContain('XiFanCoder CLI');
    expect(out).toContain('check-tool');
  });

  it('evaluates tool permission via SessionRuntime', async () => {
    const out = await executeCommand({
      type: 'check-tool',
      toolName: 'write_file',
      level: 'L1',
      mode: 'plan',
      headless: false,
      allowWrite: false,
      allowShell: false,
      allowDangerous: false,
      allowedTools: [],
      deniedTools: [],
      policyMode: 'compat',
      dangerouslySkipPermissions: false,
    });

    expect(out).toContain('allowed=false');
    expect(out).toContain('reason=denied_by_mode');
  });

  it('updates provider catalog from embedded source', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-cli-'));
    const target = path.join(root, 'catalog.json');

    const out = await executeCommand({
      type: 'provider-update',
      source: 'embedded',
      targetPath: target,
    });

    expect(out).toContain('provider catalog updated');
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(`${target}.meta.json`)).toBe(true);
  });

  it('resolves LiteLLM driver in auto mode with explicit yes', async () => {
    const out = await executeCommand(
      {
        type: 'resolve-llm-driver',
        mode: 'auto',
        headless: false,
        litellmBaseUrl: 'http://localhost:4000',
        confirm: 'yes',
      },
      {
        resolveDriverMode: async () => ({
          selectedDriver: 'litellm',
          reason: 'auto_user_accepted',
          litellmDetected: true,
          litellmBaseUrl: 'http://localhost:4000',
        }),
      },
    );

    expect(out).toContain('selected=litellm');
    expect(out).toContain('reason=auto_user_accepted');
  });

  it('lists builtin tools only when crush is unavailable', async () => {
    const out = await executeCommand(
      {
        type: 'tools',
        crushCommand: 'crush',
      },
      {
        detectCrushAvailability: () => ({
          available: false,
          command: 'crush',
          reason: 'not_found',
        }),
      },
    );

    expect(out).toContain('tools=5');
    expect(out).toContain('crushAvailable=false');
    expect(out).toContain('crushReason=not_found');
    expect(out).not.toContain('[crush]');
  });

  it('lists crush tools with [crush] prefix when crush is available', async () => {
    const out = await executeCommand(
      {
        type: 'tools',
        crushCommand: 'crush-dev',
      },
      {
        detectCrushAvailability: () => ({
          available: true,
          command: 'crush-dev',
        }),
      },
    );

    expect(out).toContain('tools=9');
    expect(out).toContain('crushAvailable=true');
    expect(out).toContain('crushCommand=crush-dev');
    expect(out).toContain('[crush] crush_file_read');
    expect(out).toContain('[crush] crush_search');
    expect(out).toContain('[crush] crush_shell');
    expect(out).toContain('[crush] crush_fetch');
  });

  it('persists and reads mode state', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mode-'));
    const storePath = path.join(root, 'session-mode.json');

    const setOut = await executeCommand({
      type: 'mode',
      action: 'set',
      value: 'plan',
      storePath,
    });
    expect(setOut).toContain('action=set');
    expect(setOut).toContain('mode=plan');

    const getOut = await executeCommand({
      type: 'mode',
      action: 'get',
      storePath,
    });
    expect(getOut).toContain('action=get');
    expect(getOut).toContain('mode=plan');
  });

  it('returns unavailable for unsupported lsp language', async () => {
    const out = await executeCommand({
      type: 'lsp',
      action: 'workspace-symbols',
      language: 'python',
      query: 'foo',
      rootDir: process.cwd(),
    });

    expect(out).toContain('action=workspace-symbols');
    expect(out).toContain('available=false');
  });

  it('supports lsp diagnostics/symbols/references/rename preview for typescript', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-cli-lsp-'));
    const filePath = path.join(root, 'demo.ts');
    fs.writeFileSync(
      filePath,
      ['const targetName = 1;', 'export function readTarget() {', '  return targetName;', '}'].join(
        '\n',
      ),
      'utf8',
    );

    const diagnostics = await executeCommand({
      type: 'lsp',
      action: 'diagnostics',
      language: 'typescript',
      filePath,
      content: 'const = 1;',
      rootDir: root,
    });
    expect(diagnostics).toContain('action=diagnostics');
    expect(diagnostics).toContain('available=true');
    expect(diagnostics).toContain('count=');

    const symbols = await executeCommand({
      type: 'lsp',
      action: 'workspace-symbols',
      language: 'typescript',
      query: 'readTarget',
      rootDir: root,
    });
    expect(symbols).toContain('action=workspace-symbols');
    expect(symbols).toContain('available=true');
    expect(symbols).toContain('readTarget');

    const refs = await executeCommand({
      type: 'lsp',
      action: 'references',
      language: 'typescript',
      filePath,
      line: 1,
      character: 7,
      rootDir: root,
    });
    expect(refs).toContain('action=references');
    expect(refs).toContain('available=true');

    const rename = await executeCommand({
      type: 'lsp',
      action: 'rename-preview',
      language: 'typescript',
      filePath,
      line: 1,
      character: 7,
      newName: 'renamedTarget',
      rootDir: root,
    });
    expect(rename).toContain('action=rename-preview');
    expect(rename).toContain('available=true');
    expect(rename).toContain('renamedTarget');
  });

  it('returns daemon connection failure as structured output', async () => {
    const out = await executeCommand(
      {
        type: 'daemon',
        action: 'ping',
        host: '127.0.0.1',
        port: 9321,
        token: 'secret',
      },
      {
        createDaemonClient: () => ({
          connect: async () => {
            throw new Error('ECONNREFUSED');
          },
          disconnect: async () => undefined,
          ping: async () => ({ status: 'ok' }),
          getSession: async () => [],
          appendSessionEvent: async () => {
            throw new Error('unreachable');
          },
        }),
      },
    );

    expect(out).toContain('action=ping');
    expect(out).toContain('connected=false');
    expect(out).toContain('ECONNREFUSED');
  });

  it('starts daemon server through adapter and prints bind info', async () => {
    let started = false;
    const out = await executeCommand(
      {
        type: 'daemon',
        action: 'serve',
        host: '127.0.0.1',
        port: 9321,
        token: 'secret',
      },
      {
        createDaemonServer: () => ({
          start: async () => {
            started = true;
            return {
              host: '127.0.0.1',
              port: 9321,
            };
          },
          stop: async () => undefined,
        }),
      },
    );

    expect(started).toBe(true);
    expect(out).toContain('action=serve');
    expect(out).toContain('connected=true');
    expect(out).toContain('host=127.0.0.1');
    expect(out).toContain('port=9321');
  });

  it('supports daemon append/get through client adapter', async () => {
    const events: Array<{
      id: string;
      sessionId: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: string;
      source: 'cli' | 'desktop' | 'daemon';
    }> = [];

    const deps = {
      createDaemonClient: () => ({
        connect: async () => undefined,
        disconnect: async () => undefined,
        ping: async () => ({ status: 'ok' }),
        getSession: async () => events,
        appendSessionEvent: async (input: {
          sessionId: string;
          role?: 'user' | 'assistant' | 'system';
          content: string;
          source?: 'cli' | 'desktop' | 'daemon';
        }) => {
          const next = {
            id: 'evt-1',
            sessionId: input.sessionId,
            role: input.role ?? 'user',
            content: input.content,
            timestamp: new Date().toISOString(),
            source: input.source ?? 'cli',
          } as const;
          events.push(next);
          return next;
        },
      }),
    } as const;

    const appended = await executeCommand(
      {
        type: 'daemon',
        action: 'append',
        host: '127.0.0.1',
        port: 9321,
        token: 'secret',
        sessionId: 's1',
        content: 'hello',
        role: 'user',
        source: 'cli',
      },
      deps,
    );
    expect(appended).toContain('action=append');
    expect(appended).toContain('connected=true');
    expect(appended).toContain('"content":"hello"');

    const listed = await executeCommand(
      {
        type: 'daemon',
        action: 'get',
        host: '127.0.0.1',
        port: 9321,
        token: 'secret',
        sessionId: 's1',
      },
      deps,
    );
    expect(listed).toContain('action=get');
    expect(listed).toContain('count=1');
    expect(listed).toContain('"sessionId":"s1"');
  });

  it('starts mcp server through adapter and reports status', async () => {
    let started = false;
    const out = await executeCommand(
      {
        type: 'mcp',
        action: 'serve',
        host: '127.0.0.1',
        port: 7890,
        path: '/mcp',
        token: 'secret',
        tokenFilePath: '/tmp/xifan.session.token',
        maxConnections: 10,
        requireTls: false,
        autoStartMemory: false,
        memoryDbPath: undefined,
      },
      {
        createMcpServer: () => ({
          start: async () => {
            started = true;
            return {
              host: '127.0.0.1',
              port: 7890,
              path: '/mcp',
              tokenFilePath: '/tmp/xifan.session.token',
              tlsEnabled: true,
              tlsCertPath: '/tmp/xifan.dev.cert.pem',
              connectedClients: 0,
              ideConnected: false,
            };
          },
          stop: async () => undefined,
        }),
      },
    );

    expect(started).toBe(true);
    expect(out).toContain('action=serve');
    expect(out).toContain('started=true');
    expect(out).toContain('port=7890');
    expect(out).toContain('tokenFile=/tmp/xifan.session.token');
    expect(out).toContain('tls=true');
    expect(out).toContain('tlsCert=/tmp/xifan.dev.cert.pem');
    expect(out).toContain('memoryStarted=false');
  });

  it('auto starts memory server when mcp serve uses --auto-memory path', async () => {
    let memoryStarted = false;
    const out = await executeCommand(
      {
        type: 'mcp',
        action: 'serve',
        host: '127.0.0.1',
        port: 7890,
        path: '/mcp',
        token: 'secret',
        tokenFilePath: undefined,
        maxConnections: 10,
        requireTls: false,
        autoStartMemory: true,
        memoryDbPath: '/tmp/xifan-memory.db',
      },
      {
        createMemoryMcpServer: (options) => ({
          start: async () => {
            memoryStarted = true;
            expect(options.dbPath).toBe('/tmp/xifan-memory.db');
            return {
              started: true,
              transport: 'stdio',
              toolCount: 4,
            };
          },
          stop: async () => undefined,
        }),
        createMcpServer: () => ({
          start: async () => ({
            host: '127.0.0.1',
            port: 7890,
            path: '/mcp',
            tokenFilePath: undefined,
            tlsEnabled: false,
            tlsCertPath: undefined,
            connectedClients: 0,
            ideConnected: false,
          }),
          stop: async () => undefined,
        }),
      },
    );

    expect(memoryStarted).toBe(true);
    expect(out).toContain('memoryStarted=true');
    expect(out).toContain('memoryTools=4');
  });

  it('starts memory mcp server through adapter and reports status', async () => {
    let started = false;
    const out = await executeCommand(
      {
        type: 'memory',
        action: 'serve',
        dbPath: '/tmp/xifan-memory.db',
      },
      {
        createMemoryMcpServer: (options) => ({
          start: async () => {
            started = true;
            expect(options.dbPath).toBe('/tmp/xifan-memory.db');
            return {
              started: true,
              transport: 'stdio',
              toolCount: 4,
            };
          },
          stop: async () => undefined,
        }),
      },
    );

    expect(started).toBe(true);
    expect(out).toContain('action=serve');
    expect(out).toContain('started=true');
    expect(out).toContain('transport=stdio');
    expect(out).toContain('tools=4');
  });

  it('searches memory records through memory manager adapter', async () => {
    let closed = false;
    const out = await executeCommand(
      {
        type: 'memory',
        action: 'search',
        dbPath: '/tmp/xifan-memory.db',
        query: 'auth',
        project: '/repo/demo',
        limit: 5,
      },
      {
        createMemoryManager: (options) => ({
          search: (query, searchOptions) => {
            expect(options.dbPath).toBe('/tmp/xifan-memory.db');
            expect(query).toBe('auth');
            expect(searchOptions?.project).toBe('/repo/demo');
            expect(searchOptions?.limit).toBe(5);
            return [
              {
                id: 'obs-1',
                memSessionId: 'mem-1',
                type: 'discovery',
                title: 'Auth fix',
                project: '/repo/demo',
                createdAt: Date.now(),
                snippet: 'updated auth flow',
              },
            ];
          },
          close: () => {
            closed = true;
          },
        }),
      },
    );

    expect(closed).toBe(true);
    expect(out).toContain('action=search');
    expect(out).toContain('count=1');
    expect(out).toContain('"id":"obs-1"');
  });

  it('opens memory viewer through adapter and reports URL', async () => {
    const out = await executeCommand(
      {
        type: 'memory',
        action: 'open',
        dbPath: '/tmp/xifan-memory.db',
        host: '127.0.0.1',
        port: 37777,
      },
      {
        createMemoryViewer: () => ({
          start: async () => ({
            started: true,
            host: '127.0.0.1',
            port: 37777,
            url: 'http://127.0.0.1:37777',
          }),
          stop: async () => undefined,
        }),
      },
    );

    expect(out).toContain('action=open');
    expect(out).toContain('started=true');
    expect(out).toContain('url=http://127.0.0.1:37777');
  });

  it('shows merged xifan context with source paths', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-context-show-'));
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'project', 'apps', 'web');
    fs.mkdirSync(path.join(home, '.xifan'), { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(home, '.xifan', 'XIFAN.md'), '## Rules\nglobal', 'utf8');
    fs.writeFileSync(path.join(cwd, 'XIFAN.md'), '## Rules\nlocal', 'utf8');

    const out = await executeCommand({
      type: 'context',
      action: 'show',
      cwd,
      homeDir: home,
      force: false,
    });

    expect(out).toContain('action=show');
    expect(out).toContain('sources=2');
    expect(out).toContain('local');
  });

  it('initializes xifan template and supports non-force idempotency', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-context-init-'));
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'demo',
        scripts: {
          build: 'pnpm build:prod',
          test: 'pnpm test:unit',
          lint: 'pnpm lint:ci',
        },
      }),
      'utf8',
    );

    const first = await executeCommand({
      type: 'context',
      action: 'init',
      cwd: root,
      force: false,
    });
    expect(first).toContain('action=init');
    expect(first).toContain('created=true');

    const target = path.join(root, '.xifan', 'XIFAN.md');
    const content = fs.readFileSync(target, 'utf8');
    expect(content).toContain('pnpm build:prod');
    expect(content).toContain('pnpm test:unit');

    const second = await executeCommand({
      type: 'context',
      action: 'init',
      cwd: root,
      force: false,
    });
    expect(second).toContain('created=false');
    expect(second).toContain('overwritten=false');
  });

  it('initializes runtime config file through config command', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-config-init-'));
    const targetPath = path.join(root, '.xifan', 'coder', 'config.yaml');

    const first = await executeCommand({
      type: 'config',
      action: 'init',
      targetPath,
      force: false,
    });
    expect(first).toContain('action=init');
    expect(first).toContain(`target=${targetPath}`);
    expect(first).toContain('created=true');

    const second = await executeCommand({
      type: 'config',
      action: 'init',
      targetPath,
      force: false,
    });
    expect(second).toContain('created=false');
    expect(second).toContain('overwritten=false');
  });

  it('supports session create/list/resume commands through session manager adapter', async () => {
    const sessions: Array<{
      id: string;
      projectPath: string;
      model: string;
      provider: string;
      status: 'active' | 'completed' | 'failed' | 'archived';
      agentMode: 'build' | 'plan';
      createdAt: number;
      updatedAt: number;
      totalTokens: number;
      totalCostUsd: number;
      messageCount: number;
    }> = [];
    const messages = new Map<string, Array<{ id: string; content: unknown }>>();

    const deps = {
      createSessionManager: () => ({
        createSession: (input: {
          projectPath: string;
          model: string;
          provider: string;
        }) => {
          const next = {
            id: `s${sessions.length + 1}`,
            projectPath: input.projectPath,
            model: input.model,
            provider: input.provider,
            status: 'active' as const,
            agentMode: 'build' as const,
            createdAt: 1,
            updatedAt: 1,
            totalTokens: 0,
            totalCostUsd: 0,
            messageCount: 1,
          };
          sessions.push(next);
          messages.set(next.id, [{ id: 'm1', content: 'hello' }]);
          return next;
        },
        listSessions: () => sessions,
        resumeSession: (id: string) => {
          const session = sessions.find((item) => item.id === id);
          if (!session) return undefined;
          return {
            session,
            messages:
              messages.get(id)?.map((item) => ({
                id: item.id,
                sessionId: id,
                role: 'assistant' as const,
                content: item.content,
                createdAt: 1,
              })) ?? [],
          };
        },
        getSessionCost: () => ({
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
          toolCallCount: 0,
        }),
        getTodayCost: () => ({
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
          toolCallCount: 0,
        }),
        getModelCost: () => ({
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
          toolCallCount: 0,
        }),
        close: () => undefined,
      }),
    } as const;

    const created = await executeCommand(
      {
        type: 'session',
        action: 'create',
        projectPath: '/repo/demo',
        model: 'gpt-4o',
        provider: 'openai',
        dbPath: '/tmp/sessions.db',
      },
      deps,
    );
    expect(created).toContain('action=create');
    expect(created).toContain('session=s1');

    const listed = await executeCommand(
      {
        type: 'session',
        action: 'list',
        projectPath: '/repo/demo',
        dbPath: '/tmp/sessions.db',
        limit: 20,
      },
      deps,
    );
    expect(listed).toContain('action=list');
    expect(listed).toContain('sessions=1');

    const resumed = await executeCommand(
      {
        type: 'session',
        action: 'resume',
        id: 's1',
        dbPath: '/tmp/sessions.db',
      },
      deps,
    );
    expect(resumed).toContain('action=resume');
    expect(resumed).toContain('found=true');
    expect(resumed).toContain('messages=1');
  });

  it('supports /cost output for session/today/model scopes', async () => {
    const deps = {
      createSessionManager: () => ({
        createSession: () => {
          throw new Error('not used');
        },
        listSessions: () => [
          {
            id: 's-latest',
            projectPath: '/repo/demo',
            model: 'gpt-4o',
            provider: 'openai',
            status: 'active' as const,
            agentMode: 'build' as const,
            createdAt: 1,
            updatedAt: 1,
            totalTokens: 500,
            totalCostUsd: 0.123,
            messageCount: 2,
          },
        ],
        resumeSession: () => undefined,
        getSessionCost: () => ({
          promptTokens: 100,
          completionTokens: 200,
          totalTokens: 300,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.03,
          toolCallCount: 2,
        }),
        getTodayCost: () => ({
          promptTokens: 500,
          completionTokens: 800,
          totalTokens: 1300,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.13,
          toolCallCount: 5,
        }),
        getModelCost: () => ({
          promptTokens: 700,
          completionTokens: 900,
          totalTokens: 1600,
          cacheReadTokens: 10,
          cacheWriteTokens: 20,
          costUsd: 0.2,
          toolCallCount: 6,
        }),
        close: () => undefined,
      }),
    } as const;

    const sessionOut = await executeCommand(
      {
        type: 'cost',
        sessionId: 's-1',
        today: false,
        model: undefined,
        dbPath: '/tmp/s.db',
      },
      deps,
    );
    expect(sessionOut).toContain('scope=session');
    expect(sessionOut).toContain('session=s-1');
    expect(sessionOut).toContain('totalTokens=300');

    const todayOut = await executeCommand(
      {
        type: 'cost',
        sessionId: undefined,
        today: true,
        model: undefined,
        dbPath: '/tmp/s.db',
      },
      deps,
    );
    expect(todayOut).toContain('scope=today');
    expect(todayOut).toContain('totalTokens=1300');

    const modelOut = await executeCommand(
      {
        type: 'cost',
        sessionId: undefined,
        today: false,
        model: 'gpt-4o',
        dbPath: '/tmp/s.db',
      },
      deps,
    );
    expect(modelOut).toContain('scope=model');
    expect(modelOut).toContain('model=gpt-4o');
    expect(modelOut).toContain('cacheReadTokens=10');
  });

  it('integrates token usage persistence, budget checks, and /cost output', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-cost-int-'));
    const dbPath = path.join(root, 'session.db');
    let idCounter = 0;
    const manager = new SessionManager({
      dbPath,
      allowExternalDbPath: true,
      idGenerator: () => {
        idCounter += 1;
        return `id-${idCounter}`;
      },
    });
    try {
      const session = manager.createSession({
        projectPath: '/repo/demo',
        model: 'gpt-4o',
        provider: 'openai',
      });
      manager.recordTokenUsage({
        sessionId: session.id,
        role: 'assistant',
        promptTokens: 1200,
        completionTokens: 800,
      });
      manager.recordTokenUsage({
        sessionId: session.id,
        role: 'assistant',
        promptTokens: 600,
        completionTokens: 400,
      });

      expect(() =>
        manager.checkBudget({
          sessionId: session.id,
          sessionBudgetUsd: 0.000001,
        }),
      ).toThrow(BudgetExceededError);
    } finally {
      manager.close();
    }

    const costDeps = {
      createSessionManager: (options: { dbPath?: string }) =>
        new SessionManager({
          dbPath: options.dbPath,
          allowExternalDbPath: true,
        }),
    };

    const out = await executeCommand(
      {
        type: 'cost',
        sessionId: undefined,
        today: false,
        model: undefined,
        dbPath,
      },
      costDeps,
    );
    expect(out).toContain('scope=session');
    expect(out).toContain('totalTokens=3000');
    expect(out).toContain('costUsd=');

    const today = await executeCommand(
      {
        type: 'cost',
        sessionId: undefined,
        today: true,
        model: undefined,
        dbPath,
      },
      costDeps,
    );
    expect(today).toContain('scope=today');
    expect(today).toContain('totalTokens=3000');
  });

  it('lists discovered skills from global and project roots', async () => {
    const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-skills-global-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-skills-project-'));
    writeSkillFile(globalRoot, 'alpha', '# Alpha Skill\n\nalpha content');
    writeSkillFile(projectRoot, 'beta', '# Beta Skill\n\nbeta content');

    const out = await executeCommand({
      type: 'skill-list',
      globalSkillsDir: globalRoot,
      projectSkillsDir: projectRoot,
    });

    expect(out).toContain('skills=2');
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
  });

  it('applies skill content when skill-use is allowed', async () => {
    const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-skill-use-'));
    const skillFile = writeSkillFile(globalRoot, 'alpha', '# Alpha Skill\n\nUse alpha');

    const out = await executeCommand({
      type: 'skill-use',
      skillName: 'alpha',
      globalSkillsDir: globalRoot,
      projectSkillsDir: path.join(globalRoot, 'project-empty'),
      mode: 'build',
      headless: false,
      allowWrite: false,
      allowShell: false,
      allowDangerous: false,
      policyMode: 'compat',
      allowedTools: [],
      deniedTools: [],
    });

    expect(out).toContain('skill=alpha');
    expect(out).toContain('applied=true');
    expect(out).toContain(skillFile);
    expect(out).toContain('Use alpha');
  });

  it('denies skill-use when strict allowlist does not include skill tool', async () => {
    const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-skill-deny-'));
    writeSkillFile(globalRoot, 'alpha', '# Alpha Skill\n\nUse alpha');

    const out = await executeCommand({
      type: 'skill-use',
      skillName: 'alpha',
      globalSkillsDir: globalRoot,
      projectSkillsDir: path.join(globalRoot, 'project-empty'),
      mode: 'build',
      headless: false,
      allowWrite: false,
      allowShell: false,
      allowDangerous: false,
      policyMode: 'strict',
      allowedTools: ['read_file'],
      deniedTools: [],
    });

    expect(out).toContain('applied=false');
    expect(out).toContain('reason=denied_by_allowlist');
  });

  it('returns skill_read_failed instead of throwing when skill loading fails', async () => {
    const out = await executeCommand(
      {
        type: 'skill-use',
        skillName: 'broken',
        globalSkillsDir: '/tmp/global-skills',
        projectSkillsDir: '/tmp/project-skills',
        mode: 'build',
        headless: false,
        allowWrite: false,
        allowShell: false,
        allowDangerous: false,
        policyMode: 'compat',
        allowedTools: [],
        deniedTools: [],
      },
      {
        discoverSkills: async () => [
          {
            name: 'broken',
            rootPath: '/tmp/global-skills/broken',
            skillFilePath: '/tmp/global-skills/broken/SKILL.md',
          },
        ],
        readSkill: async () => {
          throw new Error('bad markdown');
        },
      },
    );

    expect(out).toContain('applied=false');
    expect(out).toContain('reason=skill_read_failed');
  });

  it('manages todo task lifecycle with persisted store', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-todo-'));
    const storePath = path.join(root, 'tasks.json');

    const added = await executeCommand({
      type: 'todo',
      action: 'add',
      storePath,
      id: 't1',
      title: 'implement feature',
    });
    expect(added).toContain('action=add');
    expect(added).toContain('t1 status=pending');

    const started = await executeCommand({
      type: 'todo',
      action: 'start',
      storePath,
      id: 't1',
    });
    expect(started).toContain('action=start');
    expect(started).toContain('t1 status=in_progress');

    const done = await executeCommand({
      type: 'todo',
      action: 'done',
      storePath,
      id: 't1',
    });
    expect(done).toContain('action=done');
    expect(done).toContain('t1 status=done');

    const listed = await executeCommand({
      type: 'todo',
      action: 'list',
      storePath,
    });
    expect(listed).toContain('action=list');
    expect(listed).toContain('t1 status=done');
  });

  it('returns structured continuation guard info for unfinished todo items', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-todo-guard-'));
    const storePath = path.join(root, 'tasks.json');

    await executeCommand({
      type: 'todo',
      action: 'add',
      storePath,
      id: 't1',
      title: 'step1',
    });
    await executeCommand({
      type: 'todo',
      action: 'start',
      storePath,
      id: 't1',
    });

    const guarded = await executeCommand({
      type: 'todo',
      action: 'guard',
      storePath,
      currentRound: 1,
      maxRounds: 5,
      budgetExceeded: false,
    });

    expect(guarded).toContain('action=guard');
    expect(guarded).toContain('shouldContinue=true');
    expect(guarded).toContain('reason=unfinished_tasks');
    expect(guarded).toContain('["t1"]');
  });

  it('discovers plugins and prints summary', async () => {
    const out = await executeCommand(
      {
        type: 'plugin-discover',
        globalPluginsDir: '/tmp/global',
        projectPluginsDir: '/tmp/project',
        nodeModulesDir: '/tmp/node_modules',
        explicitConfig: '/tmp/plugins.json',
      },
      {
        discoverPlugins: async () => [
          {
            name: 'alpha',
            version: '1.2.3',
            description: '',
            type: 'node',
            module: '@xifan-coder/plugin-alpha',
            enabled: true,
            requireConfirmation: false,
            permissionLevel: 1,
            source: 'explicit',
          },
        ],
      },
    );

    expect(out).toContain('plugins=1');
    expect(out).toContain('alpha@1.2.3');
    expect(out).toContain('source=explicit');
  });

  it('bootstraps plugins and prints runtime status summary', async () => {
    const out = await executeCommand(
      {
        type: 'plugin-bootstrap',
        globalPluginsDir: '/tmp/global',
        projectPluginsDir: '/tmp/project',
        nodeModulesDir: '/tmp/node_modules',
        explicitConfig: '/tmp/plugins.json',
        enabledL3Plugins: ['danger'],
      },
      {
        bootstrapPlugins: async () => [
          {
            manifest: {
              name: 'danger',
              version: '1.0.0',
              description: '',
              type: 'python',
              module: '@xifan-coder/plugin-danger',
              enabled: true,
              requireConfirmation: true,
              permissionLevel: 3,
              source: 'explicit',
            },
            status: 'ready',
            pid: 1234,
            loadedAt: 1000,
          },
        ],
      },
    );

    expect(out).toContain('plugins=1');
    expect(out).toContain('danger status=ready');
  });

  it('executes plugin tool and prints execution result', async () => {
    const out = await executeCommand(
      {
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
        allowedTools: [],
        deniedTools: [],
        globalPluginsDir: '/tmp/global',
        projectPluginsDir: '/tmp/project',
        nodeModulesDir: '/tmp/node_modules',
        explicitConfig: '/tmp/plugins.json',
        enabledL3Plugins: [],
      },
      {
        discoverPlugins: async () => [
          {
            name: 'safe',
            version: '1.0.0',
            description: '',
            type: 'node',
            module: '@xifan-coder/plugin-safe',
            enabled: true,
            requireConfirmation: false,
            permissionLevel: 0,
            source: 'explicit',
          },
        ],
        executePluginTool: async () => ({
          result: {
            content: { echoed: 'hello' },
          },
          pluginEntry: {
            manifest: {
              name: 'safe',
              version: '1.0.0',
              description: '',
              type: 'node',
              module: '@xifan-coder/plugin-safe',
              enabled: true,
              requireConfirmation: false,
              permissionLevel: 0,
              source: 'explicit',
            },
            status: 'ready',
          },
        }),
      },
    );

    expect(out).toContain('plugin=safe');
    expect(out).toContain('tool=safe_echo');
    expect(out).toContain('executed=true');
    expect(out).toContain('status=ready');
    expect(out).toContain('"echoed":"hello"');
  });

  it('denies plugin tool when approval is required and stdin is not tty', async () => {
    const out = await executeCommand(
      {
        type: 'plugin-exec',
        pluginName: 'safe',
        toolName: 'safe_write',
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
        globalPluginsDir: '/tmp/global',
        projectPluginsDir: '/tmp/project',
        nodeModulesDir: '/tmp/node_modules',
        explicitConfig: '/tmp/plugins.json',
        enabledL3Plugins: [],
      },
      {
        stdinIsTTY: false,
        discoverPlugins: async () => [
          {
            name: 'safe',
            version: '1.0.0',
            description: '',
            type: 'node',
            module: '@xifan-coder/plugin-safe',
            enabled: true,
            requireConfirmation: false,
            permissionLevel: 1,
            source: 'explicit',
          },
        ],
        executePluginTool: async () => {
          throw new Error('should not execute when approval is missing');
        },
      },
    );

    expect(out).toContain('plugin=safe');
    expect(out).toContain('executed=false');
    expect(out).toContain('reason=approval_required');
  });

  it('executes plugin tool when --yes is set in non-tty mode', async () => {
    const out = await executeCommand(
      {
        type: 'plugin-exec',
        pluginName: 'safe',
        toolName: 'safe_write',
        args: { message: 'hello' },
        confirm: 'yes',
        mode: 'build',
        headless: false,
        allowWrite: false,
        allowShell: false,
        allowDangerous: false,
        policyMode: 'compat',
      dangerouslySkipPermissions: false,
        allowedTools: [],
        deniedTools: [],
        globalPluginsDir: '/tmp/global',
        projectPluginsDir: '/tmp/project',
        nodeModulesDir: '/tmp/node_modules',
        explicitConfig: '/tmp/plugins.json',
        enabledL3Plugins: [],
      },
      {
        stdinIsTTY: false,
        discoverPlugins: async () => [
          {
            name: 'safe',
            version: '1.0.0',
            description: '',
            type: 'node',
            module: '@xifan-coder/plugin-safe',
            enabled: true,
            requireConfirmation: false,
            permissionLevel: 1,
            source: 'explicit',
          },
        ],
        executePluginTool: async () => ({
          result: {
            content: { wrote: true },
          },
          pluginEntry: {
            manifest: {
              name: 'safe',
              version: '1.0.0',
              description: '',
              type: 'node',
              module: '@xifan-coder/plugin-safe',
              enabled: true,
              requireConfirmation: false,
              permissionLevel: 1,
              source: 'explicit',
            },
            status: 'ready',
          },
        }),
      },
    );

    expect(out).toContain('plugin=safe');
    expect(out).toContain('executed=true');
    expect(out).toContain('"wrote":true');
  });

  it('executes plugin tool when approval is granted in tty mode', async () => {
    const out = await executeCommand(
      {
        type: 'plugin-exec',
        pluginName: 'safe',
        toolName: 'safe_write',
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
        globalPluginsDir: '/tmp/global',
        projectPluginsDir: '/tmp/project',
        nodeModulesDir: '/tmp/node_modules',
        explicitConfig: '/tmp/plugins.json',
        enabledL3Plugins: [],
      },
      {
        stdinIsTTY: true,
        promptYesNo: async () => true,
        discoverPlugins: async () => [
          {
            name: 'safe',
            version: '1.0.0',
            description: '',
            type: 'node',
            module: '@xifan-coder/plugin-safe',
            enabled: true,
            requireConfirmation: false,
            permissionLevel: 1,
            source: 'explicit',
          },
        ],
        executePluginTool: async () => ({
          result: {
            content: { wrote: true },
          },
          pluginEntry: {
            manifest: {
              name: 'safe',
              version: '1.0.0',
              description: '',
              type: 'node',
              module: '@xifan-coder/plugin-safe',
              enabled: true,
              requireConfirmation: false,
              permissionLevel: 1,
              source: 'explicit',
            },
            status: 'ready',
          },
        }),
      },
    );

    expect(out).toContain('plugin=safe');
    expect(out).toContain('executed=true');
    expect(out).toContain('"wrote":true');
  });

  it('denies plugin tool in headless mode by default for write-level plugin', async () => {
    const out = await executeCommand(
      {
        type: 'plugin-exec',
        pluginName: 'safe',
        toolName: 'safe_write',
        args: { message: 'hello' },
        confirm: 'ask',
        mode: 'build',
        headless: true,
        allowWrite: false,
        allowShell: false,
        allowDangerous: false,
        policyMode: 'compat',
      dangerouslySkipPermissions: false,
        allowedTools: [],
        deniedTools: [],
        globalPluginsDir: '/tmp/global',
        projectPluginsDir: '/tmp/project',
        nodeModulesDir: '/tmp/node_modules',
        explicitConfig: '/tmp/plugins.json',
        enabledL3Plugins: [],
      },
      {
        discoverPlugins: async () => [
          {
            name: 'safe',
            version: '1.0.0',
            description: '',
            type: 'node',
            module: '@xifan-coder/plugin-safe',
            enabled: true,
            requireConfirmation: false,
            permissionLevel: 1,
            source: 'explicit',
          },
        ],
        executePluginTool: async () => {
          throw new Error('should not execute when denied');
        },
      },
    );

    expect(out).toContain('plugin=safe');
    expect(out).toContain('executed=false');
    expect(out).toContain('reason=denied_by_headless_policy');
  });

  it('denies plugin tool when explicitly listed in denied tools', async () => {
    const out = await executeCommand(
      {
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
        policyMode: 'strict',
      dangerouslySkipPermissions: false,
        allowedTools: [],
        deniedTools: ['safe:safe_echo'],
        globalPluginsDir: '/tmp/global',
        projectPluginsDir: '/tmp/project',
        nodeModulesDir: '/tmp/node_modules',
        explicitConfig: '/tmp/plugins.json',
        enabledL3Plugins: [],
      },
      {
        discoverPlugins: async () => [
          {
            name: 'safe',
            version: '1.0.0',
            description: '',
            type: 'node',
            module: '@xifan-coder/plugin-safe',
            enabled: true,
            requireConfirmation: false,
            permissionLevel: 0,
            source: 'explicit',
          },
        ],
        executePluginTool: async () => {
          throw new Error('should not execute when deny list blocks');
        },
      },
    );

    expect(out).toContain('executed=false');
    expect(out).toContain('reason=denied_by_denylist');
  });

  it('executes plugin-exec via real plugin-bus child process', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-cli-plugin-e2e-'));
    const script = path.join(root, 'echo-plugin.mjs');
    const configPath = path.join(root, 'plugins.json');

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
        "    const payload = { echoed: req.params.args?.message ?? null };",
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

    const out = await executeCommand({
      type: 'plugin-exec',
      pluginName: 'echo',
      toolName: 'echo',
      args: { message: 'hello-e2e' },
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
      globalPluginsDir: path.join(root, 'global'),
      projectPluginsDir: path.join(root, 'project'),
      nodeModulesDir: path.join(root, 'node_modules'),
      explicitConfig: configPath,
      enabledL3Plugins: [],
    });

    expect(out).toContain('plugin=echo');
    expect(out).toContain('executed=true');
    expect(out).toContain('"echoed":"hello-e2e"');
  });
});

describe('executeCommandDetailed', () => {
  it('returns structured result for check-tool', async () => {
    const result = await executeCommandDetailed({
      type: 'check-tool',
      toolName: 'write_file',
      level: 'L1',
      mode: 'plan',
      headless: false,
      allowWrite: false,
      allowShell: false,
      allowDangerous: false,
      allowedTools: [],
      deniedTools: [],
      policyMode: 'compat',
      dangerouslySkipPermissions: false,
    });

    expect(result.type).toBe('check-tool');
    if (result.type === 'check-tool') {
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('denied_by_mode');
    }
  });

  it('allows check-tool under dangerously skip permissions override', async () => {
    const result = await executeCommandDetailed({
      type: 'check-tool',
      toolName: 'bash_execute',
      level: 'L2',
      mode: 'plan',
      headless: true,
      allowWrite: false,
      allowShell: false,
      allowDangerous: false,
      allowedTools: [],
      deniedTools: [],
      policyMode: 'strict',
      dangerouslySkipPermissions: true,
    });

    expect(result.type).toBe('check-tool');
    if (result.type === 'check-tool') {
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    }
  });

  it('returns structured provider update result', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-cli-detailed-'));
    const target = path.join(root, 'catalog.json');
    const result = await executeCommandDetailed({
      type: 'provider-update',
      source: 'embedded',
      targetPath: target,
    });

    expect(result.type).toBe('provider-update');
    if (result.type === 'provider-update') {
      expect(result.version.length).toBeGreaterThan(0);
      expect(result.checksum.length).toBeGreaterThan(0);
    }
  });

  it('returns not-found session resume result when session does not exist', async () => {
    const result = await executeCommandDetailed(
      {
        type: 'session',
        action: 'resume',
        id: 'missing',
        dbPath: ':memory:',
      },
      {
        createSessionManager: () => ({
          createSession: () => {
            throw new Error('not used');
          },
          listSessions: () => [],
          resumeSession: () => undefined,
          getSessionCost: () => ({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            toolCallCount: 0,
          }),
          getTodayCost: () => ({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            toolCallCount: 0,
          }),
          getModelCost: () => ({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            toolCallCount: 0,
          }),
          close: () => undefined,
        }),
      },
    );

    expect(result.type).toBe('session');
    if (result.type === 'session') {
      expect(result.action).toBe('resume');
      expect(result.found).toBe(false);
    }
  });

  it('resumes latest session when resume id is omitted', async () => {
    const result = await executeCommandDetailed(
      {
        type: 'session',
        action: 'resume',
        id: undefined,
        dbPath: ':memory:',
      },
      {
        createSessionManager: () => ({
          createSession: () => {
            throw new Error('not used');
          },
          listSessions: () => [
            {
              id: 's-latest',
              projectPath: '/tmp/project',
              model: 'gpt-4o',
              provider: 'openai',
              agentMode: 'build',
              contextSnapshot: undefined,
              totalTokens: 0,
              totalCostUsd: 0,
              messageCount: 1,
              memSessionId: undefined,
              createdAt: '2026-02-21T00:00:00.000Z',
              updatedAt: '2026-02-21T00:00:00.000Z',
            },
          ],
          resumeSession: (sessionId: string) =>
            sessionId === 's-latest'
              ? {
                  session: {
                    id: 's-latest',
                    projectPath: '/tmp/project',
                    model: 'gpt-4o',
                    provider: 'openai',
                    agentMode: 'build',
                    contextSnapshot: undefined,
                    totalTokens: 0,
                    totalCostUsd: 0,
                    messageCount: 1,
                    memSessionId: undefined,
                    createdAt: '2026-02-21T00:00:00.000Z',
                    updatedAt: '2026-02-21T00:00:00.000Z',
                  },
                  messages: [
                    {
                      id: 'm1',
                      sessionId: 's-latest',
                      role: 'user',
                      content: 'hello',
                      toolCalls: undefined,
                      toolCallId: undefined,
                      toolName: undefined,
                      tokenCount: 3,
                      createdAt: '2026-02-21T00:00:00.000Z',
                    },
                  ],
                }
              : undefined,
          getSessionCost: () => ({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            toolCallCount: 0,
          }),
          getTodayCost: () => ({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            toolCallCount: 0,
          }),
          getModelCost: () => ({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            toolCallCount: 0,
          }),
          close: () => undefined,
        }),
      },
    );

    expect(result.type).toBe('session');
    if (result.type === 'session') {
      expect(result.action).toBe('resume');
      expect(result.found).toBe(true);
      expect(result.session?.id).toBe('s-latest');
      expect(result.messages?.length).toBe(1);
    }
  });

  it('returns daemon serve error when server start fails', async () => {
    const result = await executeCommandDetailed(
      {
        type: 'daemon',
        action: 'serve',
        host: '127.0.0.1',
        port: 9321,
        token: 'secret',
      },
      {
        createDaemonServer: () => ({
          start: async () => {
            throw new Error('port in use');
          },
          stop: async () => undefined,
        }),
      },
    );

    expect(result.type).toBe('daemon');
    if (result.type === 'daemon') {
      expect(result.action).toBe('serve');
      expect(result.connected).toBe(false);
      expect(result.reason).toBe('port in use');
    }
  });

  it('returns daemon ping success through client adapter', async () => {
    const result = await executeCommandDetailed(
      {
        type: 'daemon',
        action: 'ping',
        host: '127.0.0.1',
        port: 9321,
        token: 'secret',
      },
      {
        createDaemonClient: () => ({
          connect: async () => undefined,
          disconnect: async () => undefined,
          ping: async () => ({ status: 'ok' }),
          getSession: async () => [],
          appendSessionEvent: async () => {
            throw new Error('unreachable');
          },
        }),
      },
    );

    expect(result.type).toBe('daemon');
    if (result.type === 'daemon') {
      expect(result.action).toBe('ping');
      expect(result.connected).toBe(true);
      expect(result.status).toBe('ok');
    }
  });

  it('returns daemon command error on post-connect failure', async () => {
    const result = await executeCommandDetailed(
      {
        type: 'daemon',
        action: 'ping',
        host: '127.0.0.1',
        port: 9321,
        token: 'secret',
      },
      {
        createDaemonClient: () => ({
          connect: async () => undefined,
          disconnect: async () => undefined,
          ping: async () => {
            throw new Error('protocol error');
          },
          getSession: async () => [],
          appendSessionEvent: async () => {
            throw new Error('unreachable');
          },
        }),
      },
    );

    expect(result.type).toBe('daemon');
    if (result.type === 'daemon') {
      expect(result.connected).toBe(false);
      expect(result.reason).toBe('protocol error');
    }
  });

  it('throws when session create is missing model or provider', async () => {
    await expect(
      executeCommandDetailed(
        {
          type: 'session',
          action: 'create',
          projectPath: '/repo/demo',
          model: undefined as unknown as string,
          provider: undefined as unknown as string,
          dbPath: ':memory:',
        },
        {
          createSessionManager: () => ({
            createSession: () => {
              throw new Error('not used');
            },
            listSessions: () => [],
            resumeSession: () => undefined,
            getSessionCost: () => ({
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costUsd: 0,
              toolCallCount: 0,
            }),
            getTodayCost: () => ({
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costUsd: 0,
              toolCallCount: 0,
            }),
            getModelCost: () => ({
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costUsd: 0,
              toolCallCount: 0,
            }),
            close: () => undefined,
          }),
        },
      ),
    ).rejects.toThrow('session create requires --model and --provider');
  });

  it('returns not-found session resume when no sessions exist and id is omitted', async () => {
    const result = await executeCommandDetailed(
      {
        type: 'session',
        action: 'resume',
        id: undefined,
        dbPath: ':memory:',
      },
      {
        createSessionManager: () => ({
          createSession: () => {
            throw new Error('not used');
          },
          listSessions: () => [],
          resumeSession: () => undefined,
          getSessionCost: () => ({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            toolCallCount: 0,
          }),
          getTodayCost: () => ({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            toolCallCount: 0,
          }),
          getModelCost: () => ({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            toolCallCount: 0,
          }),
          close: () => undefined,
        }),
      },
    );

    expect(result.type).toBe('session');
    if (result.type === 'session') {
      expect(result.action).toBe('resume');
      expect(result.found).toBe(false);
    }
  });

  it('returns empty cost aggregate when no sessions exist', async () => {
    const result = await executeCommandDetailed(
      {
        type: 'cost',
        sessionId: undefined,
        today: false,
        model: undefined,
        dbPath: ':memory:',
      },
      {
        createSessionManager: () => ({
          createSession: () => {
            throw new Error('not used');
          },
          listSessions: () => [],
          resumeSession: () => undefined,
          getSessionCost: () => ({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            toolCallCount: 0,
          }),
          getTodayCost: () => ({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            toolCallCount: 0,
          }),
          getModelCost: () => ({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            toolCallCount: 0,
          }),
          close: () => undefined,
        }),
      },
    );

    expect(result.type).toBe('cost');
    if (result.type === 'cost') {
      expect(result.scope).toBe('session');
      expect(result.aggregate.totalTokens).toBe(0);
    }
  });

  it('returns skill_not_found when skill-use targets a missing skill', async () => {
    const result = await executeCommandDetailed(
      {
        type: 'skill-use',
        skillName: 'nonexistent',
        globalSkillsDir: '/tmp/empty-skills',
        projectSkillsDir: '/tmp/empty-project-skills',
        mode: 'build',
        headless: false,
        allowWrite: false,
        allowShell: false,
        allowDangerous: false,
        policyMode: 'compat',
        allowedTools: [],
        deniedTools: [],
      },
      {
        discoverSkills: async () => [],
      },
    );

    expect(result.type).toBe('skill-use');
    if (result.type === 'skill-use') {
      expect(result.applied).toBe(false);
      expect(result.reason).toBe('skill_not_found');
    }
  });

  it('gracefully handles read errors in skill-list', async () => {
    const result = await executeCommandDetailed(
      {
        type: 'skill-list',
        globalSkillsDir: '/tmp/skills-global',
        projectSkillsDir: '/tmp/skills-project',
      },
      {
        discoverSkills: async () => [
          {
            name: 'broken-skill',
            rootPath: '/tmp/skills-global/broken-skill',
            skillFilePath: '/tmp/skills-global/broken-skill/SKILL.md',
          },
        ],
        readSkill: async () => {
          throw new Error('parse error');
        },
      },
    );

    expect(result.type).toBe('skill-list');
    if (result.type === 'skill-list') {
      expect(result.skills.length).toBe(1);
      expect(result.skills[0]?.title).toBe('broken-skill');
    }
  });

  it('throws when todo add is missing id or title', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-todo-throw-'));
    const storePath = path.join(root, 'tasks.json');

    await expect(
      executeCommandDetailed({
        type: 'todo',
        action: 'add',
        storePath,
        id: undefined as unknown as string,
        title: undefined as unknown as string,
      }),
    ).rejects.toThrow('todo add requires id and title');
  });

  it('throws when todo start is missing id', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-todo-start-throw-'));
    const storePath = path.join(root, 'tasks.json');

    await expect(
      executeCommandDetailed({
        type: 'todo',
        action: 'start',
        storePath,
        id: undefined as unknown as string,
      }),
    ).rejects.toThrow('todo start requires id');
  });

  it('throws when todo done is missing id', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-todo-done-throw-'));
    const storePath = path.join(root, 'tasks.json');

    await expect(
      executeCommandDetailed({
        type: 'todo',
        action: 'done',
        storePath,
        id: undefined as unknown as string,
      }),
    ).rejects.toThrow('todo done requires id');
  });

  it('throws when todo block is missing id or reason', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-todo-block-throw-'));
    const storePath = path.join(root, 'tasks.json');

    await expect(
      executeCommandDetailed({
        type: 'todo',
        action: 'block',
        storePath,
        id: undefined as unknown as string,
        reason: undefined as unknown as string,
      }),
    ).rejects.toThrow('todo block requires id and reason');
  });

  it('deserializes blocked tasks from persisted todo store', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-todo-blocked-'));
    const storePath = path.join(root, 'tasks.json');

    await executeCommand({
      type: 'todo',
      action: 'add',
      storePath,
      id: 'b1',
      title: 'blocked task',
    });
    await executeCommand({
      type: 'todo',
      action: 'block',
      storePath,
      id: 'b1',
      reason: 'waiting for dep',
    });

    const listed = await executeCommand({
      type: 'todo',
      action: 'list',
      storePath,
    });
    expect(listed).toContain('b1 status=blocked');
    expect(listed).toContain('waiting for dep');
  });

  it('throws on invalid todo store format', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-todo-invalid-'));
    const storePath = path.join(root, 'tasks.json');
    fs.writeFileSync(storePath, '"not-an-array"', 'utf8');

    await expect(
      executeCommandDetailed({
        type: 'todo',
        action: 'list',
        storePath,
      }),
    ).rejects.toThrow('Invalid todo store format');
  });

  it('throws on invalid mode store format', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mode-invalid-'));
    const storePath = path.join(root, 'session-mode.json');
    fs.writeFileSync(storePath, JSON.stringify({ mode: 'invalid' }), 'utf8');

    await expect(
      executeCommandDetailed({
        type: 'mode',
        action: 'get',
        storePath,
      }),
    ).rejects.toThrow('Invalid mode store format');
  });

  it('returns default mode when store file does not exist', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-mode-default-'));
    const storePath = path.join(root, 'nonexistent', 'session-mode.json');

    const result = await executeCommandDetailed({
      type: 'mode',
      action: 'get',
      storePath,
    });

    expect(result.type).toBe('mode');
    if (result.type === 'mode') {
      expect(result.mode).toBe('build');
    }
  });

  it('throws when plugin-exec targets a non-existent plugin', async () => {
    await expect(
      executeCommandDetailed(
        {
          type: 'plugin-exec',
          pluginName: 'missing',
          toolName: 'do_thing',
          args: {},
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
          globalPluginsDir: '/tmp/global',
          projectPluginsDir: '/tmp/project',
          nodeModulesDir: '/tmp/node_modules',
          explicitConfig: '/tmp/plugins.json',
          enabledL3Plugins: [],
        },
        {
          discoverPlugins: async () => [],
        },
      ),
    ).rejects.toThrow('plugin not found: missing');
  });

  it('denies plugin-exec when confirm is explicitly no', async () => {
    const out = await executeCommand(
      {
        type: 'plugin-exec',
        pluginName: 'safe',
        toolName: 'safe_write',
        args: { message: 'hello' },
        confirm: 'no',
        mode: 'build',
        headless: false,
        allowWrite: false,
        allowShell: false,
        allowDangerous: false,
        policyMode: 'compat',
        dangerouslySkipPermissions: false,
        allowedTools: [],
        deniedTools: [],
        globalPluginsDir: '/tmp/global',
        projectPluginsDir: '/tmp/project',
        nodeModulesDir: '/tmp/node_modules',
        explicitConfig: '/tmp/plugins.json',
        enabledL3Plugins: [],
      },
      {
        stdinIsTTY: true,
        discoverPlugins: async () => [
          {
            name: 'safe',
            version: '1.0.0',
            description: '',
            type: 'node',
            module: '@xifan-coder/plugin-safe',
            enabled: true,
            requireConfirmation: false,
            permissionLevel: 1,
            source: 'explicit',
          },
        ],
        executePluginTool: async () => {
          throw new Error('should not be called');
        },
      },
    );

    expect(out).toContain('executed=false');
    expect(out).toContain('reason=approval_required');
  });

  it('returns unavailable for lsp diagnostics with unsupported language', async () => {
    const result = await executeCommandDetailed({
      type: 'lsp',
      action: 'diagnostics',
      language: 'python',
      filePath: '/tmp/demo.py',
      content: 'import os',
      rootDir: process.cwd(),
    });

    expect(result.type).toBe('lsp');
    if (result.type === 'lsp') {
      expect(result.available).toBe(false);
    }
  });

  it('returns unavailable for lsp references with unsupported language', async () => {
    const result = await executeCommandDetailed({
      type: 'lsp',
      action: 'references',
      language: 'python',
      filePath: '/tmp/demo.py',
      line: 1,
      character: 1,
      rootDir: process.cwd(),
    });

    expect(result.type).toBe('lsp');
    if (result.type === 'lsp') {
      expect(result.available).toBe(false);
    }
  });

  it('returns unavailable for lsp rename-preview with unsupported language', async () => {
    const result = await executeCommandDetailed({
      type: 'lsp',
      action: 'rename-preview',
      language: 'python',
      filePath: '/tmp/demo.py',
      line: 1,
      character: 1,
      newName: 'renamed',
      rootDir: process.cwd(),
    });

    expect(result.type).toBe('lsp');
    if (result.type === 'lsp') {
      expect(result.available).toBe(false);
    }
  });

  it('handles context init with --force to overwrite existing file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-context-force-'));
    const targetPath = path.join(root, '.xifan', 'XIFAN.md');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, 'old content', 'utf8');

    const result = await executeCommandDetailed({
      type: 'context',
      action: 'init',
      cwd: root,
      force: true,
    });

    expect(result.type).toBe('context');
    if (result.type === 'context') {
      expect(result.overwritten).toBe(true);
    }
  });

  it('detects package.json missing gracefully for context init', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-context-nopkg-'));

    const result = await executeCommandDetailed({
      type: 'context',
      action: 'init',
      cwd: root,
      force: false,
    });

    expect(result.type).toBe('context');
    if (result.type === 'context') {
      expect(result.created).toBe(true);
    }
  });

  it('handles package.json parse error in detectPackageScript', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-context-badpkg-'));
    fs.writeFileSync(path.join(root, 'package.json'), '{invalid json', 'utf8');

    const result = await executeCommandDetailed({
      type: 'context',
      action: 'init',
      cwd: root,
      force: false,
    });

    expect(result.type).toBe('context');
    if (result.type === 'context') {
      expect(result.created).toBe(true);
    }
  });

  it('handles resolve-llm-driver with confirm=no', async () => {
    const result = await executeCommandDetailed(
      {
        type: 'resolve-llm-driver',
        mode: 'auto',
        headless: false,
        litellmBaseUrl: 'http://localhost:4000',
        confirm: 'no',
      },
      {
        resolveDriverMode: async (input) => {
          const accepted = input.confirmUseLiteLLM ? await input.confirmUseLiteLLM() : false;
          return {
            selectedDriver: accepted ? 'litellm' : 'builtin',
            reason: accepted ? 'auto_user_accepted' : 'auto_user_declined',
            litellmDetected: true,
            litellmBaseUrl: 'http://localhost:4000',
          };
        },
      },
    );

    expect(result.type).toBe('resolve-llm-driver');
    if (result.type === 'resolve-llm-driver') {
      expect(result.selectedDriver).toBe('builtin');
      expect(result.reason).toBe('auto_user_declined');
    }
  });

  it('handles resolve-llm-driver with tty prompt', async () => {
    const result = await executeCommandDetailed(
      {
        type: 'resolve-llm-driver',
        mode: 'auto',
        headless: false,
        litellmBaseUrl: 'http://localhost:4000',
        confirm: undefined,
      },
      {
        stdinIsTTY: true,
        promptYesNo: async () => true,
        resolveDriverMode: async (input) => {
          const accepted = input.confirmUseLiteLLM ? await input.confirmUseLiteLLM() : false;
          return {
            selectedDriver: accepted ? 'litellm' : 'builtin',
            reason: accepted ? 'auto_user_accepted' : 'auto_user_declined',
            litellmDetected: true,
            litellmBaseUrl: 'http://localhost:4000',
          };
        },
      },
    );

    expect(result.type).toBe('resolve-llm-driver');
    if (result.type === 'resolve-llm-driver') {
      expect(result.selectedDriver).toBe('litellm');
    }
  });

  it('cleans up memory server when mcp start fails', async () => {
    let memoryStopped = false;

    await expect(
      executeCommandDetailed(
        {
          type: 'mcp',
          action: 'serve',
          host: '127.0.0.1',
          port: 7890,
          path: '/mcp',
          token: 'secret',
          tokenFilePath: undefined,
          maxConnections: 10,
          requireTls: false,
          autoStartMemory: true,
          memoryDbPath: '/tmp/xifan-memory.db',
        },
        {
          createMemoryMcpServer: () => ({
            start: async () => ({
              started: true,
              transport: 'stdio',
              toolCount: 4,
            }),
            stop: async () => {
              memoryStopped = true;
            },
          }),
          createMcpServer: () => ({
            start: async () => {
              throw new Error('bind failed');
            },
            stop: async () => undefined,
          }),
        },
      ),
    ).rejects.toThrow('bind failed');

    expect(memoryStopped).toBe(true);
  });
});

describe('executeCommand - resolve-llm-driver coverage', () => {
  it('sets confirmUseLiteLLM to undefined when not tty and confirm is unset', async () => {
    const result = await executeCommandDetailed(
      {
        type: 'resolve-llm-driver',
        mode: 'auto',
        headless: false,
        litellmBaseUrl: 'http://localhost:4000',
        confirm: undefined,
      },
      {
        stdinIsTTY: false,
        resolveDriverMode: async (input) => {
          return {
            selectedDriver: input.confirmUseLiteLLM ? 'litellm' : 'builtin',
            reason: input.confirmUseLiteLLM ? 'had_confirm' : 'no_confirm',
            litellmDetected: true,
            litellmBaseUrl: 'http://localhost:4000',
          };
        },
      },
    );

    expect(result.type).toBe('resolve-llm-driver');
    if (result.type === 'resolve-llm-driver') {
      expect(result.selectedDriver).toBe('builtin');
      expect(result.reason).toBe('no_confirm');
    }
  });
});

describe('executeCommand - additional coverage', () => {
  it('handles plugin-exec with L2 permission level plugin', async () => {
    const out = await executeCommand(
      {
        type: 'plugin-exec',
        pluginName: 'shell',
        toolName: 'shell_run',
        args: { cmd: 'ls' },
        confirm: 'yes',
        mode: 'build',
        headless: false,
        allowWrite: true,
        allowShell: true,
        allowDangerous: false,
        policyMode: 'compat',
        dangerouslySkipPermissions: false,
        allowedTools: [],
        deniedTools: [],
        globalPluginsDir: '/tmp/global',
        projectPluginsDir: '/tmp/project',
        nodeModulesDir: '/tmp/node_modules',
        explicitConfig: '/tmp/plugins.json',
        enabledL3Plugins: [],
      },
      {
        stdinIsTTY: false,
        discoverPlugins: async () => [
          {
            name: 'shell',
            version: '1.0.0',
            description: '',
            type: 'node',
            module: '@xifan-coder/plugin-shell',
            enabled: true,
            requireConfirmation: false,
            permissionLevel: 2,
            source: 'explicit',
          },
        ],
        executePluginTool: async () => ({
          result: { content: { output: 'file.txt' } },
          pluginEntry: {
            manifest: {
              name: 'shell',
              version: '1.0.0',
              description: '',
              type: 'node',
              module: '@xifan-coder/plugin-shell',
              enabled: true,
              requireConfirmation: false,
              permissionLevel: 2,
              source: 'explicit',
            },
            status: 'ready',
          },
        }),
      },
    );

    expect(out).toContain('plugin=shell');
    expect(out).toContain('executed=true');
  });

  it('handles plugin-exec with L3 permission level plugin', async () => {
    const out = await executeCommand(
      {
        type: 'plugin-exec',
        pluginName: 'danger',
        toolName: 'danger_run',
        args: {},
        confirm: 'yes',
        mode: 'build',
        headless: false,
        allowWrite: true,
        allowShell: true,
        allowDangerous: true,
        policyMode: 'compat',
        dangerouslySkipPermissions: false,
        allowedTools: [],
        deniedTools: [],
        globalPluginsDir: '/tmp/global',
        projectPluginsDir: '/tmp/project',
        nodeModulesDir: '/tmp/node_modules',
        explicitConfig: '/tmp/plugins.json',
        enabledL3Plugins: ['danger'],
      },
      {
        stdinIsTTY: false,
        discoverPlugins: async () => [
          {
            name: 'danger',
            version: '1.0.0',
            description: '',
            type: 'node',
            module: '@xifan-coder/plugin-danger',
            enabled: true,
            requireConfirmation: true,
            permissionLevel: 3,
            source: 'explicit',
          },
        ],
        executePluginTool: async () => ({
          result: { content: { done: true } },
          pluginEntry: {
            manifest: {
              name: 'danger',
              version: '1.0.0',
              description: '',
              type: 'node',
              module: '@xifan-coder/plugin-danger',
              enabled: true,
              requireConfirmation: true,
              permissionLevel: 3,
              source: 'explicit',
            },
            status: 'ready',
          },
        }),
      },
    );

    expect(out).toContain('plugin=danger');
    expect(out).toContain('executed=true');
  });
});

describe('helpText', () => {
  it('returns help text with explicit version', () => {
    const text = helpText('9.9.9');
    expect(text).toContain('XiFanCoder CLI v9.9.9');
  });
});

describe('formatCommandResultText', () => {
  it('formats daemon ping connected result', () => {
    const result: CommandResult = {
      type: 'daemon',
      action: 'ping',
      connected: true,
      status: 'ok',
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=ping');
    expect(text).toContain('connected=true');
    expect(text).toContain('status=ok');
  });

  it('formats session list with empty sessions', () => {
    const result: CommandResult = {
      type: 'session',
      action: 'list',
      dbPath: '/tmp/s.db',
      sessions: [],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('sessions=0');
  });

  it('formats session resume not found', () => {
    const result: CommandResult = {
      type: 'session',
      action: 'resume',
      dbPath: '/tmp/s.db',
      found: false,
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('found=false');
  });

  it('formats empty skill-list', () => {
    const result: CommandResult = {
      type: 'skill-list',
      skills: [],
    };
    const text = formatCommandResultText(result);
    expect(text).toBe('skills=0');
  });

  it('formats empty todo tasks', () => {
    const result: CommandResult = {
      type: 'todo',
      action: 'list',
      tasks: [],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=list');
    expect(text).toContain('tasks=0');
  });

  it('formats empty plugin-discover', () => {
    const result: CommandResult = {
      type: 'plugin-discover',
      manifests: [],
    };
    const text = formatCommandResultText(result);
    expect(text).toBe('plugins=0');
  });

  it('formats empty plugin-bootstrap', () => {
    const result: CommandResult = {
      type: 'plugin-bootstrap',
      entries: [],
    };
    const text = formatCommandResultText(result);
    expect(text).toBe('plugins=0');
  });

  it('formats setup success/failure', () => {
    const success: CommandResult = {
      type: 'setup',
      success: true,
    };
    expect(formatCommandResultText(success)).toBe('Client setup completed.');

    const failure: CommandResult = {
      type: 'setup',
      success: false,
    };
    expect(formatCommandResultText(failure)).toBe('Client setup failed.');
  });

  it('formats provider-update result', () => {
    const result: CommandResult = {
      type: 'provider-update',
      version: '1.0.0',
      source: 'embedded',
      checksum: 'abc123',
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('provider catalog updated');
    expect(text).toContain('version=1.0.0');
  });

  it('formats lsp unavailable result', () => {
    const result: CommandResult = {
      type: 'lsp',
      action: 'diagnostics',
      language: 'python',
      available: false,
      reason: 'no provider',
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('available=false');
    expect(text).toContain('reason=no provider');
  });

  it('formats daemon serve connected result', () => {
    const result: CommandResult = {
      type: 'daemon',
      action: 'serve',
      connected: true,
      host: '127.0.0.1',
      port: 9321,
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=serve');
    expect(text).toContain('connected=true');
  });

  it('formats daemon append connected result', () => {
    const result: CommandResult = {
      type: 'daemon',
      action: 'append',
      connected: true,
      sessionId: 's1',
      event: { id: 'evt-1' },
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=append');
    expect(text).toContain('session=s1');
  });

  it('formats daemon get connected result', () => {
    const result: CommandResult = {
      type: 'daemon',
      action: 'get',
      connected: true,
      sessionId: 's1',
      events: [],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=get');
    expect(text).toContain('count=0');
  });

  it('formats daemon not-connected result', () => {
    const result: CommandResult = {
      type: 'daemon',
      action: 'ping',
      connected: false,
      reason: 'connection refused',
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('connected=false');
    expect(text).toContain('reason=connection refused');
  });

  it('formats mcp serve result', () => {
    const result: CommandResult = {
      type: 'mcp',
      action: 'serve',
      started: true,
      host: '127.0.0.1',
      port: 7890,
      path: '/mcp',
      tokenFilePath: '/tmp/token',
      tlsEnabled: true,
      tlsCertPath: '/tmp/cert.pem',
      connectedClients: 0,
      ideConnected: false,
      memoryStarted: true,
      memoryToolCount: 4,
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('started=true');
    expect(text).toContain('memoryStarted=true');
  });

  it('formats memory search result', () => {
    const result: CommandResult = {
      type: 'memory',
      action: 'search',
      query: 'auth',
      project: '/repo',
      results: [],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=search');
    expect(text).toContain('count=0');
  });

  it('formats memory open result', () => {
    const result: CommandResult = {
      type: 'memory',
      action: 'open',
      started: true,
      host: '127.0.0.1',
      port: 37777,
      url: 'http://127.0.0.1:37777',
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=open');
    expect(text).toContain('started=true');
  });

  it('formats memory serve result', () => {
    const result: CommandResult = {
      type: 'memory',
      action: 'serve',
      started: true,
      transport: 'stdio',
      toolCount: 4,
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('started=true');
    expect(text).toContain('tools=4');
  });

  it('formats context show result', () => {
    const result: CommandResult = {
      type: 'context',
      action: 'show',
      cwd: '/repo',
      sourcePaths: ['/repo/XIFAN.md'],
      content: 'rules',
      secretLeakCount: 0,
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=show');
    expect(text).toContain('sources=1');
  });

  it('formats context init result', () => {
    const result: CommandResult = {
      type: 'context',
      action: 'init',
      cwd: '/repo',
      filePath: '/repo/.xifan/XIFAN.md',
      created: true,
      overwritten: false,
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=init');
    expect(text).toContain('created=true');
  });

  it('formats config init result', () => {
    const result: CommandResult = {
      type: 'config',
      action: 'init',
      targetPath: '/tmp/config.yaml',
      created: true,
      overwritten: false,
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=init');
    expect(text).toContain('created=true');
  });

  it('formats session create result', () => {
    const result: CommandResult = {
      type: 'session',
      action: 'create',
      dbPath: '/tmp/s.db',
      session: {
        id: 's1',
        projectPath: '/repo',
        model: 'gpt-4o',
        provider: 'openai',
      },
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=create');
    expect(text).toContain('session=s1');
  });

  it('formats session resume found result', () => {
    const result: CommandResult = {
      type: 'session',
      action: 'resume',
      dbPath: '/tmp/s.db',
      found: true,
      session: { id: 's1' },
      messages: [{ id: 'm1', content: 'hello' }],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('found=true');
    expect(text).toContain('messages=1');
  });

  it('formats cost result', () => {
    const result: CommandResult = {
      type: 'cost',
      scope: 'session',
      dbPath: '/tmp/s.db',
      sessionId: 's1',
      aggregate: {
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.03,
        toolCallCount: 2,
      },
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('scope=session');
    expect(text).toContain('totalTokens=300');
  });

  it('formats tools result', () => {
    const result: CommandResult = {
      type: 'tools',
      crushAvailable: false,
      crushCommand: 'crush',
      crushReason: 'not_found',
      tools: [
        {
          name: 'read_file',
          source: 'builtin',
          permissionLevel: 'L0',
          description: 'Read file',
        },
      ],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('tools=1');
    expect(text).toContain('crushAvailable=false');
  });

  it('formats skill-list result with entries', () => {
    const result: CommandResult = {
      type: 'skill-list',
      skills: [
        {
          name: 'alpha',
          title: 'Alpha Skill',
          rootPath: '/tmp/skills/alpha',
          skillFilePath: '/tmp/skills/alpha/SKILL.md',
        },
      ],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('skills=1');
    expect(text).toContain('alpha');
  });

  it('formats skill-use applied result', () => {
    const result: CommandResult = {
      type: 'skill-use',
      skillName: 'alpha',
      applied: true,
      title: 'Alpha',
      skillFilePath: '/tmp/skills/alpha/SKILL.md',
      appliedAt: '2026-01-01T00:00:00Z',
      content: 'skill content',
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('applied=true');
    expect(text).toContain('skill=alpha');
  });

  it('formats skill-use not applied result', () => {
    const result: CommandResult = {
      type: 'skill-use',
      skillName: 'alpha',
      applied: false,
      reason: 'denied_by_allowlist',
      policySource: 'runtime',
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('applied=false');
    expect(text).toContain('reason=denied_by_allowlist');
  });

  it('formats todo guard result', () => {
    const result: CommandResult = {
      type: 'todo',
      action: 'guard',
      tasks: [],
      shouldContinue: false,
      guardReason: 'all_done',
      unfinishedTaskIds: [],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=guard');
    expect(text).toContain('shouldContinue=false');
  });

  it('formats todo list with tasks', () => {
    const result: CommandResult = {
      type: 'todo',
      action: 'list',
      tasks: [
        {
          id: 't1',
          title: 'task 1',
          status: 'pending',
          updatedAt: new Date(),
        },
      ],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=list');
    expect(text).toContain('t1 status=pending');
  });

  it('formats plugin-discover with entries', () => {
    const result: CommandResult = {
      type: 'plugin-discover',
      manifests: [
        {
          name: 'alpha',
          version: '1.0.0',
          description: '',
          type: 'node',
          module: '@xifan-coder/plugin-alpha',
          enabled: true,
          requireConfirmation: false,
          permissionLevel: 0,
          source: 'explicit',
        },
      ],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('plugins=1');
    expect(text).toContain('alpha@1.0.0');
  });

  it('formats plugin-bootstrap with entries', () => {
    const result: CommandResult = {
      type: 'plugin-bootstrap',
      entries: [
        {
          manifest: {
            name: 'alpha',
            version: '1.0.0',
            description: '',
            type: 'node',
            module: '@xifan-coder/plugin-alpha',
            enabled: true,
            requireConfirmation: false,
            permissionLevel: 0,
            source: 'explicit',
          },
          status: 'ready',
        },
      ],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('plugins=1');
    expect(text).toContain('alpha status=ready');
  });

  it('formats plugin-exec not executed result', () => {
    const result: CommandResult = {
      type: 'plugin-exec',
      pluginName: 'safe',
      toolName: 'safe_echo',
      executed: false,
      reason: 'approval_required',
      policySource: 'runtime',
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('executed=false');
    expect(text).toContain('reason=approval_required');
  });

  it('formats plugin-exec executed result', () => {
    const result: CommandResult = {
      type: 'plugin-exec',
      pluginName: 'safe',
      toolName: 'safe_echo',
      executed: true,
      status: 'ready',
      result: { content: 'ok' },
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('executed=true');
    expect(text).toContain('status=ready');
  });

  it('formats check-tool result', () => {
    const result: CommandResult = {
      type: 'check-tool',
      toolName: 'write_file',
      level: 'L1',
      mode: 'plan',
      allowed: false,
      requiresApproval: false,
      reason: 'denied_by_mode',
      policySource: 'runtime',
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('tool=write_file');
    expect(text).toContain('allowed=false');
  });

  it('formats resolve-llm-driver result', () => {
    const result: CommandResult = {
      type: 'resolve-llm-driver',
      selectedDriver: 'builtin',
      reason: 'manual',
      detected: false,
      baseUrl: undefined,
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('selected=builtin');
  });

  it('formats mode result', () => {
    const result: CommandResult = {
      type: 'mode',
      action: 'get',
      mode: 'build',
      storePath: '/tmp/store.json',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('mode=build');
  });

  it('formats lsp diagnostics available', () => {
    const result: CommandResult = {
      type: 'lsp',
      action: 'diagnostics',
      language: 'typescript',
      available: true,
      diagnostics: [],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=diagnostics');
    expect(text).toContain('available=true');
    expect(text).toContain('count=0');
  });

  it('formats lsp workspace-symbols available', () => {
    const result: CommandResult = {
      type: 'lsp',
      action: 'workspace-symbols',
      language: 'typescript',
      available: true,
      symbols: [],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=workspace-symbols');
    expect(text).toContain('count=0');
  });

  it('formats lsp references available', () => {
    const result: CommandResult = {
      type: 'lsp',
      action: 'references',
      language: 'typescript',
      available: true,
      references: [],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=references');
    expect(text).toContain('count=0');
  });

  it('formats lsp rename-preview available', () => {
    const result: CommandResult = {
      type: 'lsp',
      action: 'rename-preview',
      language: 'typescript',
      available: true,
      renameEdits: [],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('action=rename-preview');
    expect(text).toContain('count=0');
  });

  it('formats session list with sessions', () => {
    const result: CommandResult = {
      type: 'session',
      action: 'list',
      dbPath: '/tmp/s.db',
      sessions: [
        {
          id: 's1',
          model: 'gpt-4o',
          provider: 'openai',
          messageCount: 3,
          updatedAt: '2026-01-01',
        },
      ],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('sessions=1');
    expect(text).toContain('s1 model=gpt-4o');
  });

  it('formats todo list with task that has a reason', () => {
    const result: CommandResult = {
      type: 'todo',
      action: 'list',
      tasks: [
        {
          id: 't1',
          title: 'blocked',
          status: 'blocked',
          updatedAt: new Date(),
          lastReason: 'waiting',
        },
      ],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('reason="waiting"');
  });

  it('formats plugin-bootstrap with error entry', () => {
    const result: CommandResult = {
      type: 'plugin-bootstrap',
      entries: [
        {
          manifest: {
            name: 'broken',
            version: '1.0.0',
            description: '',
            type: 'node',
            module: '@xifan-coder/plugin-broken',
            enabled: true,
            requireConfirmation: false,
            permissionLevel: 0,
            source: 'explicit',
          },
          status: 'error',
          error: 'load failed',
        },
      ],
    };
    const text = formatCommandResultText(result);
    expect(text).toContain('error=load failed');
  });
});
