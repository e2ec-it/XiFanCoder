import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSprint } from '../../brain/sprint-loop.js';
import { createDefaultRubric } from '../../brain/types.js';
import type { SprintContract } from '../../brain/types.js';

vi.mock('../../brain/evaluator.js', () => ({
  evaluate: vi.fn(),
}));

vi.mock('../../brain/context-manager.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../brain/context-manager.js')>();
  return { ...original };
});

// Mock event recording (optional sessionId path)
vi.mock('../../observer/event-store.js', () => ({
  recordEvent: vi.fn(),
  flushQueue: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../db/pool.js', () => ({
  getPool: vi.fn().mockReturnValue({}),
}));

import { evaluate } from '../../brain/evaluator.js';
import { recordEvent } from '../../observer/event-store.js';
import * as contextManager from '../../brain/context-manager.js';
const mockEvaluate = vi.mocked(evaluate);
const mockRecord = vi.mocked(recordEvent);

const testContract: SprintContract = {
  sprintId: 'sp-test',
  taskDescription: 'Fix auth bug',
  acceptanceCriteria: [],
  maxIterations: 3,
  qualityRubric: createDefaultRubric(),
  negotiationRounds: 1,
  frozenAt: new Date().toISOString(),
};

describe('runSprint', () => {
  afterEach(() => {
    delete process.env['XIFAN_DISABLE_EVALUATOR'];
    delete process.env['XIFAN_DISABLE_CONTEXT_MGR'];
    delete process.env['XIFAN_ABLATION_RUN_ID'];
    delete process.env['XIFAN_ABLATION_EXPERIMENT'];
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('completes on first pass', async () => {
    mockEvaluate.mockResolvedValueOnce({
      sprintId: 'sp-test', round: 1,
      scores: new Map([['task_completeness', 9]]),
      weightedTotal: 8.5, verdict: 'pass',
      feedback: 'Excellent', evidence: [],
    });
    const generate = vi.fn().mockResolvedValue('function fix() {}');
    const result = await runSprint(testContract, generate);
    expect(result.iterations).toBe(1);
    expect(result.converged).toBe(true);
    expect(generate).toHaveBeenCalledOnce();
  });

  it('iterates when evaluator returns iterate', async () => {
    mockEvaluate
      .mockResolvedValueOnce({
        sprintId: 'sp-test', round: 1,
        scores: new Map(), weightedTotal: 5.0, verdict: 'iterate',
        feedback: 'Needs improvement', evidence: [],
      })
      .mockResolvedValueOnce({
        sprintId: 'sp-test', round: 2,
        scores: new Map(), weightedTotal: 8.0, verdict: 'pass',
        feedback: 'Good now', evidence: [],
      });
    const generate = vi.fn()
      .mockResolvedValueOnce('attempt 1')
      .mockResolvedValueOnce('attempt 2');
    const result = await runSprint(testContract, generate);
    expect(result.iterations).toBe(2);
    expect(result.converged).toBe(true);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('stops at maxIterations', async () => {
    mockEvaluate.mockResolvedValue({
      sprintId: 'sp-test', round: 1,
      scores: new Map(), weightedTotal: 5.0, verdict: 'iterate',
      feedback: 'Still needs work', evidence: [],
    });
    const generate = vi.fn().mockResolvedValue('code');
    const result = await runSprint(testContract, generate);
    expect(result.iterations).toBe(3);
    expect(result.converged).toBe(false);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('aborts early when evaluator returns abort', async () => {
    mockEvaluate.mockResolvedValueOnce({
      sprintId: 'sp-test', round: 1,
      scores: new Map(), weightedTotal: 2.0, verdict: 'abort',
      feedback: 'Wrong approach', evidence: [],
    });
    const generate = vi.fn().mockResolvedValue('bad code');
    const result = await runSprint(testContract, generate);
    expect(result.iterations).toBe(1);
    expect(result.converged).toBe(false);
  });

  it('detects plateau and stops early with converged=false', async () => {
    mockEvaluate
      .mockResolvedValueOnce({
        sprintId: 'sp-test', round: 1,
        scores: new Map(), weightedTotal: 6.5, verdict: 'iterate',
        feedback: 'Close', evidence: [],
      })
      .mockResolvedValueOnce({
        sprintId: 'sp-test', round: 2,
        scores: new Map(), weightedTotal: 6.7, verdict: 'iterate',
        feedback: 'Barely changed', evidence: [],
      });
    const generate = vi.fn().mockResolvedValue('code');
    const result = await runSprint(testContract, generate);
    // Delta 0.2 < convergenceDelta 0.5 → stops early, but converged=false
    // because verdict is still 'iterate' (never passed)
    expect(result.iterations).toBe(2);
    expect(result.converged).toBe(false);
  });

  it('passes feedback to generator on iteration', async () => {
    mockEvaluate
      .mockResolvedValueOnce({
        sprintId: 'sp-test', round: 1,
        scores: new Map(), weightedTotal: 5.0, verdict: 'iterate',
        feedback: 'Add null check on line 10', evidence: [],
      })
      .mockResolvedValueOnce({
        sprintId: 'sp-test', round: 2,
        scores: new Map(), weightedTotal: 8.0, verdict: 'pass',
        feedback: 'Good', evidence: [],
      });
    const generate = vi.fn().mockResolvedValue('code');
    await runSprint(testContract, generate);
    expect(generate).toHaveBeenCalledTimes(2);
    const secondCallArgs = generate.mock.calls[1];
    expect(secondCallArgs![0]).toContain('Add null check on line 10');
  });

  it('records events when sessionId is provided', async () => {
    mockEvaluate.mockResolvedValueOnce({
      sprintId: 'sp-test', round: 1,
      scores: new Map(), weightedTotal: 8.5, verdict: 'pass',
      feedback: 'Good', evidence: [],
    });
    const generate = vi.fn().mockResolvedValue('code');
    await runSprint(testContract, generate, 'real-session-123');
    const evalEvents = mockRecord.mock.calls.filter(
      (c) => (c[1] as { type: string }).type === 'evaluation_round',
    );
    const completedEvents = mockRecord.mock.calls.filter(
      (c) => (c[1] as { type: string }).type === 'sprint_completed',
    );
    expect(evalEvents.length).toBeGreaterThan(0);
    expect(completedEvents).toHaveLength(1);
  });

  it('does not record events when sessionId is omitted', async () => {
    mockEvaluate.mockResolvedValueOnce({
      sprintId: 'sp-test', round: 1,
      scores: new Map(), weightedTotal: 8.5, verdict: 'pass',
      feedback: 'Good', evidence: [],
    });
    const generate = vi.fn().mockResolvedValue('code');
    await runSprint(testContract, generate);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('stops after one round without convergence when evaluator is disabled', async () => {
    process.env['XIFAN_DISABLE_EVALUATOR'] = '1';
    const generate = vi.fn().mockResolvedValue('code');

    const result = await runSprint(testContract, generate);

    expect(result.iterations).toBe(1);
    expect(result.converged).toBe(false);
    expect(result.finalScores.verdict).toBe('iterate');
    expect(result.finalScores.feedback).toContain('Evaluator disabled');
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('skips context-manager anxiety handling when disabled', async () => {
    process.env['XIFAN_DISABLE_CONTEXT_MGR'] = '1';
    const detectSpy = vi.spyOn(contextManager, 'detectAnxiety');
    const decideSpy = vi.spyOn(contextManager, 'decideStrategy');

    mockEvaluate.mockResolvedValue({
      sprintId: 'sp-test',
      round: 1,
      scores: new Map(),
      weightedTotal: 4.0,
      verdict: 'iterate',
      feedback: 'Keep going',
      evidence: [],
    });

    const result = await runSprint(testContract, vi.fn().mockResolvedValue('code'));

    expect(result.iterations).toBe(3);
    expect(result.converged).toBe(false);
    expect(detectSpy).not.toHaveBeenCalled();
    expect(decideSpy).not.toHaveBeenCalled();
  });

  it('throws when maxIterations < 1', async () => {
    const badContract = { ...testContract, maxIterations: 0 };
    const generate = vi.fn().mockResolvedValue('code');
    await expect(runSprint(badContract, generate)).rejects.toThrow('maxIterations must be >= 1');
  });

  it('records ablation metadata in emitted events', async () => {
    process.env['XIFAN_ABLATION_RUN_ID'] = 'run-42';
    process.env['XIFAN_ABLATION_EXPERIMENT'] = 'disable-evaluator';
    mockEvaluate.mockResolvedValueOnce({
      sprintId: 'sp-test', round: 1,
      scores: new Map(), weightedTotal: 8.5, verdict: 'pass',
      feedback: 'Good', evidence: [],
    });

    await runSprint(testContract, vi.fn().mockResolvedValue('code'), 'real-session-123');

    for (const [, event] of mockRecord.mock.calls) {
      expect((event as { payload: Record<string, unknown> }).payload.ablation_run_id).toBe('run-42');
      expect((event as { payload: Record<string, unknown> }).payload.ablation_experiment).toBe('disable-evaluator');
    }
  });
});
