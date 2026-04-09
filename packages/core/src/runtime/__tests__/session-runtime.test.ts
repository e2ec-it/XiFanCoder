import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SessionRuntime } from '../session-runtime.js';

describe('SessionRuntime', () => {
  it('uses build mode by default', () => {
    const runtime = new SessionRuntime();
    expect(runtime.getMode()).toBe('build');
  });

  it('plan mode denies non-L0 tool', () => {
    const runtime = new SessionRuntime({ mode: 'plan' });

    const decision = runtime.checkToolPermission({
      toolName: 'write_file',
      permissionLevel: 'L1',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('denied_by_mode');
  });

  it('strict allowlist denies unlisted tool', () => {
    const runtime = new SessionRuntime({
      policyMode: 'strict',
      allowedTools: ['read_file'],
    });

    const decision = runtime.checkToolPermission({
      toolName: 'bash_execute',
      permissionLevel: 'L2',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('denied_by_allowlist');
  });

  it('tracks task lifecycle and continuation', () => {
    const runtime = new SessionRuntime({ maxRounds: 10 });

    runtime.addTask('t1', 'Implement feature X');
    runtime.startTask('t1');

    const c1 = runtime.evaluateContinuation({ currentRound: 1 });
    expect(c1.shouldContinue).toBe(true);
    expect(c1.reason).toBe('unfinished_tasks');

    runtime.completeTask('t1');

    const c2 = runtime.evaluateContinuation({ currentRound: 2 });
    expect(c2.shouldContinue).toBe(false);
  });

  it('stops continuation when round limit reached', () => {
    const runtime = new SessionRuntime({ maxRounds: 2 });
    runtime.addTask('t1', 'Task');

    const decision = runtime.evaluateContinuation({ currentRound: 2 });
    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe('max_rounds_reached');
  });

  it('headless defaults to deny L1 and can be explicitly allowed', () => {
    const runtimeDefault = new SessionRuntime({ headless: true });
    const denied = runtimeDefault.checkToolPermission({
      toolName: 'write_file',
      permissionLevel: 'L1',
    });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('denied_by_headless_policy');

    const runtimeAllowed = new SessionRuntime({ headless: true, allowWrite: true });
    const allowed = runtimeAllowed.checkToolPermission({
      toolName: 'write_file',
      permissionLevel: 'L1',
    });
    expect(allowed.allowed).toBe(true);
  });

  it('records permission events and writes denied_by_mode log entries', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-runtime-log-'));
    const logPath = path.join(root, 'permission-events.log');
    const runtime = new SessionRuntime({
      mode: 'plan',
      permissionLogPath: logPath,
    });

    const decision = runtime.checkToolPermission({
      toolName: 'write_file',
      permissionLevel: 'L1',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('denied_by_mode');

    const events = runtime.getPermissionEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toBe('denied_by_mode');
    expect(events[0]?.mode).toBe('plan');

    const raw = fs.readFileSync(logPath, 'utf8');
    expect(raw).toContain('"reason":"denied_by_mode"');
    expect(raw).toContain('"toolName":"write_file"');
  });

  it('switches mode via setMode', () => {
    const runtime = new SessionRuntime({ mode: 'build' });
    expect(runtime.getMode()).toBe('build');

    runtime.setMode('plan');
    expect(runtime.getMode()).toBe('plan');
  });

  it('blocks a task and excludes it from continuation', () => {
    const runtime = new SessionRuntime({ maxRounds: 10 });

    runtime.addTask('t1', 'Task 1');
    runtime.blockTask('t1', 'dependency missing');

    const decision = runtime.evaluateContinuation({ currentRound: 1 });
    expect(decision.shouldContinue).toBe(false);
    expect(decision.unfinishedTaskIds).toEqual([]);
  });

  it('supports dangerously skip permissions override', () => {
    const runtime = new SessionRuntime({
      mode: 'plan',
      headless: true,
      dangerouslySkipPermissions: true,
    });

    const decision = runtime.checkToolPermission({
      toolName: 'bash_execute',
      permissionLevel: 'L2',
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
  });
});
