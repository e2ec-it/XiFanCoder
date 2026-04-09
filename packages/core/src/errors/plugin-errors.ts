import { XiFanError } from './base.js';

/** E4001 — 插件子进程崩溃 */
export class PluginCrashError extends XiFanError {
  readonly code = 'E4001';
  readonly recoverable = true;

  constructor(
    readonly pluginName: string,
    readonly exitCode: number | null,
    cause?: unknown,
  ) {
    const codeStr = exitCode !== null ? `退出码 ${exitCode}` : '信号终止';
    super(`插件 "${pluginName}" 崩溃（${codeStr}）`, cause);
  }
}

/** E4002 — 插件不存在或未安装 */
export class PluginNotFoundError extends XiFanError {
  readonly code = 'E4002';
  readonly recoverable = false;

  constructor(
    readonly pluginName: string,
    cause?: unknown,
  ) {
    super(`插件 "${pluginName}" 不存在，请先安装`, cause);
  }
}

/** E4003 — 插件工具调用超时 */
export class PluginTimeoutError extends XiFanError {
  readonly code = 'E4003';
  readonly recoverable = true;

  constructor(
    readonly pluginName: string,
    readonly timeoutMs: number,
    cause?: unknown,
  ) {
    super(`插件 "${pluginName}" 响应超时（${timeoutMs}ms）`, cause);
  }
}
