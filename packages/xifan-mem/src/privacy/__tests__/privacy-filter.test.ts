import { describe, expect, it } from 'vitest';

import { stripPrivateTags } from '../privacy-filter.js';

describe('stripPrivateTags', () => {
  it('redacts simple private tag blocks', () => {
    const output = stripPrivateTags('token=<private>abc</private>');
    expect(output).toBe('token=[REDACTED]');
  });

  it('supports multiline and attribute-rich private tags', () => {
    const output = stripPrivateTags([
      'before',
      '<private reason="sensitive">',
      'line-1',
      'line-2',
      '</private>',
      'after',
    ].join('\n'));

    expect(output).toBe([
      'before',
      '[REDACTED]',
      'after',
    ].join('\n'));
  });

  it('handles nested private tags without leaking inner content', () => {
    const output = stripPrivateTags(
      'A <private>outer <private>inner</private> outer-tail</private> B',
    );
    expect(output).toBe('A [REDACTED] B');
  });

  it('redacts dangling opening private tags until end of content', () => {
    const output = stripPrivateTags('start <private>secret never closed');
    expect(output).toBe('start [REDACTED]');
  });

  it('matches private tags case-insensitively', () => {
    const output = stripPrivateTags('a <PRIVATE>secret</PRIVATE> b');
    expect(output).toBe('a [REDACTED] b');
  });
});
