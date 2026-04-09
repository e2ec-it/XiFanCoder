export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

export interface TaskItem {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly updatedAt: Date;
  readonly lastReason?: string;
}

export interface ContinueGuardInput {
  readonly currentRound: number;
  readonly maxRounds: number;
  readonly budgetExceeded?: boolean;
}

export interface ContinueGuardResult {
  readonly shouldContinue: boolean;
  readonly reason?: 'unfinished_tasks' | 'max_rounds_reached' | 'budget_exceeded';
  readonly unfinishedTaskIds: readonly string[];
}

function now(): Date {
  return new Date();
}

export class TaskStateMachine {
  private readonly tasks = new Map<string, TaskItem>();

  upsertPending(id: string, title: string): TaskItem {
    const existing = this.tasks.get(id);
    const next: TaskItem = {
      id,
      title,
      status: existing?.status === 'done' ? 'done' : 'pending',
      updatedAt: now(),
      lastReason: existing?.lastReason,
    };
    this.tasks.set(id, next);
    return next;
  }

  markInProgress(id: string): TaskItem {
    return this.updateStatus(id, 'in_progress');
  }

  markDone(id: string): TaskItem {
    return this.updateStatus(id, 'done');
  }

  markBlocked(id: string, reason: string): TaskItem {
    const existing = this.getOrThrow(id);
    const next: TaskItem = {
      ...existing,
      status: 'blocked',
      lastReason: reason,
      updatedAt: now(),
    };
    this.tasks.set(id, next);
    return next;
  }

  list(): readonly TaskItem[] {
    return [...this.tasks.values()].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
  }

  unfinishedTasks(): readonly TaskItem[] {
    return this.list().filter((task) => task.status === 'pending' || task.status === 'in_progress');
  }

  evaluateContinuation(input: ContinueGuardInput): ContinueGuardResult {
    const unfinished = this.unfinishedTasks();

    if (input.budgetExceeded) {
      return {
        shouldContinue: false,
        reason: 'budget_exceeded',
        unfinishedTaskIds: unfinished.map((task) => task.id),
      };
    }

    if (input.currentRound >= input.maxRounds) {
      return {
        shouldContinue: false,
        reason: 'max_rounds_reached',
        unfinishedTaskIds: unfinished.map((task) => task.id),
      };
    }

    if (unfinished.length > 0) {
      return {
        shouldContinue: true,
        reason: 'unfinished_tasks',
        unfinishedTaskIds: unfinished.map((task) => task.id),
      };
    }

    return {
      shouldContinue: false,
      unfinishedTaskIds: [],
    };
  }

  private updateStatus(id: string, status: TaskStatus): TaskItem {
    const existing = this.getOrThrow(id);
    const next: TaskItem = {
      ...existing,
      status,
      updatedAt: now(),
    };
    this.tasks.set(id, next);
    return next;
  }

  private getOrThrow(id: string): TaskItem {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    return task;
  }
}
