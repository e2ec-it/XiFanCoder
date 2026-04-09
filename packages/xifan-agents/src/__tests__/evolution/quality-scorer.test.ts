import { describe, expect, it } from 'vitest';

import { scoreTrajectory } from '../../evolution/quality-scorer.js';

describe('scoreTrajectory', () => {
  it('scores successful short session high', () => {
    const score = scoreTrajectory({ status: 'completed', toolCount: 3, filesModified: 2 });
    expect(score).toBeGreaterThan(0.7);
  });

  it('scores failed session low', () => {
    const score = scoreTrajectory({ status: 'max_rounds', toolCount: 50, filesModified: 0 });
    expect(score).toBeLessThan(0.3);
  });
});
