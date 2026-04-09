// packages/xifan-agents/src/__tests__/unit/router-new-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock DB pool
// ---------------------------------------------------------------------------
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockPool = { query: mockQuery };

vi.mock('../../db/pool.js', () => ({
  getPool: () => mockPool,
}));

// ---------------------------------------------------------------------------
// Mock DB migration
// ---------------------------------------------------------------------------
vi.mock('../../db/migrate.js', () => ({
  runMigration: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock observer modules used by existing handlers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Mock memory modules
// ---------------------------------------------------------------------------
const mockSaveMemory = vi.fn().mockResolvedValue('mem-uuid-123');

vi.mock('../../memory/store.js', () => ({
  saveMemory: (...args: unknown[]) => mockSaveMemory(...args),
}));

vi.mock('../../memory/retriever.js', () => ({
  hybridSearch: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../memory/assembler.js', () => ({
  assembleContext: vi.fn().mockReturnValue(''),
}));

// ---------------------------------------------------------------------------
// Mock SAGE evolution module
// ---------------------------------------------------------------------------
const mockExtractSkillIfWorthy = vi.fn().mockResolvedValue(undefined);

vi.mock('../../evolution/sage.js', () => ({
  extractSkillIfWorthy: (...args: unknown[]) => mockExtractSkillIfWorthy(...args),
}));

// ---------------------------------------------------------------------------
// Mock integration metrics
// ---------------------------------------------------------------------------
vi.mock('../../integration/metrics.js', () => ({
  collectMetrics: vi.fn().mockResolvedValue({}),
}));

// ---------------------------------------------------------------------------
// Mock MCP proxy (fire-and-forget — don't let it actually run)
// ---------------------------------------------------------------------------
const mockRunMcpProxy = vi.fn().mockResolvedValue(undefined);

vi.mock('../../observer/mcp-proxy.js', () => ({
  runMcpProxy: (...args: unknown[]) => mockRunMcpProxy(...args),
}));

// ---------------------------------------------------------------------------
// Mock Brain modules
// ---------------------------------------------------------------------------
const mockBrainEvaluate = vi.fn();
vi.mock('../../brain/evaluator.js', () => ({
  evaluate: (...args: unknown[]) => mockBrainEvaluate(...args),
}));

const mockBrainNegotiate = vi.fn();
vi.mock('../../brain/contract-negotiator.js', () => ({
  negotiateContract: (...args: unknown[]) => mockBrainNegotiate(...args),
}));

const mockBrainRunSprint = vi.fn();
vi.mock('../../brain/sprint-loop.js', () => ({
  runSprint: (...args: unknown[]) => mockBrainRunSprint(...args),
}));

const mockChatCompletion = vi.fn();
vi.mock('../../brain/llm-client.js', () => ({
  chatCompletion: (...args: unknown[]) => mockChatCompletion(...args),
}));

// ---------------------------------------------------------------------------
// Import router AFTER all mocks are set up
// ---------------------------------------------------------------------------
import { initHandlers, routeTool } from '../../plugin/router.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase A handlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await initHandlers();
  });

  it('agents_session_start returns sessionId', async () => {
    const result = await routeTool('agents_session_start', { userInput: 'fix bug' });
    expect(result).toEqual({ sessionId: 'sess-1' });
  });

  it('agents_record_event returns ok', async () => {
    const result = await routeTool('agents_record_event', {
      sessionId: 'sess-1', toolName: 'Read', args: {}, output: 'data', durationMs: 100,
    });
    expect(result).toEqual({ ok: true });
  });

  it('agents_session_end returns ok', async () => {
    const result = await routeTool('agents_session_end', {
      sessionId: 'sess-1', status: 'completed', rounds: 3, toolCount: 10,
    });
    expect(result).toEqual({ ok: true });
  });

  it('agents_replay returns events', async () => {
    const result = await routeTool('agents_replay', { sessionId: 'sess-1' });
    expect(result).toEqual({ events: [] });
  });

  it('agents_status returns ok with metrics', async () => {
    const result = await routeTool('agents_status', {});
    expect(result).toEqual({ status: 'ok', metrics: {} });
  });
});

