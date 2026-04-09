import { XiFanError } from './base.js';

/** E3001 — 配置验证失败（zod 解析错误） */
export class ConfigValidationError extends XiFanError {
  readonly code = 'E3001';
  readonly recoverable = false;

  constructor(
    readonly validationErrors: unknown,
    cause?: unknown,
  ) {
    const detail =
      typeof validationErrors === 'string'
        ? validationErrors
        : JSON.stringify(validationErrors);
    super(`配置验证失败：${detail}`, cause);
  }
}

/** E3002 — 配置文件不存在 */
export class ConfigNotFoundError extends XiFanError {
  readonly code = 'E3002';
  readonly recoverable = false;

  constructor(
    readonly configPath: string,
    cause?: unknown,
  ) {
    super(`配置文件不存在：${configPath}，请先运行 xifan init`, cause);
  }
}
