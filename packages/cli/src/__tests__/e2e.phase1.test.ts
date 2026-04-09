import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  AgentLoop,
  loadXifanContext,
  registerBuiltinTools,
  SessionRuntime,
  ToolDispatcher,
  type ILLMDriver,
  type LLMRequest,
  type LLMResponse,
} from '@xifan-coder/core';

import { runCli } from '../cli.js';
import { createDefaultSlashRouter, createInitialReplState, updateUsageSummary } from '../slash-router.js';

function createResponse(input: {
  message: LLMResponse['message'];
  finishReason?: LLMResponse['finishReason'];
}): LLMResponse {
  return {
    message: input.message,
    finishReason: input.finishReason ?? 'stop',
    usage: {
      promptTokens: 10,
      completionTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    latencyMs: 1,
  };
}

function createScriptedDriver(
  responses: readonly LLMResponse[],
  options: {
    captureRequests?: LLMRequest[];
  } = {},
): Pick<ILLMDriver, 'chat'> {
  let index = 0;
  return {
    chat: async (request): Promise<LLMResponse> => {
      options.captureRequests?.push(request);
      const response = responses[index];
      index += 1;
      if (!response) {
        throw new Error('no scripted response for mock llm');
      }
      return response;
    },
  };
}

function createDispatcher(root: string, options: {
  allowWrite: boolean;
  allowShell: boolean;
}): ToolDispatcher {
  const runtime = new SessionRuntime({
    mode: 'build',
    headless: true,
    allowWrite: options.allowWrite,
    allowShell: options.allowShell,
    allowDangerous: false,
    allowedTools: [],
    deniedTools: [],
    policyMode: 'compat',
    dangerouslySkipPermissions: false,
    permissionLogPath: path.join(root, '.xifan', 'coder', 'permission.ndjson'),
  });
  const dispatcher = new ToolDispatcher(runtime, {
    approvalHandler: async () => true,
  });
  registerBuiltinTools(dispatcher);
  return dispatcher;
}

describe('phase1 e2e', () => {
  it('scenario1: headless flow start -> read_file -> write_file -> confirm', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-e2e-s1-'));
    const sourcePath = path.join(root, 'source.txt');
    const targetPath = path.join(root, 'hello.ts');
    fs.writeFileSync(sourcePath, 'seed-input', 'utf8');
    const dispatcher = createDispatcher(root, {
      allowWrite: true,
      allowShell: false,
    });

    const loop = new AgentLoop({
      llmDriver: createScriptedDriver([
        createResponse({
          finishReason: 'tool_use',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'read-1',
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: JSON.stringify({ path: sourcePath }),
                },
              },
            ],
          },
        }),
        createResponse({
          finishReason: 'tool_use',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'write-1',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({
                    path: targetPath,
                    mode: 'create',
                    content: 'export const hello = "world";\n',
                  }),
                },
              },
            ],
          },
        }),
        createResponse({
          finishReason: 'stop',
          message: {
            role: 'assistant',
            content: 'done',
          },
        }),
      ]),
      executeTool: async (toolName, args) => await dispatcher.executeTool(toolName, args),
    });

    const result = await loop.run({
      model: 'mock-model',
      userInput: '创建 hello.ts',
      maxRounds: 6,
    });

    expect(result.status).toBe('completed');
    expect(result.assistantText).toBe('done');
    expect(result.toolCalls.map((item) => item.toolName)).toEqual(['read_file', 'write_file']);
    expect(fs.existsSync(targetPath)).toBe(true);
    expect(fs.readFileSync(targetPath, 'utf8')).toContain('export const hello = "world";');
  });

  it('scenario2: one-shot task mode without TUI', async () => {
    const stdout: string[] = [];
    const code = await runCli(['创建一个 hello.ts 文件'], {
      runSingleTaskFn: async ({ message }) => ({
        assistantText: `single:${message}`,
        state: createInitialReplState(),
      }),
      printStdout: (line) => {
        stdout.push(line);
      },
      printStderr: () => undefined,
    });

    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('single:创建一个 hello.ts 文件');
  });

  it('scenario3: session create -> list -> resume flow', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-e2e-s3-'));
    const dbPath = path.join(root, 'sessions.db');
    const sessions: Array<{
      id: string;
      projectPath: string;
      model: string;
      provider: string;
      agentMode: 'build' | 'plan';
      contextSnapshot?: string;
      totalTokens: number;
      totalCostUsd: number;
      messageCount: number;
      memSessionId?: string;
      createdAt: string;
      updatedAt: string;
    }> = [];

    const executeStructuredCommand = async (command: unknown): Promise<unknown> => {
      if (
        typeof command !== 'object' ||
        command === null ||
        !('type' in command) ||
        !('action' in command) ||
        (command as { type?: string }).type !== 'session'
      ) {
        throw new Error('scenario3 only supports session commands');
      }

      const action = (command as { action: 'create' | 'list' | 'resume' }).action;
      if (action === 'create') {
        const nextId = `s${sessions.length + 1}`;
        const now = new Date().toISOString();
        const session = {
          id: nextId,
          projectPath: (command as { projectPath?: string }).projectPath ?? root,
          model: (command as { model?: string }).model ?? 'mock-model',
          provider: (command as { provider?: string }).provider ?? 'mock-provider',
          agentMode: 'build' as const,
          contextSnapshot: undefined,
          totalTokens: 0,
          totalCostUsd: 0,
          messageCount: 0,
          memSessionId: undefined,
          createdAt: now,
          updatedAt: now,
        };
        sessions.push(session);
        return {
          type: 'session',
          action: 'create',
          dbPath: (command as { dbPath?: string }).dbPath,
          session,
        };
      }

      if (action === 'list') {
        return {
          type: 'session',
          action: 'list',
          dbPath: (command as { dbPath?: string }).dbPath,
          sessions,
        };
      }

      const id = (command as { id?: string }).id;
      const target = id ? sessions.find((item) => item.id === id) : sessions.at(-1);
      return {
        type: 'session',
        action: 'resume',
        dbPath: (command as { dbPath?: string }).dbPath,
        found: Boolean(target),
        session: target,
        messages: [],
      };
    };

    async function runJson(argv: readonly string[]): Promise<unknown> {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const code = await runCli([...argv, '--output', 'json'], {
        executeStructuredCommand,
        printStdout: (line) => {
          stdout.push(line);
        },
        printStderr: (line) => {
          stderr.push(line);
        },
      });
      expect(code).toBe(0);
      expect(stderr).toHaveLength(0);
      return JSON.parse(stdout.join('\n'));
    }

    const created = (await runJson([
      'session',
      'create',
      '--model',
      'mock-model',
      '--provider',
      'mock-provider',
      '--project',
      root,
      '--db',
      dbPath,
    ])) as {
      type: string;
      action: string;
      session?: { id: string };
    };
    expect(created.type).toBe('session');
    expect(created.action).toBe('create');
    expect(created.session?.id).toBeDefined();

    const listed = (await runJson([
      'session',
      'list',
      '--project',
      root,
      '--db',
      dbPath,
    ])) as {
      type: string;
      action: string;
      sessions?: Array<{ id: string }>;
    };
    expect(listed.type).toBe('session');
    expect(listed.action).toBe('list');
    expect((listed.sessions ?? []).length).toBeGreaterThanOrEqual(1);

    const resumed = (await runJson([
      'session',
      'resume',
      '--id',
      created.session?.id ?? '',
      '--db',
      dbPath,
    ])) as {
      type: string;
      action: string;
      found?: boolean;
      session?: { id: string };
    };
    expect(resumed.type).toBe('session');
    expect(resumed.action).toBe('resume');
    expect(resumed.found).toBe(true);
    expect(resumed.session?.id).toBe(created.session?.id);
  });

  it('scenario4: /cost output includes token and usd fields', async () => {
    const router = createDefaultSlashRouter();
    const state = createInitialReplState();
    const prints: string[] = [];

    updateUsageSummary(state, {
      userText: 'hello',
      assistantText: 'world',
    });

    const result = await router.dispatch('/cost', {
      state,
      cwd: process.cwd(),
      print: (line) => {
        prints.push(line);
      },
    });

    expect(result.type).toBe('success');
    const text = prints.join('\n');
    expect(text).toContain('prompt_tokens=');
    expect(text).toContain('completion_tokens=');
    expect(text).toContain('cost_usd=$');
  });

  it.skipIf(process.platform === 'win32')('scenario5: bash_execute captures stdout/stderr and timeout state', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-e2e-s5-'));
    const dispatcher = createDispatcher(root, {
      allowWrite: false,
      allowShell: true,
    });

    const firstLoop = new AgentLoop({
      llmDriver: createScriptedDriver([
        createResponse({
          finishReason: 'tool_use',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'bash-1',
                type: 'function',
                function: {
                  name: 'bash_execute',
                  arguments: JSON.stringify({
                    command: "/bin/sh -lc 'echo out; echo err 1>&2'",
                    timeoutMs: 1_000,
                  }),
                },
              },
            ],
          },
        }),
        createResponse({
          finishReason: 'stop',
          message: {
            role: 'assistant',
            content: 'ok',
          },
        }),
      ]),
      executeTool: async (toolName, args) => await dispatcher.executeTool(toolName, args),
    });

    const first = await firstLoop.run({
      model: 'mock-model',
      userInput: 'run bash',
      maxRounds: 4,
    });
    const firstOutput = first.toolCalls[0]?.output as {
      stdout?: string;
      stderr?: string;
      timedOut?: boolean;
    };
    expect(firstOutput.stdout ?? '').toContain('out');
    expect(firstOutput.stderr ?? '').toContain('err');
    expect(firstOutput.timedOut).toBe(false);

    const secondLoop = new AgentLoop({
      llmDriver: createScriptedDriver([
        createResponse({
          finishReason: 'tool_use',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'bash-timeout',
                type: 'function',
                function: {
                  name: 'bash_execute',
                  arguments: JSON.stringify({
                    command: 'sleep 1',
                    timeoutMs: 20,
                  }),
                },
              },
            ],
          },
        }),
        createResponse({
          finishReason: 'stop',
          message: {
            role: 'assistant',
            content: 'timeout-ok',
          },
        }),
      ]),
      executeTool: async (toolName, args) => await dispatcher.executeTool(toolName, args),
    });

    const second = await secondLoop.run({
      model: 'mock-model',
      userInput: 'run timeout bash',
      maxRounds: 4,
    });
    const secondOutput = second.toolCalls[0]?.output as {
      timedOut?: boolean;
    };
    expect(secondOutput.timedOut).toBe(true);
  });

  it('scenario6: xifan context is injected into LLM user message', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-e2e-s6-'));
    const home = path.join(root, 'home');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(root, 'XIFAN.md'), '## Rules\nAlways add tests first.', 'utf8');
    const loaded = loadXifanContext({
      cwd: root,
      homeDir: home,
    });
    expect(loaded.content).toContain('Always add tests first.');

    const capturedRequests: LLMRequest[] = [];
    const loop = new AgentLoop({
      llmDriver: createScriptedDriver(
        [
          createResponse({
            finishReason: 'stop',
            message: {
              role: 'assistant',
              content: 'done',
            },
          }),
        ],
        { captureRequests: capturedRequests },
      ),
      executeTool: async () => ({
        toolName: 'noop',
        source: 'builtin',
        permission: {
          allowed: true,
          requiresApproval: false,
          reason: 'allowed',
          policySource: 'default',
        },
        durationMs: 1,
        output: {},
      }),
    });

    await loop.run({
      model: 'mock-model',
      userInput: 'hello',
      xifanContext: loaded.content,
    });

    const firstRequest = capturedRequests[0];
    const userMessage = firstRequest?.messages.find((message) => message.role === 'user');
    const userContent = String(userMessage?.content ?? '');
    expect(userContent).toContain('<xifan-context>');
    expect(userContent).toContain('Always add tests first.');
    expect(userContent).toContain('hello');
  });
});
