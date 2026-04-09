import { XiFanError } from './base.js';

/** E2001 — 工具不存在 */
export class ToolNotFoundError extends XiFanError {
  readonly code = 'E2001';
  readonly recoverable = true;

  constructor(
    readonly toolName: string,
    cause?: unknown,
  ) {
    super(`工具 "${toolName}" 不存在或未注册`, cause);
  }
}

/** E2002 — 工具执行失败 */
export class ToolExecutionError extends XiFanError {
  readonly code = 'E2002';
  readonly recoverable = true;

  constructor(
    readonly toolName: string,
    message: string,
    cause?: unknown,
  ) {
    super(`工具 "${toolName}" 执行失败：${message}`, cause);
  }
}

/** E2003 — 工具权限被拒绝（用户拒绝确认或权限不足） */
export class ToolPermissionDeniedError extends XiFanError {
  readonly code = 'E2003';
  readonly recoverable = true;

  constructor(
    readonly toolName: string,
    message?: string,
    cause?: unknown,
  ) {
    super(
      message ?? `工具 "${toolName}" 权限被拒绝`,
      cause,
    );
  }
}

/** E2004 — 工具执行超时 */
export class ToolTimeoutError extends XiFanError {
  readonly code = 'E2004';
  readonly recoverable = true;

  constructor(
    readonly toolName: string,
    readonly timeoutMs: number,
    cause?: unknown,
  ) {
    super(`工具 "${toolName}" 执行超时（${timeoutMs}ms）`, cause);
  }
}

/** E2005 — 基于锚点的编辑冲突（文件内容已变化） */
export class EditConflictError extends XiFanError {
  readonly code = 'E2005';
  readonly recoverable = true;

  constructor(
    readonly path: string,
    readonly expectedHash: string,
    readonly actualHash: string,
    cause?: unknown,
  ) {
    super(
      `文件 "${path}" 内容与预期不一致，编辑被拒绝（expected=${expectedHash}, actual=${actualHash}）`,
      cause,
    );
  }
}
