import { ToolPermissionDeniedError } from '../errors/tool-errors.js';
import type {
  PermissionDecision,
  PermissionPolicyConfig,
  ToolPermissionInput,
  ToolPermissionLevel,
} from './types.js';

const LEVEL_WEIGHT: Record<ToolPermissionLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
};

function includesTool(list: readonly string[] | undefined, toolName: string): boolean {
  return Boolean(list?.includes(toolName));
}

export const BUILTIN_TOOL_PERMISSION_MAP: Record<string, ToolPermissionLevel> = {
  read_file: 'L0',
  list_dir: 'L0',
  write_file: 'L1',
  bash_execute: 'L2',
  web_fetch: 'L3',
};

export function resolveBuiltinToolPermissionLevel(toolName: string): ToolPermissionLevel {
  return BUILTIN_TOOL_PERMISSION_MAP[toolName] ?? 'L2';
}

export function evaluateToolPermission(
  input: ToolPermissionInput,
  config: PermissionPolicyConfig,
): PermissionDecision {
  if (config.dangerouslySkipPermissions) {
    return {
      allowed: true,
      requiresApproval: false,
      reason: 'allowed',
      policySource: 'level',
    };
  }

  const policyMode = config.policyMode ?? 'compat';

  if (includesTool(config.deniedTools, input.toolName)) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: 'denied_by_denylist',
      policySource: 'denylist',
    };
  }

  if (
    policyMode === 'strict' &&
    (config.allowedTools?.length ?? 0) > 0 &&
    !includesTool(config.allowedTools, input.toolName)
  ) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: 'denied_by_allowlist',
      policySource: 'allowlist',
    };
  }

  if (config.mode === 'plan' && input.permissionLevel !== 'L0') {
    return {
      allowed: false,
      requiresApproval: false,
      reason: 'denied_by_mode',
      policySource: 'mode',
    };
  }

  if (config.headless) {
    if (input.permissionLevel === 'L0') {
      return {
        allowed: true,
        requiresApproval: false,
        reason: 'allowed',
        policySource: 'level',
      };
    }

    if (input.permissionLevel === 'L1' && config.allowWrite) {
      return {
        allowed: true,
        requiresApproval: false,
        reason: 'allowed',
        policySource: 'headless',
      };
    }

    if (input.permissionLevel === 'L2' && config.allowShell) {
      return {
        allowed: true,
        requiresApproval: false,
        reason: 'allowed',
        policySource: 'headless',
      };
    }

    if (input.permissionLevel === 'L3' && config.allowDangerous) {
      return {
        allowed: true,
        requiresApproval: false,
        reason: 'allowed',
        policySource: 'headless',
      };
    }

    return {
      allowed: false,
      requiresApproval: false,
      reason: 'denied_by_headless_policy',
      policySource: 'headless',
    };
  }

  if (LEVEL_WEIGHT[input.permissionLevel] === 0) {
    return {
      allowed: true,
      requiresApproval: false,
      reason: 'allowed',
      policySource: 'level',
    };
  }

  return {
    allowed: true,
    requiresApproval: true,
    reason: 'requires_approval',
    policySource: 'level',
  };
}

export function assertToolPermission(
  input: ToolPermissionInput,
  config: PermissionPolicyConfig,
): PermissionDecision {
  const decision = evaluateToolPermission(input, config);
  if (decision.allowed) {
    return decision;
  }

  let reason: string;
  switch (decision.reason) {
    case 'denied_by_mode':
      reason = `工具 "${input.toolName}" 在 plan 模式下不可用`;
      break;
    case 'denied_by_denylist':
      reason = `工具 "${input.toolName}" 被 deniedTools 策略禁用`;
      break;
    case 'denied_by_allowlist':
      reason = `工具 "${input.toolName}" 不在 allowedTools 白名单中`;
      break;
    case 'denied_by_headless_policy':
      reason = `headless 默认拒绝 ${input.permissionLevel} 权限工具，请显式放行`;
      break;
    /* v8 ignore next 3 -- exhaustive switch: all ToolPermissionLevel values covered */
    default:
      reason = `工具 "${input.toolName}" 权限被拒绝`;
      break;
  }

  throw new ToolPermissionDeniedError(input.toolName, reason);
}
