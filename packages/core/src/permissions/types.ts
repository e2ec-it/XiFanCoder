export type ToolPermissionLevel = 'L0' | 'L1' | 'L2' | 'L3';

export type AgentMode = 'build' | 'plan';

export type PolicyMode = 'compat' | 'strict';

export interface ToolPermissionInput {
  readonly toolName: string;
  readonly permissionLevel: ToolPermissionLevel;
}

export interface PermissionPolicyConfig {
  readonly mode: AgentMode;
  readonly headless: boolean;
  readonly dangerouslySkipPermissions?: boolean;
  readonly allowWrite?: boolean;
  readonly allowShell?: boolean;
  readonly allowDangerous?: boolean;
  readonly policyMode?: PolicyMode;
  readonly allowedTools?: readonly string[];
  readonly deniedTools?: readonly string[];
}

export type PermissionDecisionReason =
  | 'allowed'
  | 'requires_approval'
  | 'denied_by_mode'
  | 'denied_by_denylist'
  | 'denied_by_allowlist'
  | 'denied_by_headless_policy';

export interface PermissionDecision {
  readonly allowed: boolean;
  readonly requiresApproval: boolean;
  readonly reason: PermissionDecisionReason;
  readonly policySource: 'mode' | 'denylist' | 'allowlist' | 'headless' | 'level';
}
