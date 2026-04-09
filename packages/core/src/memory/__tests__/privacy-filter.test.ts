import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PRIVATE_REPLACEMENT,
  sanitizeMemoryContent,
  stripPrivateBlocks,
} from '../privacy-filter.js';

describe('memory privacy filter', () => {
  it('redacts private blocks before memory persistence', () => {
    const output = stripPrivateBlocks('my key is <private>sk-12345</private> for this task');
    expect(output).toBe(`my key is ${DEFAULT_PRIVATE_REPLACEMENT} for this task`);
  });

  it('supports multiline private blocks and case-insensitive tags', () => {
    const output = stripPrivateBlocks([
      'line-1',
      '<PRIVATE reason="secret">',
      'token=abcd',
      '</PRIVATE>',
      'line-2',
    ].join('\n'));

    expect(output).toBe([
      'line-1',
      DEFAULT_PRIVATE_REPLACEMENT,
      'line-2',
    ].join('\n'));
  });

  it('returns empty string for empty input', () => {
    expect(stripPrivateBlocks('')).toBe('');
  });

  it('returns original content when no private block exists', () => {
    const content = 'public instructions only';
    expect(stripPrivateBlocks(content)).toBe(content);
  });

  it('reports whether redaction happened', () => {
    const redacted = sanitizeMemoryContent('a <private>secret</private> b');
    const untouched = sanitizeMemoryContent('just public text');

    expect(redacted.redacted).toBe(true);
    expect(redacted.content).toContain(DEFAULT_PRIVATE_REPLACEMENT);
    expect(untouched.redacted).toBe(false);
    expect(untouched.content).toBe('just public text');
  });
});
