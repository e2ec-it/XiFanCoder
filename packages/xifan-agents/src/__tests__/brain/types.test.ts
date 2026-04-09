import { describe, expect, it } from 'vitest';

import { createDefaultRubric, validateContract } from '../../brain/types.js';

describe('createDefaultRubric', () => {
  it('returns 5 dimensions with weights summing to 1.0', () => {
    const rubric = createDefaultRubric();
    expect(rubric).toHaveLength(5);
    const totalWeight = rubric.reduce((sum, d) => sum + d.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0);
  });

  it('includes task_completeness as highest weight', () => {
    const rubric = createDefaultRubric();
    const tc = rubric.find(d => d.name === 'task_completeness');
    expect(tc).toBeDefined();
    expect(tc!.weight).toBe(0.30);
  });
});

describe('validateContract', () => {
  it('returns true for valid contract', () => {
    const contract = {
      sprintId: 'sp-001',
      taskDescription: 'Fix the auth bug',
      acceptanceCriteria: [{ id: 'ac-1', description: 'Tests pass', testMethod: 'shell_command' as const, expectedOutcome: 'exit 0' }],
      maxIterations: 5,
      qualityRubric: createDefaultRubric(),
      negotiationRounds: 1,
      frozenAt: new Date().toISOString(),
    };
    expect(validateContract(contract)).toBe(true);
  });

  it('returns false when maxIterations exceeds 10', () => {
    const contract = {
      sprintId: 'sp-001',
      taskDescription: 'Fix the auth bug',
      acceptanceCriteria: [],
      maxIterations: 11,
      qualityRubric: createDefaultRubric(),
      negotiationRounds: 1,
      frozenAt: new Date().toISOString(),
    };
    expect(validateContract(contract)).toBe(false);
  });

  it('returns false when taskDescription is empty', () => {
    const contract = {
      sprintId: 'sp-001',
      taskDescription: '',
      acceptanceCriteria: [],
      maxIterations: 5,
      qualityRubric: createDefaultRubric(),
      negotiationRounds: 1,
      frozenAt: new Date().toISOString(),
    };
    expect(validateContract(contract)).toBe(false);
  });
});
