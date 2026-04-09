import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mock all dependencies before importing router
vi.mock('../../db/pool.js', () => ({
  getPool: vi.fn().mockReturnValue({}),
}));
vi.mock('../../db/migrate.js', () => ({
  runMigration: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../observer/session.js', () => ({
  startSession: vi.fn().mockResolvedValue('sess-1'),
  endSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../observer/event-store.js', () => ({
  recordEvent: vi.fn(),
  flushQueue: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../observer/replay.js', () => ({
  getReplay: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../memory/retriever.js', () => ({
  hybridSearch: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../memory/assembler.js', () => ({
  assembleContext: vi.fn().mockReturnValue(''),
}));
vi.mock('../../memory/store.js', () => ({
  saveMemory: vi.fn().mockResolvedValue('mem-1'),
}));
vi.mock('../../integration/metrics.js', () => ({
  collectMetrics: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../observer/mcp-proxy.js', () => ({
  runMcpProxy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../evolution/sage.js', () => ({
  extractSkillIfWorthy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../brain/evaluator.js', () => ({
  evaluate: vi.fn().mockResolvedValue({
    sprintId: 'sp-1', round: 1, scores: new Map(),
    weightedTotal: 8.0, verdict: 'pass', feedback: 'OK', evidence: [],
  }),
}));
vi.mock('../../brain/contract-negotiator.js', () => ({
  negotiateContract: vi.fn().mockResolvedValue({
    sprintId: 'sp-1', taskDescription: 'test', acceptanceCriteria: [],
    maxIterations: 5, qualityRubric: [], negotiationRounds: 1, frozenAt: '',
  }),
}));
vi.mock('../../brain/sprint-loop.js', () => ({
  runSprint: vi.fn().mockResolvedValue({
    sprintId: 'sp-1', iterations: 1, converged: true, durationMs: 100,
    finalScores: { weightedTotal: 8.0, verdict: 'pass', scores: new Map() },
    contract: {},
  }),
}));
vi.mock('../../brain/llm-client.js', () => ({
  chatCompletion: vi.fn().mockResolvedValue({ content: 'generated code', usage: { promptTokens: 0, completionTokens: 0 } }),
}));

import { initHandlers, routeTool } from '../../plugin/router.js';

beforeAll(async () => {
  await initHandlers();
});

describe('brain plugin handlers', () => {
  it('registers agents_evaluate handler', async () => {
    const result = await routeTool('agents_evaluate', {
      contract: {
        sprintId: 'sp-1', taskDescription: 'test',
        acceptanceCriteria: [], maxIterations: 5,
        qualityRubric: [], negotiationRounds: 1, frozenAt: '',
      },
      codeOutput: 'function foo() {}',
      round: 1,
    });
    expect(result).toHaveProperty('verdict');
  });

  it('registers agents_negotiate_contract handler', async () => {
    const result = await routeTool('agents_negotiate_contract', {
      taskDescription: 'Add validation',
    });
    expect(result).toHaveProperty('sprintId');
  });

  it('registers agents_run_sprint handler', async () => {
    const result = await routeTool('agents_run_sprint', {
      contract: {
        sprintId: 'sp-1', taskDescription: 'test',
        acceptanceCriteria: [], maxIterations: 3,
        qualityRubric: [], negotiationRounds: 1, frozenAt: '',
      },
      generatePrompt: 'Write a function',
    });
    expect(result).toHaveProperty('sprintId');
    expect(result).toHaveProperty('converged');
  });
});