describe('agents_start_mcp_proxy handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSaveMemory.mockResolvedValue('mem-uuid-123');
    mockRunMcpProxy.mockResolvedValue(undefined);
    await initHandlers();
  });

  it('returns { port: 7891 } synchronously', async () => {
    const result = await routeTool('agents_start_mcp_proxy', {
      targetCmd: 'node some-mcp-server.js',
      sessionId: 'sess-abc',
    });

    expect(result).toMatchObject({ port: 7891 });
    expect(result).not.toHaveProperty('status');
  });

  it('does not await runMcpProxy — returns before proxy resolves', async () => {
    // Make runMcpProxy a promise that never resolves
    let resolveProxy!: () => void;
    mockRunMcpProxy.mockReturnValue(
      new Promise<void>((res) => { resolveProxy = res; })
    );

    const resultPromise = routeTool('agents_start_mcp_proxy', {
      targetCmd: 'node slow-mcp.js',
      sessionId: 'sess-slow',
    });

    // The handler should resolve immediately even though proxy is pending
    const result = await resultPromise;
    expect(result).toMatchObject({ port: 7891 });

    // Clean up
    resolveProxy();
  });

  it('throws on empty targetCmd', async () => {
    await expect(
      routeTool('agents_start_mcp_proxy', { targetCmd: '', sessionId: 'sess-abc' })
    ).rejects.toThrow('agents_start_mcp_proxy: targetCmd must be a non-empty string');
  });

  it('throws on whitespace-only targetCmd', async () => {
    await expect(
      routeTool('agents_start_mcp_proxy', { targetCmd: '   ', sessionId: 'sess-abc' })
    ).rejects.toThrow('agents_start_mcp_proxy: targetCmd must be a non-empty string');
  });

  it('throws on missing sessionId', async () => {
    await expect(
      routeTool('agents_start_mcp_proxy', { targetCmd: 'node server.js', sessionId: '' })
    ).rejects.toThrow('agents_start_mcp_proxy: sessionId must be a non-empty string');
  });
});

describe('agents_save_episodic handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSaveMemory.mockResolvedValue('mem-uuid-123');
    mockExtractSkillIfWorthy.mockResolvedValue(undefined);
    await initHandlers();
  });

  it('returns { memoryId, status: "saved" }', async () => {
    const result = await routeTool('agents_save_episodic', {
      summary: 'Fixed the auth bug',
      payload: { files: ['auth.ts'], linesChanged: 12 },
      project: 'xifan-app',
      salience: 0.9,
    });

    expect(result).toEqual({ memoryId: 'mem-uuid-123', status: 'saved' });
  });

  it('uses default salience 0.8 when not provided', async () => {
    await routeTool('agents_save_episodic', {
      summary: 'Added feature X',
      payload: { detail: 'some detail' },
      project: 'xifan-app',
      // salience intentionally omitted
    });

    expect(mockSaveMemory).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({ salience: 0.8 }),
    );
  });

  it('saves memory with type "episodic"', async () => {
    await routeTool('agents_save_episodic', {
      summary: 'Episodic event',
      payload: {},
      project: 'proj-1',
    });

    expect(mockSaveMemory).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({ type: 'episodic' }),
    );
  });

  it('passes through custom salience when provided', async () => {
    await routeTool('agents_save_episodic', {
      summary: 'Low salience event',
      payload: {},
      project: 'proj-2',
      salience: 0.3,
    });

    expect(mockSaveMemory).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({ salience: 0.3 }),
    );
  });

  it('uses salience 0.3 when failed: true is passed', async () => {
    await routeTool('agents_save_episodic', {
      summary: 'Failed to deploy',
      payload: { reason: 'timeout' },
      project: 'xifan-app',
      failed: true,
    });

    expect(mockSaveMemory).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({ salience: 0.3 }),
    );
  });

  it('throws when payload is null', async () => {
    await expect(
      routeTool('agents_save_episodic', {
        summary: 'Some event',
        payload: null,
        project: 'proj-x',
      })
    ).rejects.toThrow('agents_save_episodic: payload must be a plain object');
  });

  it('throws when payload is an array', async () => {
    await expect(
      routeTool('agents_save_episodic', {
        summary: 'Some event',
        payload: ['not', 'an', 'object'],
        project: 'proj-x',
      })
    ).rejects.toThrow('agents_save_episodic: payload must be a plain object');
  });

  it('throws when project is empty', async () => {
    await expect(
      routeTool('agents_save_episodic', {
        summary: 'Some event',
        payload: {},
        project: '',
      })
    ).rejects.toThrow('agents_save_episodic: project must be a non-empty string');
  });
});

describe('agents_evaluate handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSaveMemory.mockResolvedValue('mem-uuid-123');
    mockRunMcpProxy.mockResolvedValue(undefined);
    mockBrainEvaluate.mockResolvedValue({
      verdict: 'pass',
      weightedTotal: 8.5,
      scores: new Map([['correctness', 9]]),
      feedback: 'Good',
      evidence: [],
    });
    await initHandlers();
  });

  it('evaluates code output against a contract', async () => {
    const result = await routeTool('agents_evaluate', {
      contract: { sprintId: 'sp-eval', taskDescription: 'Build login', maxIterations: 3 },
      codeOutput: 'function login() {}',
      round: 1,
    });

    expect(mockBrainEvaluate).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({
      verdict: 'pass',
      scores: { correctness: 9 },
    }));
  });

  it('throws when codeOutput is not a string', async () => {
    await expect(
      routeTool('agents_evaluate', {
        contract: { taskDescription: 'Build login' },
        codeOutput: 123,
        round: 1,
      })
    ).rejects.toThrow('agents_evaluate: codeOutput must be a string');
  });

  it('throws on invalid contract (no taskDescription)', async () => {
    await expect(
      routeTool('agents_evaluate', {
        contract: {},
        codeOutput: 'code',
        round: 1,
      })
    ).rejects.toThrow('Invalid SprintContract');
  });

  it('uses provided qualityRubric when non-empty array', async () => {
    const customRubric = [{ name: 'correctness', weight: 0.6, threshold: 7 }];
    await routeTool('agents_evaluate', {
      contract: {
        sprintId: 'sp-rubric',
        taskDescription: 'Build X',
        maxIterations: 2,
        qualityRubric: customRubric,
      },
      codeOutput: 'code',
      round: 1,
    });

    // Verify the custom rubric was passed to the evaluator
    expect(mockBrainEvaluate).toHaveBeenCalledWith(
      expect.objectContaining({ qualityRubric: customRubric }),
      'code',
      1,
    );
  });
});

