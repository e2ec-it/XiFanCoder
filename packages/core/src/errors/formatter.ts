import type { XiFanError } from './base.js';

/**
 * 将 XiFanError 转换为面向终端用户的友好提示消息。
 * 规范：
 * - 不暴露内部路径、cause 对象、secret 值
 * - 提供可操作的建议（用户下一步如何解决）
 * - 使用中文
 */
export function formatErrorForUser(err: XiFanError): string {
  switch (err.code) {
    // LLM 错误
    case 'E1001':
      return `请求频率超限，将在短暂等待后自动重试。如持续出现，请降低使用频率。`;
    case 'E1002':
      return `API Key 无效或已过期。请检查 XIFAN_ANTHROPIC_API_KEY / XIFAN_OPENAI_API_KEY 等环境变量是否正确设置。`;
    case 'E1003':
      return `对话历史过长，已超出模型上下文窗口。请使用 /compact 压缩历史，或 /session clear 开始新对话。`;
    case 'E1004':
      return `流式响应中断，正在尝试以非流式模式重新请求。`;
    case 'E1005':
      return `已达到工具调用上限（${getCodeExtra(err, 'rounds')} 轮），会话已停止。请开始新的对话或拆分任务。`;
    case 'E1006':
      return `LLM API 网络连接失败。请检查网络连接和 API 服务状态，将自动重试。`;

    // 工具错误
    case 'E2001':
      return `未找到请求的工具，可能是插件未正确安装。使用 /tools 查看可用工具列表。`;
    case 'E2002':
      return `工具执行失败。${getSafeMessage(err)}`;
    case 'E2003':
      return `操作已取消（权限被拒绝）。`;
    case 'E2004':
      return `工具执行超时，操作已中止。`;
    case 'E2005':
      return `编辑冲突：目标文件已发生变化，请重新读取后再尝试修改。`;

    // 配置错误
    case 'E3001':
      return `配置文件格式错误，请检查 .xifan/coder/config.yaml 的语法。使用 xifan-coder init 重新生成默认配置。`;
    case 'E3002':
      return `未找到配置文件。请先在项目目录运行 xifan-coder init 初始化配置。`;

    // 插件错误
    case 'E4001':
      return `插件进程意外退出。使用 /plugin info <name> 查看插件状态。`;
    case 'E4002':
      return `未找到指定插件。使用 /plugin list 查看已安装插件，或重新安装该插件。`;
    case 'E4003':
      return `插件响应超时，操作已中止。如问题持续，请禁用该插件（/plugin disable <name>）。`;

    // 预算错误
    case 'E6001':
      return `费用预算已超出上限。使用 /budget <amount> 调整预算，或 /budget off 关闭限制。`;

    // 未知错误
    default:
      return `发生错误（${err.code}）。如问题持续，请报告至 https://github.com/e2ec-it/XiFanCoder/issues`;
  }
}

/** 安全提取错误消息（不暴露路径和 secret） */
function getSafeMessage(err: XiFanError): string {
  // 仅保留消息中的非路径、非 secret 部分
  const msg = err.message.replace(/\/[a-zA-Z0-9_\-/.]+/g, '<path>');
  return msg.length > 200 ? `${msg.slice(0, 200)}...` : msg;
}

/** 提取错误对象上的附加字段（只读，不暴露给用户） */
function getCodeExtra(err: XiFanError, field: string): unknown {
  return (err as unknown as Record<string, unknown>)[field];
}
