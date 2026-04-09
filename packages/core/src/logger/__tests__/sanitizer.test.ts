import { describe, expect, it } from 'vitest';

import { sanitizeLogValue } from '../sanitizer.js';

describe('sanitizeLogValue', () => {
  it('masks secret-like key names in objects', () => {
    const sanitized = sanitizeLogValue({
      apiKey: 'abc123',
      nested: {
        tokenValue: 'xyz',
      },
      plain: 'safe',
    });

    expect(sanitized).toEqual({
      apiKey: '****',
      nested: {
        tokenValue: '****',
      },
      plain: 'safe',
    });
  });

  it('masks secret patterns in strings', () => {
    const sanitized = sanitizeLogValue(
      'Authorization: Bearer token123456 and api_key=my-key-123 and sk-abcdefghijk123456',
    );

    expect(sanitized).not.toContain('token123456');
    expect(sanitized).not.toContain('my-key-123');
    expect(sanitized).not.toContain('sk-abcdefghijk123456');
    expect(sanitized).toContain('****');
  });
});