describe('agents_negotiate_contract handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSaveMemory.mockResolvedValue('mem-uuid-123');
    mockRunMcpProxy.mockResolvedValue(undefined);
    mockBrainNegotiate.mockResolvedValue({
      sprintId: 'sp-1',
      taskDescription: 'Build auth',
      acceptanceCriteria: [],
      maxIterations: 5,
      qualityRubric: [],
      negotiationRounds: 1,
      frozenAt: new Date().toISOString(),
    });
    await initHandlers();
  });

  it('negotiates a contract from task description', async () => {
    const result = await routeTool('agents_negotiate_contract', {
      taskDescription: 'Build auth module',
    });

    expect(mockBrainNegotiate).toHaveBeenCalledWith('Build auth module', undefined);
    expect(result).toEqual(expect.objectContaining({ sprintId: 'sp-1' }));
  });

  it('passes rubric array when provided', async () => {
    const rubric = [{ name: 'correctness', weight: 0.5, threshold: 6 }];
    await routeTool('agents_negotiate_contract', {
      taskDescription: 'Build auth module',
      rubric,
    });

    expect(mockBrainNegotiate).toHaveBeenCalledWith('Build auth module', rubric);
  });

  it('throws on empty taskDescription', async () => {
    await expect(
      routeTool('agents_negotiate_contract', { taskDescription: '' })
    ).rejects.toThrow('agents_negotiate_contract: taskDescription must be a non-empty string');
  });

  it('throws on whitespace-only taskDescription', async () => {
    await expect(
      routeTool('agents_negotiate_contract', { taskDescription: '   ' })
    ).rejects.toThrow('agents_negotiate_contract: taskDescription must be a non-empty string');
  });
});

describe('agents_run_sprint handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSaveMemory.mockResolvedValue('mem-uuid-123');
    mockRunMcpProxy.mockResolvedValue(undefined);
    mockChatCompletion.mockResolvedValue({ content: 'generated code' });
    mockBrainRunSprint.mockResolvedValue({
      iterations: 2,
      converged: true,
      durationMs: 3000,
      finalScores: {
        verdict: 'pass',
        weightedTotal: 8.0,
        scores: new Map([['correctness', 8]]),
        feedback: 'OK',
        evidence: [],
      },
    });
    await initHandlers();
  });

  it('runs a full sprint loop', async () => {
    const result = await routeTool('agents_run_sprint', {
      contract: { sprintId: 'sp-1', taskDescription: 'Build login', maxIterations: 3 },
      generatePrompt: 'Implement login feature',
      sessionId: 'sess-sprint',
    }) as Record<string, unknown>;

    expect(mockBrainRunSprint).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({
      iterations: 2,
      converged: true,
    }));
    // scores Map should be serialized to plain object
    expect((result['finalScores'] as Record<string, unknown>)['scores']).toEqual({ correctness: 8 });
  });

  it('constructs generator that includes feedback in prompt', async () => {
    // Capture the generator function passed to runSprint
    mockBrainRunSprint.mockImplementation(async (_contract: unknown, generator: (feedback: string) => Promise<string>) => {
      await generator('fix the types');
      await generator('');
      return {
        iterations: 1, converged: true, durationMs: 100,
        finalScores: { verdict: 'pass', weightedTotal: 9, scores: new Map(), feedback: '', evidence: [] },
      };
    });

    await routeTool('agents_run_sprint', {
      contract: { sprintId: 'sp-2', taskDescription: 'Build login', maxIterations: 3 },
      generatePrompt: 'Implement login',
    });

    // First call: with feedback
    expect(mockChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: expect.stringContaining('fix the types') }],
      }),
    );
    // Second call: without feedback (just the prompt)
    expect(mockChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Implement login' }],
      }),
    );
  });

  it('throws on empty generatePrompt', async () => {
    await expect(
      routeTool('agents_run_sprint', {
        contract: { taskDescription: 'Build login' },
        generatePrompt: '',
      })
    ).rejects.toThrow('agents_run_sprint: generatePrompt must be a non-empty string');
  });

  it('throws on whitespace-only generatePrompt', async () => {
    await expect(
      routeTool('agents_run_sprint', {
        contract: { taskDescription: 'Build login' },
        generatePrompt: '   ',
      })
    ).rejects.toThrow('agents_run_sprint: generatePrompt must be a non-empty string');
  });
});
