import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { ToolDefinition } from '../tools/dispatcher.js';

import type { AgentLoop, AgentLoopRunInput, AgentLoopRunResult } from './loop.js';

export interface SubAgentTaskInput {
  readonly taskId?: string;
  readonly parentSessionId?: string;
  readonly prompt: string;
  readonly model: string;
  readonly outputStyle?: string;
  readonly systemPrompt?: string;
  readonly contextFiles?: readonly string[];
  readonly maxRounds?: number;
  readonly timeoutMs?: number;
}

export interface SubAgentTaskResult {
  readonly taskId: string;
  readonly parentSessionId?: string;
  readonly status: 'completed' | 'failed' | 'cancelled' | 'timeout';
  readonly output: string;
  readonly rounds: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly error?: string;
}

export interface SubAgentActiveTask {
  readonly taskId: string;
  readonly parentSessionId?: string;
  readonly startedAt: string;
}

export interface SubAgentManagerDeps {
  readonly createLoop: (options: { maxRounds: number }) => Pick<AgentLoop, 'run'>;
  readonly readFile?: (filePath: string) => Promise<string>;
  readonly now?: () => Date;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('sub_agent_timeout'));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function defaultReadFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf8');
}

function buildPromptWithContext(
  prompt: string,
  contextBlocks: readonly { filePath: string; content: string }[],
): string {
  if (contextBlocks.length === 0) {
    return prompt;
  }
  const sections = contextBlocks.map(
    (item) => `<sub-agent-context file="${item.filePath}">\n${item.content}\n</sub-agent-context>`,
  );
  return `${sections.join('\n\n')}\n\n${prompt}`;
}

export class SubAgentManager {
  private readonly deps: SubAgentManagerDeps;
  private readonly maxConcurrent: number;
  private readonly active = new Map<string, SubAgentActiveTask>();
  private runningCount = 0;
  private readonly queue: Array<() => void> = [];
  private readonly cancelledTasks = new Set<string>();

  constructor(
    deps: SubAgentManagerDeps,
    options: { maxConcurrent?: number } = {},
  ) {
    this.deps = deps;
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 3);
  }

  listActive(): readonly SubAgentActiveTask[] {
    return [...this.active.values()];
  }

  cancel(taskId: string): boolean {
    this.cancelledTasks.add(taskId);
    return this.active.has(taskId);
  }

  async run(task: SubAgentTaskInput): Promise<SubAgentTaskResult> {
    const release = await this.acquire();
    const now = this.deps.now ?? (() => new Date());
    const readFile = this.deps.readFile ?? defaultReadFile;
    const taskId = task.taskId ?? randomUUID();
    const startedAt = now().toISOString();
    this.active.set(taskId, {
      taskId,
      parentSessionId: task.parentSessionId,
      startedAt,
    });

    try {
      if (this.cancelledTasks.has(taskId)) {
        return {
          taskId,
          parentSessionId: task.parentSessionId,
          status: 'cancelled',
          output: '',
          rounds: 0,
          startedAt,
          endedAt: now().toISOString(),
          error: 'task_cancelled',
        };
      }

      const contextBlocks: Array<{ filePath: string; content: string }> = [];
      for (const filePath of task.contextFiles ?? []) {
        const absolutePath = path.resolve(filePath);
        contextBlocks.push({
          filePath: absolutePath,
          content: await readFile(absolutePath),
        });
      }

      const loopInput: AgentLoopRunInput = {
        model: task.model,
        userInput: buildPromptWithContext(task.prompt, contextBlocks),
        outputStyle: task.outputStyle,
        systemPrompt: task.systemPrompt,
        maxRounds: task.maxRounds ?? 10,
        history: [],
      };
      const loop = this.deps.createLoop({ maxRounds: loopInput.maxRounds ?? 10 });

      let loopResult: AgentLoopRunResult;
      try {
        const loopPromise = loop.run(loopInput);
        loopResult = task.timeoutMs
          ? await withTimeout(loopPromise, task.timeoutMs)
          : await loopPromise;
      } catch (error) {
        const timedOut = error instanceof Error && error.message === 'sub_agent_timeout';
        return {
          taskId,
          parentSessionId: task.parentSessionId,
          status: timedOut ? 'timeout' : 'failed',
          output: '',
          rounds: 0,
          startedAt,
          endedAt: now().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        };
      }

      if (this.cancelledTasks.has(taskId)) {
        return {
          taskId,
          parentSessionId: task.parentSessionId,
          status: 'cancelled',
          output: '',
          rounds: loopResult.rounds,
          startedAt,
          endedAt: now().toISOString(),
          error: 'task_cancelled',
        };
      }

      return {
        taskId,
        parentSessionId: task.parentSessionId,
        status: loopResult.status === 'completed' ? 'completed' : 'failed',
        output: loopResult.assistantText,
        rounds: loopResult.rounds,
        startedAt,
        endedAt: now().toISOString(),
        error: loopResult.status === 'completed' ? undefined : 'max_rounds_reached',
      };
    } finally {
      this.active.delete(taskId);
      this.cancelledTasks.delete(taskId);
      release();
    }
  }

  private async acquire(): Promise<() => void> {
    if (this.runningCount < this.maxConcurrent) {
      this.runningCount += 1;
      return this.releaseFactory();
    }

    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
    this.runningCount += 1;
    return this.releaseFactory();
  }

  private releaseFactory(): () => void {
    return () => {
      this.runningCount -= 1;
      const next = this.queue.shift();
      next?.();
    };
  }
}

function normalizeSubAgentTaskArgs(args: unknown): SubAgentTaskInput {
  if (!args || typeof args !== 'object') {
    throw new Error('sub_agent args must be an object');
  }
  const obj = args as Record<string, unknown>;
  const prompt = obj.prompt;
  const model = obj.model;
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('sub_agent prompt is required');
  }
  if (typeof model !== 'string' || !model.trim()) {
    throw new Error('sub_agent model is required');
  }
  return {
    taskId: typeof obj.taskId === 'string' ? obj.taskId : undefined,
    parentSessionId: typeof obj.parentSessionId === 'string' ? obj.parentSessionId : undefined,
    prompt,
    model,
    outputStyle: typeof obj.outputStyle === 'string' ? obj.outputStyle : undefined,
    systemPrompt: typeof obj.systemPrompt === 'string' ? obj.systemPrompt : undefined,
    contextFiles: Array.isArray(obj.contextFiles)
      ? obj.contextFiles.filter((item): item is string => typeof item === 'string')
      : undefined,
    maxRounds: typeof obj.maxRounds === 'number' ? obj.maxRounds : undefined,
    timeoutMs: typeof obj.timeoutMs === 'number' ? obj.timeoutMs : undefined,
  };
}

export function createSubAgentToolDefinition(manager: SubAgentManager): ToolDefinition {
  return {
    name: 'sub_agent',
    description: 'Run a scoped sub-agent task with isolated context and return merged summary.',
    permissionLevel: 'L1',
    source: 'builtin',
    execute: async (args) => {
      const task = normalizeSubAgentTaskArgs(args);
      const result = await manager.run(task);
      return {
        taskId: result.taskId,
        status: result.status,
        output: result.output,
        rounds: result.rounds,
      };
    },
  };
}
