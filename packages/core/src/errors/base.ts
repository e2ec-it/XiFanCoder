/**
 * XiFanError — 所有自定义错误的抽象基类
 *
 * 注意：Node.js 继承 Error 必须手动修复原型链，
 * 否则 `instanceof XiFanError` 检查会失败。
 */
export abstract class XiFanError extends Error {
  abstract readonly code: string;
  abstract readonly recoverable: boolean;

  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    // 修复 Node.js 中 Error 子类的原型链
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
