import { getPool } from '../db/pool.js';
import { runMigration } from '../db/migrate.js';
import { startSession, endSession } from '../observer/session.js';
import { recordEvent, flushQueue } from '../observer/event-store.js';
import { getReplay } from '../observer/replay.js';

export type ToolHandler = (args: unknown) => Promise<unknown>;

const handlers = new Map<string, ToolHandler>();

export function registerHandler(toolName: string, handler: ToolHandler): void {
  handlers.set(toolName, handler);
}

export async function routeTool(toolName: string, args: unknown): Promise<unknown> {
  const handler = handlers.get(toolName);
  if (!handler) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  return handler(args);
}

export async function initHandlers(): Promise<void> {
  const pool = getPool();
  await runMigration(pool);

  registerHandler('agents_session_start', async (args) => {
    const a = args as { userInput: string; projectPath?: string; model?: string };
    const sessionId = await startSession(pool, {
      project: a.projectPath ?? process.cwd(),
      userInput: a.userInput,
      model: a.model,
    });
    return { sessionId };
  });

  registerHandler('agents_record_event', async (args) => {
    const a = args as {
      sessionId: string; toolName: string; args?: unknown;
      output?: unknown; durationMs?: number;
    };
    recordEvent(pool, {
      sessionId: a.sessionId,
      type: 'tool_call',
      toolName: a.toolName,
      payload: { args: a.args, output: a.output },
      durationMs: a.durationMs,
    });
    return { ok: true };
  });

  registerHandler('agents_session_end', async (args) => {
    const a = args as {
      sessionId: string;
      status: 'completed' | 'max_rounds' | 'error';
      rounds: number;
      toolCount: number;
    };
    await flushQueue();
    await endSession(pool, a);
    return { ok: true };
  });

  registerHandler('agents_replay', async (args) => {
    const a = args as { sessionId: string };
    const events = await getReplay(pool, a.sessionId);
    return { events };
  });

  // Phase B handlers
  const { hybridSearch } = await import('../memory/retriever.js');
  const { assembleContext } = await import('../memory/assembler.js');
  const { saveMemory } = await import('../memory/store.js');

  registerHandler('agents_retrieve_experiences', async (args) => {
    const a = args as { query: string; topK?: number; project?: string };
    const results = await hybridSearch(pool, a.query, { topK: a.topK ?? 5, project: a.project });
    const context = assembleContext(results);
    return { context, count: results.length };
  });

  registerHandler('agents_save_observation', async (args) => {
    const a = args as {
      type: 'episodic' | 'semantic' | 'procedural' | 'emotional' | 'reflective';
      summary: string;
      payload?: unknown;
      project?: string;
    };
    const id = await saveMemory(pool, a);
    return { id };
  });

  // Phase C handlers
  registerHandler('agents_get_skill', async (args) => {
    const a = args as { query: string; topK?: number };
    const results = await hybridSearch(pool, a.query, { topK: a.topK ?? 3 });
    const skills = results.filter((r) => r.type === 'procedural');
    return { skills: skills.map((s) => ({ id: s.id, summary: s.summary, salience: s.salience })) };
  });

  // Phase D handlers
  const { collectMetrics } = await import('../integration/metrics.js');

  registerHandler('agents_status', async () => {
    const metrics = await collectMetrics(pool);
    return { status: 'ok', metrics };
  });

  // Phase D — MCP proxy & episodic memory handlers
  const { runMcpProxy } = await import('../observer/mcp-proxy.js');
  const { extractSkillIfWorthy } = await import('../evolution/sage.js');

  registerHandler('agents_start_mcp_proxy', async (args) => {
    const { targetCmd, sessionId } = args as { targetCmd: string; sessionId: string };

    if (typeof targetCmd !== 'string' || !targetCmd.trim()) {
      throw new Error('agents_start_mcp_proxy: targetCmd must be a non-empty string');
    }
    if (typeof sessionId !== 'string' || !sessionId) {
      throw new Error('agents_start_mcp_proxy: sessionId must be a non-empty string');
    }

    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      console.warn('[xifan-agents] DATABASE_URL not set — MCP proxy DB recording disabled');
      // Still start proxy in bypass mode with empty connection string
    }

    // Start MCP proxy in background (don't await — it runs until process exits)
    setImmediate(() => {
      runMcpProxy({ targetCmd, sessionId, databaseUrl: databaseUrl ?? '', onError: 'bypass' })
        .catch((err: unknown) => console.error('[xifan-agents] MCP proxy error:', err));
    });

    // Port 7891 is the designated MCP proxy identifier per design spec (stdio transport, not TCP)
    return { port: 7891 };
  });

  registerHandler('agents_save_episodic', async (args) => {
    const { summary, payload, project, salience, failed } = args as {
      summary: string;
      payload: Record<string, unknown>;
      project: string;
      salience?: number;
      failed?: boolean;  // if true, use salience 0.3 default
    };

    if (typeof summary !== 'string') throw new Error('agents_save_episodic: summary must be a string');
    if (typeof project !== 'string' || !project) throw new Error('agents_save_episodic: project must be a non-empty string');
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('agents_save_episodic: payload must be a plain object');
    }

    const defaultSalience = failed ? 0.3 : 0.8;

    // Save to xifan_mem.memories as episodic type
    const memoryId = await saveMemory(pool, {
      type: 'episodic',
      summary,
      payload,
      project,
      salience: salience ?? defaultSalience,
    });

    // SAGE extraction: fire-and-forget — don't block the response
    // extractSkillIfWorthy requires a sessionId; use a synthetic one derived from project
    extractSkillIfWorthy(pool, `episodic:${project}`, {
      userInput: summary,
      status: 'completed',
      toolCount: 0,
      filesModified: 0,
    }).catch(
      (err: unknown) => console.error('[xifan-agents] SAGE extraction error:', err),
    );

    return { memoryId, status: 'saved' };
  });

  // Phase D — Brain: Evaluator Agent handlers (#51)
  const { evaluate: brainEvaluate } = await import('../brain/evaluator.js');
  const { negotiateContract: brainNegotiate } = await import('../brain/contract-negotiator.js');
  const { runSprint: brainRunSprint } = await import('../brain/sprint-loop.js');
  const { createDefaultRubric, validateContract } = await import('../brain/types.js');

  /** Convert untrusted JSON input to a validated SprintContract. */
  function toSprintContract(input: Record<string, unknown>): import('../brain/types.js').SprintContract {
    const contract = {
      sprintId: String(input['sprintId'] ?? ''),
      taskDescription: String(input['taskDescription'] ?? ''),
      acceptanceCriteria: Array.isArray(input['acceptanceCriteria']) ? input['acceptanceCriteria'] as import('../brain/types.js').AcceptanceCriterion[] : [],
      maxIterations: Math.min(Math.max(1, Number(input['maxIterations']) || 5), 10),
      qualityRubric: Array.isArray(input['qualityRubric']) && (input['qualityRubric'] as unknown[]).length > 0
        ? input['qualityRubric'] as import('../brain/types.js').QualityRubric
        : createDefaultRubric(),
      negotiationRounds: Number(input['negotiationRounds']) || 1,
      frozenAt: String(input['frozenAt'] ?? new Date().toISOString()),
    };
    if (!validateContract(contract)) {
      throw new Error('Invalid SprintContract: taskDescription required, maxIterations 1-10');
    }
    return contract;
  }

  registerHandler('agents_evaluate', async (args) => {
    const a = args as { contract: Record<string, unknown>; codeOutput: string; round: number };
    if (typeof a.codeOutput !== 'string') throw new Error('agents_evaluate: codeOutput must be a string');
    const contract = toSprintContract(a.contract ?? {});
    const result = await brainEvaluate(contract, a.codeOutput, Number(a.round) || 1);
    return { ...result, scores: Object.fromEntries(result.scores) };
  });

  registerHandler('agents_negotiate_contract', async (args) => {
    const { taskDescription, rubric } = args as { taskDescription: string; rubric?: unknown };
    if (typeof taskDescription !== 'string' || !taskDescription.trim()) {
      throw new Error('agents_negotiate_contract: taskDescription must be a non-empty string');
    }
    return brainNegotiate(taskDescription, Array.isArray(rubric) ? rubric as import('../brain/types.js').QualityRubric : undefined);
  });

  registerHandler('agents_run_sprint', async (args) => {
    const a = args as { contract: Record<string, unknown>; generatePrompt: string; sessionId?: string };
    if (typeof a.generatePrompt !== 'string' || !a.generatePrompt.trim()) {
      throw new Error('agents_run_sprint: generatePrompt must be a non-empty string');
    }
    const contract = toSprintContract(a.contract ?? {});
    const { chatCompletion } = await import('../brain/llm-client.js');
    const generatorModel = process.env['XIFAN_GENERATOR_MODEL'] ?? 'qwen3-coder-next';
    const generate = async (feedback: string): Promise<string> => {
      const prompt = feedback
        ? `${a.generatePrompt}\n\n## 上轮评审反馈\n${feedback}`
        : a.generatePrompt;
      const res = await chatCompletion({ model: generatorModel, messages: [{ role: 'user', content: prompt }] });
      return res.content;
    };
    const result = await brainRunSprint(contract, generate, a.sessionId);
    return {
      ...result,
      finalScores: { ...result.finalScores, scores: Object.fromEntries(result.finalScores.scores) },
    };
  });
}
