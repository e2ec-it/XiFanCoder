import { describe, expect, it, vi } from 'vitest';

import { ObservationGenerator } from '../observation-generator.js';
import { SummaryGenerator } from '../summary-generator.js';

describe('ObservationGenerator branch coverage', () => {
  it('handles null content from LLM response', async () => {
    const chat = vi.fn().mockResolvedValue({
      message: {
        content: null,
      },
    });

    const generator = new ObservationGenerator({ chat });
    await expect(
      generator.generate({
        id: 'obs-null',
        memSessionId: 'mem-1',
        project: '/repo/demo',
        promptNumber: 1,
        sourceText: 'test',
      }),
    ).rejects.toThrow('invalid_xml_missing_type');
  });

  it('throws on invalid observation type', async () => {
    const chat = vi.fn().mockResolvedValue({
      message: {
        content: [
          '<observation>',
          '<type>invalid_type_xyz</type>',
          '<title>T</title>',
          '<narrative>N</narrative>',
          '<facts></facts>',
          '<concepts></concepts>',
          '<files_read></files_read>',
          '<files_modified></files_modified>',
          '</observation>',
        ].join(''),
      },
    });

    const generator = new ObservationGenerator({ chat });
    await expect(
      generator.generate({
        id: 'obs-bad',
        memSessionId: 'mem-1',
        project: '/repo/demo',
        promptNumber: 1,
        sourceText: 'test',
      }),
    ).rejects.toThrow('invalid_observation_type_invalid_type_xyz');
  });
});

describe('SummaryGenerator branch coverage', () => {
  it('handles null content from LLM response', async () => {
    const chat = vi.fn().mockResolvedValue({
      message: {
        content: null,
      },
    });

    const generator = new SummaryGenerator({ chat });
    // null content -> empty string -> parseSummaryXml on empty string -> defaults
    const result = await generator.generate({
      id: 'sum-null',
      memSessionId: 'mem-1',
      project: '/repo/demo',
      sourceText: 'test',
    });
    // Empty string has no skip_summary=true, so should return a summary with empty defaults
    expect(result).toBeDefined();
    expect(result?.request).toBe('');
  });
});
