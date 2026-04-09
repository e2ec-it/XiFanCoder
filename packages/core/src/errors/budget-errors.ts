import { XiFanError } from './base.js';

/** E6001 — 费用预算超限 */
export class BudgetExceededError extends XiFanError {
  readonly code = 'E6001';
  readonly recoverable = false;

  constructor(
    readonly budgetType: 'session' | 'daily',
    readonly limitUsd: number,
    readonly currentUsd: number,
    cause?: unknown,
  ) {
    const typeLabel = budgetType === 'session' ? '会话' : '每日';
    super(
      `${typeLabel}费用预算已超限：当前 $${currentUsd.toFixed(4)}，上限 $${limitUsd.toFixed(2)}`,
      cause,
    );
  }
}
