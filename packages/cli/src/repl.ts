import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import {
  createDefaultSlashRouter,
  createInitialReplState,
  type ReplState,
  type SlashCommandRouter,
  updateUsageSummary,
} from './slash-router.js';

export interface ReplIo {
  question(prompt: string): Promise<string>;
  print(line: string): void;
  write?(chunk: string): void;
  close(): void;
}

export interface AgentTurnResult {
  readonly text: string;
}

export interface ReplDeps {
  readonly createIO?: () => ReplIo;
  readonly createRouter?: () => SlashCommandRouter;
  readonly runAgentTurn?: (input: {
    readonly message: string;
    readonly state: ReplState;
  }) => Promise<AgentTurnResult>;
  readonly runAgentTurnStream?: (input: {
    readonly message: string;
    readonly state: ReplState;
  }) => AsyncIterable<string>;
  readonly now?: () => number;
  readonly progressIntervalMs?: number;
}

export interface ReplRunResult {
  readonly state: ReplState;
  readonly exitReason: 'user_exit' | 'eof';
}

export interface SingleTaskInput {
  readonly message: string;
  readonly state?: ReplState;
}

export interface SingleTaskResult {
  readonly state: ReplState;
  readonly assistantText: string;
}

function nowMs(): number {
  return Date.now();
}

/* v8 ignore start – process-level I/O binding; tested via DI in startRepl */
function defaultCreateIo(): ReplIo {
  const rl = createInterface({
    input,
    output,
  });
  return {
    question: async (prompt: string): Promise<string> => {
      return await rl.question(prompt);
    },
    print: (line: string): void => {
      output.write(`${line}\n`);
    },
    write: (chunk: string): void => {
      output.write(chunk);
    },
    close: (): void => {
      rl.close();
    },
  };
}
/* v8 ignore stop */

async function defaultRunAgentTurn(input: {
  readonly message: string;
  readonly state: ReplState;
}): Promise<AgentTurnResult> {
  void input.state;
  return {
    text: `已接收输入：${input.message}`,
  };
}

export async function runSingleTask(
  input: SingleTaskInput,
  deps: Pick<ReplDeps, 'runAgentTurn'> = {},
): Promise<SingleTaskResult> {
  const state = input.state ?? createInitialReplState();
  const runAgentTurn = deps.runAgentTurn ?? defaultRunAgentTurn;
  const message = input.message.trim();
  if (!message) {
    throw new Error('single task message cannot be empty');
  }

  state.turns.push({
    role: 'user',
    content: message,
  });
  const assistant = await runAgentTurn({
    message,
    state,
  });
  state.turns.push({
    role: 'assistant',
    content: assistant.text,
  });
  updateUsageSummary(state, {
    userText: message,
    assistantText: assistant.text,
  });

  return {
    state,
    assistantText: assistant.text,
  };
}

export async function startRepl(deps: ReplDeps = {}): Promise<ReplRunResult> {
  const createIO = deps.createIO ?? defaultCreateIo;
  const io = createIO();
  const createRouter = deps.createRouter ?? createDefaultSlashRouter;
  const runAgentTurn = deps.runAgentTurn ?? defaultRunAgentTurn;
  const runAgentTurnStream = deps.runAgentTurnStream;
  const now = deps.now ?? nowMs;
  const progressIntervalMs = Math.max(50, deps.progressIntervalMs ?? 1000);
  const router = createRouter();
  const state = createInitialReplState();

  io.print('XiFan REPL started. 输入 /help 查看命令，/exit 退出。');
  io.print(`model=${state.model} mode=${state.mode} style=${state.outputStyle}`);

  let exitReason: ReplRunResult['exitReason'] = 'eof';
  try {
    while (true) {
      const line = (await io.question('xifan-coder> ')).trim();
      if (!line) {
        continue;
      }
      if (line === '/exit' || line === '/quit') {
        exitReason = 'user_exit';
        break;
      }

      if (router.isSlashCommand(line)) {
        const routed = await router.dispatch(line, {
          state,
          cwd: process.cwd(),
          print: io.print,
        });
        if (routed.type === 'error' && routed.message) {
          io.print(`error: ${routed.message}`);
        } else if (routed.message) {
          io.print(routed.message);
        }
        continue;
      }

      state.turns.push({
        role: 'user',
        content: line,
      });
      const startedAt = now();
      io.print('status=thinking');
      const progressTimer = setInterval(() => {
        io.print(`status=in_progress latency_ms=${now() - startedAt}`);
      }, progressIntervalMs);
      try {
        let assistantText = '';
        if (runAgentTurnStream) {
          for await (const chunk of runAgentTurnStream({
            message: line,
            state,
          })) {
            if (!chunk) {
              continue;
            }
            assistantText += chunk;
            if (io.write) {
              io.write(chunk);
            } else {
              io.print(chunk);
            }
          }
          if (io.write && assistantText.length > 0) {
            io.write('\n');
          }
        } else {
          const assistant = await runAgentTurn({
            message: line,
            state,
          });
          assistantText = assistant.text;
          io.print(assistantText);
        }

        state.turns.push({
          role: 'assistant',
          content: assistantText,
        });
        io.print(`status=done latency_ms=${now() - startedAt}`);
        updateUsageSummary(state, {
          userText: line,
          assistantText,
        });
      } catch (error) {
        io.print(`status=error latency_ms=${now() - startedAt}`);
        io.print(`error: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearInterval(progressTimer);
      }
    }
  } finally {
    io.close();
  }

  return {
    state,
    exitReason,
  };
}
