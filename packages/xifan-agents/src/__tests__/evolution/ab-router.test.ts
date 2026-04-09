import { describe, expect, it, vi } from 'vitest';

import { shouldUseExperiences, detectTaskType } from '../../evolution/ab-router.js';

describe('shouldUseExperiences', () => {
  it('returns true for bugfix tasks (ratio=1.0)', () => {
    for (let i = 0; i < 10; i++) {
      expect(shouldUseExperiences('bugfix')).toBe(true);
    }
  });

  it('returns false for refactor tasks (ratio=0.0)', () => {
    for (let i = 0; i < 10; i++) {
      expect(shouldUseExperiences('refactor')).toBe(false);
    }
  });

  it('uses default config (ratio=0.3) for unknown task types', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    expect(shouldUseExperiences('unknown')).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(shouldUseExperiences('unknown')).toBe(false);
    vi.restoreAllMocks();
  });

  it('uses probabilistic ratio for feature tasks (ratio=0.5)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    expect(shouldUseExperiences('feature')).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValue(0.7);
    expect(shouldUseExperiences('feature')).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('detectTaskType', () => {
  it('detects bugfix from keywords', () => {
    expect(detectTaskType('fix login bug')).toBe('bugfix');
    expect(detectTaskType('Error in auth')).toBe('bugfix');
    expect(detectTaskType('app crash on start')).toBe('bugfix');
    expect(detectTaskType('test fail in CI')).toBe('bugfix');
  });

  it('detects refactor from keywords', () => {
    expect(detectTaskType('refactor auth module')).toBe('refactor');
    expect(detectTaskType('clean up utils')).toBe('refactor');
    expect(detectTaskType('rename variables')).toBe('refactor');
    expect(detectTaskType('reorganize folder structure')).toBe('refactor');
  });

  it('detects feature from keywords', () => {
    expect(detectTaskType('add JWT middleware')).toBe('feature');
    expect(detectTaskType('implement caching')).toBe('feature');
    expect(detectTaskType('create user profile page')).toBe('feature');
    expect(detectTaskType('build dashboard')).toBe('feature');
    expect(detectTaskType('new API endpoint')).toBe('feature');
  });

  it('returns general for unrecognized input', () => {
    expect(detectTaskType('update docs')).toBe('general');
    expect(detectTaskType('review PR #42')).toBe('general');
  });
});
