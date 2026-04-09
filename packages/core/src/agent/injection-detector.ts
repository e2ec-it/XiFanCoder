export type InjectionDetectionMode = 'off' | 'warn' | 'block';
export type InjectionSource = 'user_input' | 'tool_result';
export type InjectionSeverity = 'low' | 'medium' | 'high';

export interface InjectionRule {
  readonly id: string;
  readonly description: string;
  readonly severity: InjectionSeverity;
  readonly pattern: RegExp;
  readonly appliesTo?: readonly InjectionSource[];
}

export interface InjectionFinding {
  readonly ruleId: string;
  readonly description: string;
  readonly severity: InjectionSeverity;
  readonly matchedText: string;
}

export interface DetectInjectionOptions {
  readonly mode?: InjectionDetectionMode;
  readonly source?: InjectionSource;
  readonly rules?: readonly InjectionRule[];
}

export interface InjectionDetectionResult {
  readonly mode: InjectionDetectionMode;
  readonly source: InjectionSource;
  readonly flagged: boolean;
  readonly blocked: boolean;
  readonly findings: readonly InjectionFinding[];
}

const DEFAULT_RULES: readonly InjectionRule[] = [
  {
    id: 'override.instructions.ignore_previous',
    description: 'attempts to override previous instructions',
    severity: 'high',
    pattern: /\b(ignore|disregard)\b.{0,40}\b(previous|above)\b.{0,40}\binstructions?\b/i,
  },
  {
    id: 'role.hijack.system_override',
    description: 'attempts to force system/developer role switch',
    severity: 'high',
    pattern: /\b(you are now|act as)\b.{0,30}\b(system|developer)\b/i,
  },
  {
    id: 'policy.bypass.request',
    description: 'asks to bypass safety, policy, or guardrails',
    severity: 'medium',
    pattern: /\b(bypass|disable|override)\b.{0,40}\b(safety|policy|guardrails?)\b/i,
  },
  {
    id: 'structured.role_token',
    description: 'contains structured role-switch tokens',
    severity: 'medium',
    pattern: /(<\s*system\s*>|role\s*:\s*system|BEGIN_SYSTEM_PROMPT)/i,
  },
];

export function detectPromptInjection(
  content: string,
  options: DetectInjectionOptions = {},
): InjectionDetectionResult {
  const mode = options.mode ?? 'warn';
  const source = options.source ?? 'user_input';
  if (mode === 'off') {
    return {
      mode,
      source,
      flagged: false,
      blocked: false,
      findings: [],
    };
  }

  const findings = detectFindings(content, source, options.rules ?? DEFAULT_RULES);
  return {
    mode,
    source,
    flagged: findings.length > 0,
    blocked: mode === 'block' && findings.length > 0,
    findings,
  };
}

export function sanitizeBlockedContent(
  result: InjectionDetectionResult,
  fallback: string,
): string {
  if (!result.blocked) {
    return fallback;
  }
  const ruleIds = result.findings.map((finding) => finding.ruleId).join(',');
  return `[blocked_prompt_injection source=${result.source} rules=${ruleIds}]`;
}

export function defaultInjectionRules(): readonly InjectionRule[] {
  return DEFAULT_RULES;
}

function detectFindings(
  content: string,
  source: InjectionSource,
  rules: readonly InjectionRule[],
): readonly InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const rule of rules) {
    if (rule.appliesTo && !rule.appliesTo.includes(source)) {
      continue;
    }
    const pattern = nonGlobal(rule.pattern);
    const match = pattern.exec(content);
    if (!match?.[0]) {
      continue;
    }
    findings.push({
      ruleId: rule.id,
      description: rule.description,
      severity: rule.severity,
      matchedText: match[0],
    });
  }
  return findings;
}

function nonGlobal(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace(/g/g, ''));
}
