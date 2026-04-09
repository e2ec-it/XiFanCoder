import { describe, expect, it, vi } from 'vitest';

import {
  assertNoPlaintextSecrets,
  detectPlaintextSecrets,
  resolveAPISecrets,
  sanitizeConfigForSerialization,
} from '../secrets.js';

describe('resolveAPISecrets', () => {
  it('uses process.env when env option is not provided', async () => {
    const resolved = await resolveAPISecrets({});
    expect(resolved.anthropic.source).toBeDefined();
  });

  it('prefers environment variables over keychain values', async () => {
    const keychain = {
      getPassword: vi.fn(async () => 'keychain-secret'),
    };

    const resolved = await resolveAPISecrets({
      env: {
        ANTHROPIC_API_KEY: 'env-secret',
      },
      keychain,
    });

    expect(resolved.anthropic.source).toBe('env');
    expect(resolved.anthropic.value).toBe('env-secret');
    expect(keychain.getPassword).toHaveBeenCalled();
  });

  it('falls back to keychain when env is empty', async () => {
    const keychain = {
      getPassword: vi.fn(async (_service: string, account: string) => {
        if (account === 'openai_api_key') {
          return 'openai-keychain-secret';
        }
        return null;
      }),
    };

    const resolved = await resolveAPISecrets({
      env: {},
      keychain,
    });

    expect(resolved.openai.source).toBe('keychain');
    expect(resolved.openai.value).toBe('openai-keychain-secret');
    expect(resolved.anthropic.source).toBe('none');
  });
});

describe('plaintext secret detection', () => {
  it('detects known secret patterns', () => {
    const findings = detectPlaintextSecrets(
      'apiKey=abc123456789 token=my-super-secret sk-ant-abcdefghijklmnopqrstuvwxyz1234 Authorization: Bearer abcdefghijklmnopqrstuvwx123456',
    );

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.map((finding) => finding.patternId)).toContain('generic_assignment');
    expect(findings.map((finding) => finding.patternId)).toContain('bearer_token');
  });

  it('throws when plaintext secret is present', () => {
    expect(() => assertNoPlaintextSecrets('OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456')).toThrowError();
  });

  it('does not throw when no plaintext secrets are found', () => {
    expect(() => assertNoPlaintextSecrets('just some harmless config text')).not.toThrowError();
  });

  it('handles non-global pattern (break branch in detection loop)', () => {
    // The generic_assignment pattern is non-global internally after cloneWithoutGlobal adds 'g',
    // but the bearer_token pattern already has 'g'. Trigger the break path by
    // using a text with exactly one match for a pattern that would originally be non-global.
    const findings = detectPlaintextSecrets('api_key=mysecretvalue123');
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.patternId === 'generic_assignment')).toBe(true);
  });
});

describe('sanitizeConfigForSerialization', () => {
  it('redacts api key fields and token strings', () => {
    const sanitized = sanitizeConfigForSerialization({
      provider: {
        apiKey: 'abc123',
      },
      nested: {
        tokenValue: 'top-secret-token',
      },
      hint: 'password=hello123',
    });

    expect(sanitized).toEqual({
      provider: {
        apiKey: '****',
      },
      nested: {
        tokenValue: '****',
      },
      hint: '****',
    });
  });
});
