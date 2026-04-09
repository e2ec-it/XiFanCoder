const DANGEROUS_COMMAND_PATTERNS: readonly RegExp[] = [
  /\brm\s+-rf\s+\/(\s|$)/i,
  /\bdd\s+if=\/dev\/zero\b/i,
  /\bmkfs(\.[a-z0-9]+)?\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

const SHELL_SOURCE_COMMANDS: readonly string[] = ['curl', 'wget', 'base64', 'python'];
const SHELL_TARGET_COMMANDS: readonly string[] = ['bash', 'sh'];

const SAFE_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TERM',
  'SHELL',
  'PWD',
  'USER',
];

export interface CommandSafetyDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface SandboxLimits {
  readonly memoryLimitMb: number;
  readonly cpuTimeSec: number;
}

export function checkCommandSafety(command: string): CommandSafetyDecision {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { allowed: false, reason: 'empty_command' };
  }

  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: 'dangerous_command' };
    }
  }

  if (hasCommandSubstitution(trimmed) || hasPipeToShellPattern(trimmed)) {
    return { allowed: false, reason: 'injection_pattern' };
  }

  return { allowed: true };
}

function hasCommandSubstitution(command: string): boolean {
  return command.includes('$(') || command.includes('`');
}

function hasPipeToShellPattern(command: string): boolean {
  const lower = command.toLowerCase();
  const hasSource = SHELL_SOURCE_COMMANDS.some((value) => hasWholeWord(lower, value));
  if (!hasSource) {
    return false;
  }
  const hasTarget = SHELL_TARGET_COMMANDS.some((value) => hasWholeWord(lower, value));
  if (!hasTarget) {
    return false;
  }
  return lower.includes('|') || lower.includes(';') || lower.includes('&&');
}

function hasWholeWord(content: string, token: string): boolean {
  let cursor = content.indexOf(token);
  while (cursor !== -1) {
    const before = cursor === 0 ? '' : content[cursor - 1] ?? '';
    const after = content[cursor + token.length] ?? '';
    if (!isWordChar(before) && !isWordChar(after)) {
      return true;
    }
    cursor = content.indexOf(token, cursor + token.length);
  }
  return false;
}

function isWordChar(value: string): boolean {
  const code = value.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

export function sanitizeCommandEnv(
  baseEnv: NodeJS.ProcessEnv,
  extraEnv: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_ALLOWLIST) {
    if (baseEnv[key] !== undefined) {
      sanitized[key] = baseEnv[key];
    }
  }

  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function buildSandboxedCommand(
  command: string,
  limits: SandboxLimits,
): string {
  const memoryKb = Math.max(1, Math.floor(limits.memoryLimitMb * 1024));
  const cpuSec = Math.max(1, Math.floor(limits.cpuTimeSec));
  return [
    `ulimit -Sv ${memoryKb} >/dev/null 2>&1 || ulimit -v ${memoryKb} >/dev/null 2>&1 || true`,
    `ulimit -St ${cpuSec} >/dev/null 2>&1 || ulimit -t ${cpuSec} >/dev/null 2>&1 || true`,
    command,
  ].join('; ');
}
