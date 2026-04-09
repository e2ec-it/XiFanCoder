import { ConfigValidationError } from '../errors/config-errors.js';
import { sanitizeLogValue } from '../logger/sanitizer.js';

export interface KeychainAdapter {
  getPassword(service: string, account: string): Promise<string | null>;
}

export type SecretSource = 'env' | 'keychain' | 'none';

export interface ResolvedSecret {
  readonly value?: string;
  readonly source: SecretSource;
}

export interface ResolvedAPISecrets {
  readonly anthropic: ResolvedSecret;
  readonly openai: ResolvedSecret;
  readonly litellm: ResolvedSecret;
}

export interface ResolveSecretsOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly keychain?: KeychainAdapter;
  readonly serviceName?: string;
}

export interface SecretLeakFinding {
  readonly patternId: string;
  readonly matchedText: string;
}

const SECRET_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'anthropic_key', pattern: /\bsk-ant-[a-zA-Z0-9_-]{16,}\b/g },
  { id: 'openai_key', pattern: /\bsk-[a-zA-Z0-9]{20,}\b/g },
  { id: 'bearer_token', pattern: /\bbearer\s+[a-zA-Z0-9._-]{16,}\b/gi },
  {
    id: 'generic_assignment',
    pattern: /\b(api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^\s"']{8,}/gi,
  },
];

export async function resolveAPISecrets(options: ResolveSecretsOptions = {}): Promise<ResolvedAPISecrets> {
  const env = options.env ?? process.env;
  const serviceName = options.serviceName ?? 'xifan';

  return {
    anthropic: await resolveSingleSecret({
      env,
      keychain: options.keychain,
      envName: 'ANTHROPIC_API_KEY',
      account: 'anthropic_api_key',
      serviceName,
    }),
    openai: await resolveSingleSecret({
      env,
      keychain: options.keychain,
      envName: 'OPENAI_API_KEY',
      account: 'openai_api_key',
      serviceName,
    }),
    litellm: await resolveSingleSecret({
      env,
      keychain: options.keychain,
      envName: 'LITELLM_API_KEY',
      account: 'litellm_api_key',
      serviceName,
    }),
  };
}

export function detectPlaintextSecrets(rawConfigText: string): readonly SecretLeakFinding[] {
  const findings: SecretLeakFinding[] = [];
  for (const candidate of SECRET_PATTERNS) {
    const pattern = cloneWithoutGlobal(candidate.pattern);
    let match = pattern.exec(rawConfigText);
    while (match?.[0]) {
      findings.push({
        patternId: candidate.id,
        matchedText: match[0],
      });
      /* v8 ignore next 3 -- cloneWithoutGlobal always adds 'g', so pattern.global is always true */
      if (!pattern.global) {
        break;
      }
      match = pattern.exec(rawConfigText);
    }
  }
  return findings;
}

export function assertNoPlaintextSecrets(rawConfigText: string): void {
  const findings = detectPlaintextSecrets(rawConfigText);
  if (findings.length === 0) {
    return;
  }

  throw new ConfigValidationError(
    findings.map((finding) => ({
      patternId: finding.patternId,
      matchedText: '****',
    })),
  );
}

export function sanitizeConfigForSerialization<T>(input: T): T {
  return sanitizeLogValue(input);
}

async function resolveSingleSecret(options: {
  env: NodeJS.ProcessEnv;
  keychain?: KeychainAdapter;
  envName: string;
  account: string;
  serviceName: string;
}): Promise<ResolvedSecret> {
  const fromEnv = options.env[options.envName];
  if (fromEnv && fromEnv.trim().length > 0) {
    return {
      value: fromEnv,
      source: 'env',
    };
  }

  if (options.keychain) {
    const value = await options.keychain.getPassword(options.serviceName, options.account);
    if (value && value.trim().length > 0) {
      return {
        value,
        source: 'keychain',
      };
    }
  }

  return {
    source: 'none',
  };
}

function cloneWithoutGlobal(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}
