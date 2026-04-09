import { describe, expect, it } from 'vitest';
import { detectAnxiety, jaccardSimilarity, decideStrategy } from '../../brain/context-manager.js';
import type { EvaluationResult } from '../../brain/types.js';

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaccardSimilarity('hello world', 'hello world')).toBe(1.0);
  });

  it('returns 0.0 for completely different strings', () => {
    expect(jaccardSimilarity('foo bar', 'baz qux')).toBe(0.0);
  });

  it('returns value between 0 and 1 for partial overlap', () => {
    const sim = jaccardSimilarity('hello world foo', 'hello world bar');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });
});

describe('detectAnxiety', () => {
  it('detects repetition when Jaccard > 0.8', () => {
    const signals = detectAnxiety({
      outputs: ['fix the bug in auth module line 42', 'fix the bug in auth module line 42'],
      scores: [],
    });
    const rep = signals.find(s => s.type === 'repetition');
    expect(rep).toBeDefined();
    expect(rep!.severity).toBeGreaterThan(0.8);
  });

  it('detects quality degradation on consecutive score drops', () => {
    const scores = [
      { weightedTotal: 7.0 },
      { weightedTotal: 6.0 },
      { weightedTotal: 5.0 },
    ] as Pick<EvaluationResult, 'weightedTotal'>[];
    const signals = detectAnxiety({ outputs: ['a', 'b', 'c'], scores });
    const deg = signals.find(s => s.type === 'quality_degradation');
    expect(deg).toBeDefined();
  });

  it('does not detect degradation on rising scores', () => {
    const scores = [
      { weightedTotal: 5.0 },
      { weightedTotal: 6.0 },
      { weightedTotal: 7.0 },
    ] as Pick<EvaluationResult, 'weightedTotal'>[];
    const signals = detectAnxiety({ outputs: ['a', 'b', 'c'], scores });
    const deg = signals.find(s => s.type === 'quality_degradation');
    expect(deg).toBeUndefined();
  });

  it('detects premature conclusion keywords', () => {
    const signals = detectAnxiety({
      outputs: ['让我总结一下，这个任务已经完成了'],
      scores: [],
    });
    const pc = signals.find(s => s.type === 'premature_conclusion');
    expect(pc).toBeDefined();
  });

  it('returns empty array when no signals', () => {
    const signals = detectAnxiety({ outputs: ['unique output A'], scores: [] });
    expect(signals).toHaveLength(0);
  });
});

describe('decideStrategy', () => {
  it('returns continue when no anxiety', () => {
    expect(decideStrategy([])).toBe('continue');
  });

  it('returns compact on moderate severity', () => {
    expect(decideStrategy([{ type: 'repetition', severity: 0.6, detectionMethod: 'heuristic', evidence: '' }])).toBe('compact');
  });

  it('returns reset on high severity', () => {
    expect(decideStrategy([
      { type: 'repetition', severity: 0.9, detectionMethod: 'heuristic', evidence: '' },
      { type: 'quality_degradation', severity: 0.8, detectionMethod: 'heuristic', evidence: '' },
    ])).toBe('reset');
  });

  it('returns continue on single low-severity signal', () => {
    expect(decideStrategy([
      { type: 'repetition', severity: 0.3, detectionMethod: 'heuristic', evidence: '' },
    ])).toBe('continue');
  });
});
