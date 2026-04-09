import { describe, expect, it } from 'vitest';

import { TaskStateMachine } from '../task-state.js';

describe('TaskStateMachine', () => {
  it('tracks pending -> in_progress -> done transitions', () => {
    const machine = new TaskStateMachine();

    machine.upsertPending('t1', 'implement feature');
    machine.markInProgress('t1');
    machine.markDone('t1');

    const tasks = machine.list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe('done');
  });

  it('marks blocked with reason', () => {
    const machine = new TaskStateMachine();

    machine.upsertPending('t1', 'need external dependency');
    const blocked = machine.markBlocked('t1', 'waiting for API key');

    expect(blocked.status).toBe('blocked');
    expect(blocked.lastReason).toBe('waiting for API key');
  });

  it('requests continuation when unfinished tasks remain', () => {
    const machine = new TaskStateMachine();

    machine.upsertPending('t1', 'step 1');
    machine.markInProgress('t1');

    const decision = machine.evaluateContinuation({
      currentRound: 2,
      maxRounds: 10,
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.reason).toBe('unfinished_tasks');
    expect(decision.unfinishedTaskIds).toEqual(['t1']);
  });

  it('stops continuation when max rounds reached', () => {
    const machine = new TaskStateMachine();

    machine.upsertPending('t1', 'step 1');

    const decision = machine.evaluateContinuation({
      currentRound: 10,
      maxRounds: 10,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe('max_rounds_reached');
  });

  it('stops continuation when budget exceeded', () => {
    const machine = new TaskStateMachine();

    machine.upsertPending('t1', 'step 1');

    const decision = machine.evaluateContinuation({
      currentRound: 1,
      maxRounds: 10,
      budgetExceeded: true,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe('budget_exceeded');
  });

  it('returns no continuation when all tasks done or blocked', () => {
    const machine = new TaskStateMachine();

    machine.upsertPending('t1', 'step 1');
    machine.markDone('t1');

    machine.upsertPending('t2', 'step 2');
    machine.markBlocked('t2', 'external blocked');

    const decision = machine.evaluateContinuation({
      currentRound: 1,
      maxRounds: 10,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBeUndefined();
    expect(decision.unfinishedTaskIds).toEqual([]);
  });

  it('throws when updating a non-existent task', () => {
    const machine = new TaskStateMachine();
    expect(() => machine.markInProgress('nonexistent')).toThrowError('Task not found: nonexistent');
  });

  it('preserves done status and lastReason on upsertPending for already-done task', () => {
    const machine = new TaskStateMachine();

    machine.upsertPending('t1', 'original');
    machine.markBlocked('t1', 'some reason');
    machine.markDone('t1');

    const reinserted = machine.upsertPending('t1', 'original updated');
    expect(reinserted.status).toBe('done');
    expect(reinserted.lastReason).toBe('some reason');
  });
});
