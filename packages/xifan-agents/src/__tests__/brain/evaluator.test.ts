import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluate, parseEvaluationResponse } from '../../brain/evaluator.js';
import { createDefaultRubric } from '../../brain/types.js';
import type { SprintContract } from '../../brain/types.js';

vi.mock('../../brain/llm-client.js', () => ({
  chatCompletion: vi.fn(),
}));

import { chatCompletion } from '../../brain/llm-client.js';
const mockChat = vi.mocked(chatCompletion);

const testContract: SprintContract = {
  sprintId: 'sp-test',
  taskDescription: 'Add input validation to user registration',
  acceptanceCriteria: [
    { id: 'ac-1', description: 'Validate email format', testMethod: 'shell_command', expectedOutcome: 'tests pass' },
  ],
  maxIterations: 5,
  qualityRubric: createDefaultRubric(),
  negotiationRounds: 1,
  frozenAt: new Date().toISOString(),
};

describe('parseEvaluationResponse', () => {
  it('parses valid JSON response with all dimensions', () => {
    const json = JSON.stringify({
      scores: { task_completeness: 8, code_quality: 7, robustness: 6, originality: 5, tool_efficiency: 7 },
      feedback: 'Good implementation but missing edge cases',
      evidence: ['Line 42 missing null check', 'No test for empty input'],
    });
    const result = parseEvaluationResponse(json, 'sp-test', 1, createDefaultRubric());
    expect(result.verdict).toBe('pass');
    expect(result.weightedTotal).toBeCloseTo(8*0.3 + 7*0.25 + 6*0.2 + 5*0.1 + 7*0.15);
    expect(result.scores.get('task_completeness')).toBe(8);
  });

  it('returns iterate verdict when below threshold', () => {
    const json = JSON.stringify({
      scores: { task_completeness: 4, code_quality: 3, robustness: 3, originality: 3, tool_efficiency: 3 },
      feedback: 'Incomplete implementation',
      evidence: [],
    });
    const result = parseEvaluationResponse(json, 'sp-test', 1, createDefaultRubric());
    expect(result.verdict).toBe('iterate');
  });

  it('returns abort verdict when weighted total below 3.0', () => {
    const json = JSON.stringify({
      scores: { task_completeness: 2, code_quality: 2, robustness: 2, originality: 1, tool_efficiency: 2 },
      feedback: 'Completely wrong approach',
      evidence: [],
    });
    const result = parseEvaluationResponse(json, 'sp-test', 1, createDefaultRubric());
    expect(result.verdict).toBe('abort');
  });
});

describe('evaluate', () => {
  afterEach(() => vi.clearAllMocks());

  it('calls LLM and returns parsed result', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        scores: { task_completeness: 9, code_quality: 8, robustness: 7, originality: 6, tool_efficiency: 8 },
        feedback: 'Excellent work',
        evidence: ['All criteria met'],
      }),
      usage: { promptTokens: 500, completionTokens: 200 },
    });

    const result = await evaluate(testContract, 'function validate(email) { return /@/.test(email); }', 1);
    expect(result.verdict).toBe('pass');
    expect(result.sprintId).toBe('sp-test');
    expect(result.round).toBe(1);
    expect(mockChat).toHaveBeenCalledOnce();
  });

  it('returns iterate on LLM parse failure', async () => {
    mockChat.mockResolvedValueOnce({
      content: 'I think the code looks good!',
      usage: { promptTokens: 500, completionTokens: 50 },
    });

    const result = await evaluate(testContract, 'some code', 2);
    expect(result.verdict).toBe('iterate');
    expect(result.feedback).toContain('Evaluator error');
  });
});
