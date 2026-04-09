import { describe, expect, it } from 'vitest';

import type { XiFanError } from '../base.js';
import { formatErrorForUser } from '../formatter.js';

function makeError(code: string, message = 'test error', extra?: Record<string, unknown>): XiFanError {
  return {
    code,
    message,
    recoverable: false,
    name: 'TestError',
    ...extra,
  } as unknown as XiFanError;
}

describe('formatErrorForUser', () => {
  it('formats E1001 rate limit', () => {
    expect(formatErrorForUser(makeError('E1001'))).toContain('频率超限');
  });

  it('formats E1002 auth error', () => {
    expect(formatErrorForUser(makeError('E1002'))).toContain('API Key');
  });

  it('formats E1003 context limit', () => {
    expect(formatErrorForUser(makeError('E1003'))).toContain('/compact');
  });

  it('formats E1004 stream error', () => {
    expect(formatErrorForUser(makeError('E1004'))).toContain('非流式');
  });

  it('formats E1005 max rounds with extra field', () => {
    const msg = formatErrorForUser(makeError('E1005', 'test', { rounds: 50 }));
    expect(msg).toContain('50');
    expect(msg).toContain('工具调用上限');
  });

  it('formats E1006 network error', () => {
    expect(formatErrorForUser(makeError('E1006'))).toContain('网络连接');
  });

  it('formats E2001 tool not found', () => {
    expect(formatErrorForUser(makeError('E2001'))).toContain('未找到');
  });

  it('formats E2002 tool execution with safe message (path redacted)', () => {
    const msg = formatErrorForUser(makeError('E2002', 'failed at /usr/local/bin/tool'));
    expect(msg).toContain('工具执行失败');
    expect(msg).toContain('<path>');
  });

  it('formats E2002 with very long message (truncated)', () => {
    const long = 'x'.repeat(300);
    const msg = formatErrorForUser(makeError('E2002', long));
    expect(msg).toContain('...');
  });

  it('formats E2003 permission denied', () => {
    expect(formatErrorForUser(makeError('E2003'))).toContain('已取消');
  });

  it('formats E2004 tool timeout', () => {
    expect(formatErrorForUser(makeError('E2004'))).toContain('超时');
  });

  it('formats E2005 edit conflict', () => {
    expect(formatErrorForUser(makeError('E2005'))).toContain('编辑冲突');
  });

  it('formats E3001 config validation', () => {
    expect(formatErrorForUser(makeError('E3001'))).toContain('配置文件');
  });

  it('formats E3002 config not found', () => {
    expect(formatErrorForUser(makeError('E3002'))).toContain('未找到配置');
  });

  it('formats E4001 plugin crash', () => {
    expect(formatErrorForUser(makeError('E4001'))).toContain('插件进程');
  });

  it('formats E4002 plugin not found', () => {
    expect(formatErrorForUser(makeError('E4002'))).toContain('未找到指定插件');
  });

  it('formats E4003 plugin timeout', () => {
    expect(formatErrorForUser(makeError('E4003'))).toContain('响应超时');
  });

  it('formats E6001 budget exceeded', () => {
    expect(formatErrorForUser(makeError('E6001'))).toContain('预算');
  });

  it('formats unknown error codes with fallback', () => {
    const msg = formatErrorForUser(makeError('E9999'));
    expect(msg).toContain('E9999');
    expect(msg).toContain('issues');
  });
});
