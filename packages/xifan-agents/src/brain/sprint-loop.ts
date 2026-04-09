import { detectAnxiety, decideStrategy } from './context-manager.js';
import { evaluate } from './evaluator.js';
import { getPool } from '../db/pool.js';
import { recordEvent } from '../observer/event-store.js';
import type { EvaluationResult, SprintContract, SprintResult } from './types.js';
import { DEFAULT_SPRINT_CONFIG } from './types.js';

export type GeneratorFn = (feedback: string) => Promise<string>;

/** Fire-and-forget event recording — only when sessionId is provided. */
function recordSprintEvent(
  sessionId: string | undefined,
  type: string,
  payload: unknown,
): void {
  if (!sessionId) return;
  try {
    const ablationMeta = {
      ablation_run_id: process.env['XIFAN_ABLATION_RUN_ID'] ?? null,
      ablation_experiment: process.env['XIFAN_ABLATION_EXPERIMENT'] ?? null,
    };
    const enriched = { ...(payload as Record<string, unknown>), ...ablationMeta };
    recordEvent(getPool(), { sessionId, type, payload: enriched });
  } catch { /* pool unavailable — silent */ }
}

export async function runSprint(
  contract: SprintContract,
  generate: GeneratorFn,
  sessionId?: string,
): Promise<SprintResult> {
  const startTime = Date.now();
  const evaluations: EvaluationResult[] = [];
  const outputs: string[] = [];
  let lastEval: EvaluationResult | undefined;

  const makeResult = (round: number, converged: boolean): SprintResult => {
    const result: SprintResult = {
      sprintId: contract.sprintId,
      contract,
      iterations: round,
      finalScores: lastEval!,
      converged,
      durationMs: Date.now() - startTime,
    };
    recordSprintEvent(sessionId, 'sprint_completed', {
      iterations: round, converged,
      finalWeightedTotal: lastEval!.weightedTotal,
      durationMs: result.durationMs,
    });
    return result;
  };

  if (contract.maxIterations < 1) {
    throw new Error('runSprint: maxIterations must be >= 1');
  }

  for (let round = 1; round <= contract.maxIterations; round++) {
    const feedback = lastEval?.feedback ?? '';
    const output = await generate(feedback);
    outputs.push(output);

    const evaluatorDisabled = process.env['XIFAN_DISABLE_EVALUATOR'] === '1';
    let evalResult: EvaluationResult;
    if (evaluatorDisabled) {
      evalResult = {
        sprintId: contract.sprintId,
        round,
        scores: new Map(),
        weightedTotal: 0,
        verdict: 'iterate',
        feedback: 'Evaluator disabled (ablation)',
        evidence: [],
      };
    } else {
      evalResult = await evaluate(contract, output, round);
    }
    evaluations.push(evalResult);
    lastEval = evalResult;

    recordSprintEvent(sessionId, 'evaluation_round', {
      round,
      weightedTotal: evalResult.weightedTotal,
      verdict: evalResult.verdict,
      feedback: evalResult.feedback,
    });

    if (evaluatorDisabled) {
      return makeResult(round, false);
    }

    if (evalResult.verdict === 'pass') {
      return makeResult(round, true);
    }

    if (evalResult.verdict === 'abort') {
      return makeResult(round, false);
    }

    if (evaluations.length >= 2) {
      const prev = evaluations[evaluations.length - 2]!;
      const delta = evalResult.weightedTotal - prev.weightedTotal;
      // Plateau: score improved but by less than convergenceDelta — stop early
      // converged=false because verdict is still 'iterate' (not 'pass')
      if (delta > 0 && delta < DEFAULT_SPRINT_CONFIG.convergenceDelta) {
        return makeResult(round, false);
      }
    }

    if (process.env['XIFAN_DISABLE_CONTEXT_MGR'] !== '1') {
      const signals = detectAnxiety({ outputs, scores: evaluations });
      const strategy = decideStrategy(signals);
      if (strategy === 'reset') {
        return makeResult(round, false);
      }
    }
  }

  return makeResult(contract.maxIterations, false);
}
