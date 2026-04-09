import fs from 'node:fs';
import path from 'node:path';

import {
  TaskStateMachine,
  type ContinueGuardResult,
} from '../agent/index.js';
import {
  evaluateToolPermission,
  type AgentMode,
  type PermissionDecision,
  type PolicyMode,
  type ToolPermissionInput,
} from '../permissions/index.js';

export interface SessionRuntimeOptions {
  readonly mode?: AgentMode;
  readonly headless?: boolean;
  readonly dangerouslySkipPermissions?: boolean;
  readonly allowWrite?: boolean;
  readonly allowShell?: boolean;
  readonly allowDangerous?: boolean;
  readonly policyMode?: PolicyMode;
  readonly allowedTools?: readonly string[];
  readonly deniedTools?: readonly string[];
  readonly maxRounds?: number;
  readonly permissionLogPath?: string;
}

export interface ContinuationInput {
  readonly currentRound: number;
  readonly budgetExceeded?: boolean;
}

export interface ToolPermissionEvent {
  readonly timestamp: string;
  readonly mode: AgentMode;
  readonly toolName: string;
  readonly permissionLevel: ToolPermissionInput['permissionLevel'];
  readonly allowed: boolean;
  readonly requiresApproval: boolean;
  readonly reason: string;
  readonly policySource: string;
}

function appendPermissionLog(logPath: string, event: ToolPermissionEvent): void {
  const dir = path.dirname(logPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(event) + '\n', 'utf8');
}

export class SessionRuntime {
  private mode: AgentMode;
  private readonly maxRounds: number;
  private readonly taskState = new TaskStateMachine();
  private readonly options: SessionRuntimeOptions;
  private readonly permissionEvents: ToolPermissionEvent[] = [];

  constructor(options: SessionRuntimeOptions = {}) {
    this.options = options;
    this.mode = options.mode ?? 'build';
    this.maxRounds = options.maxRounds ?? 50;
  }

  getMode(): AgentMode {
    return this.mode;
  }

  setMode(mode: AgentMode): void {
    this.mode = mode;
  }

  checkToolPermission(input: ToolPermissionInput): PermissionDecision {
    const decision = evaluateToolPermission(input, {
      mode: this.mode,
      headless: this.options.headless ?? false,
      dangerouslySkipPermissions: this.options.dangerouslySkipPermissions,
      allowWrite: this.options.allowWrite,
      allowShell: this.options.allowShell,
      allowDangerous: this.options.allowDangerous,
      policyMode: this.options.policyMode,
      allowedTools: this.options.allowedTools,
      deniedTools: this.options.deniedTools,
    });

    const event: ToolPermissionEvent = {
      timestamp: new Date().toISOString(),
      mode: this.mode,
      toolName: input.toolName,
      permissionLevel: input.permissionLevel,
      allowed: decision.allowed,
      requiresApproval: decision.requiresApproval,
      reason: decision.reason,
      policySource: decision.policySource,
    };
    this.permissionEvents.push(event);

    if (this.options.permissionLogPath) {
      appendPermissionLog(this.options.permissionLogPath, event);
    }

    return decision;
  }

  getPermissionEvents(): readonly ToolPermissionEvent[] {
    return [...this.permissionEvents];
  }

  addTask(id: string, title: string): void {
    this.taskState.upsertPending(id, title);
  }

  startTask(id: string): void {
    this.taskState.markInProgress(id);
  }

  completeTask(id: string): void {
    this.taskState.markDone(id);
  }

  blockTask(id: string, reason: string): void {
    this.taskState.markBlocked(id, reason);
  }

  evaluateContinuation(input: ContinuationInput): ContinueGuardResult {
    return this.taskState.evaluateContinuation({
      currentRound: input.currentRound,
      maxRounds: this.maxRounds,
      budgetExceeded: input.budgetExceeded,
    });
  }
}
