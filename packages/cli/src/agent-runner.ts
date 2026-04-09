import { AgentLoop, type AgentLoopDeps } from '@xifan-coder/core';
import type { IPluginBus } from '@xifan-coder/plugin-bus';

import type { ReplDeps } from './repl.js';

const PLUGIN_NAME = 'xifan-agents';

type RunnerLoopDeps = Omit<AgentLoopDeps, 'executeTool'> & {
  readonly executeTool: AgentLoopDeps['executeTool'];
  readonly llmDriver: AgentLoopDeps['llmDriver'] & { readonly defaultModel?: string };
};

export function createObservedAgentRunner(
  bus: IPluginBus,
  loopDeps: RunnerLoopDeps,
): NonNullable<ReplDeps['runAgentTurn']> {
  return async ({ message }) => {
    // 1. Start session — failure must not block loop
    let sessionId: string | undefined;
    try {
      const r = await bus.executeTool(PLUGIN_NAME, 'agents_session_start', {
        userInput: message,
        projectPath: process.cwd(),
      });
      sessionId = (r.content as { sessionId?: string } | undefined)?.sessionId;
    } catch { /* silent */ }

    // 2. Retrieve experiences for Prompt Assembler (Phase B)
    let xifanContext = '';
    try {
      const r = await bus.executeTool(PLUGIN_NAME, 'agents_get_context', {
        query: message,
        project: process.cwd(),
        topK: 5,
      });
      if (typeof r.content === 'string') xifanContext = r.content;
    } catch { /* silent — no context is OK, xifanContext stays '' */ }

    // 3. Wrap executeTool to emit observation events (fire-and-forget)
    const wrappedExecuteTool: AgentLoopDeps['executeTool'] = async (toolName, args) => {
      const start = Date.now();
      const result = await loopDeps.executeTool(toolName, args);
      if (sessionId) {
        bus.executeTool(PLUGIN_NAME, 'agents_record_event', {
          sessionId,
          toolName,
          args,
          output: result.output,
          durationMs: Date.now() - start,
        }).catch(() => { /* silent */ });
      }
      return result;
    };

    // 4. Run AgentLoop with xifanContext injected
    const loop = new AgentLoop({ ...loopDeps, executeTool: wrappedExecuteTool });
    const model = loopDeps.llmDriver.defaultModel ?? 'default';

    let loopResult: { status: string; rounds: number; assistantText: string; toolCalls: readonly unknown[] } | undefined;
    try {
      loopResult = await loop.run({ model, userInput: message, xifanContext });
    } finally {
      // 5. End session (always, even on error)
      if (sessionId) {
        bus.executeTool(PLUGIN_NAME, 'agents_session_end', {
          sessionId,
          status: loopResult?.status ?? 'error',
          rounds: loopResult?.rounds ?? 0,
          toolCount: loopResult?.toolCalls?.length ?? 0,
        }).catch(() => { /* silent */ });
      }
    }

    // 6. Save episodic memory + SAGE extraction (Phase B/C, fire-and-forget)
    if (sessionId && loopResult) {
      const inputPrefix = message.slice(0, 100);
      const summary = `${inputPrefix}${message.length > 100 ? '...' : ''} (${loopResult.status}, ${loopResult.rounds} rounds)`;
      bus.executeTool(PLUGIN_NAME, 'agents_save_episodic', {
        summary,
        payload: {
          sessionId,
          status: loopResult.status,
          rounds: loopResult.rounds,
          toolCalls: loopResult.toolCalls,
        },
        failed: loopResult.status !== 'completed',
      }).catch(() => { /* silent */ });
    }

    return { text: loopResult!.assistantText };
  };
}
