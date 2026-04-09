import { describe, expect, it, vi } from 'vitest';

import { SummaryGenerator } from '../summary-generator.js';

describe('SummaryGenerator', () => {
  it('parses summary xml output', async () => {
    const chat = vi.fn().mockResolvedValue({
      message: {
        content: [
          {
            type: 'text',
            text: [
              '<summary>',
              '<request>stabilize queue worker</request>',
              '<investigated>queue status transitions</investigated>',
              '<learned>retry budget prevents loops</learned>',
              '<completed>implemented processor and tests</completed>',
              '<next_steps>connect to agent hooks</next_steps>',
              '<notes>llm output must be strict xml</notes>',
              '<files_read><item>queue-store.ts</item></files_read>',
              '<files_edited><item>queue-processor.ts</item></files_edited>',
              '</summary>',
            ].join(''),
          },
        ],
      },
    });

    const generator = new SummaryGenerator({ chat });
    const output = await generator.generate({
      id: 'sum-1',
      memSessionId: 'mem-1',
      project: '/repo/demo',
      sourceText: 'worklog',
    });

    expect(output.request).toBe('stabilize queue worker');
    expect(output.nextSteps).toBe('connect to agent hooks');
    expect(output.filesEdited).toEqual(['queue-processor.ts']);
  });

  it('returns undefined when skip_summary marker is set', async () => {
    const chat = vi.fn().mockResolvedValue({
      message: {
        content: '<summary><skip_summary>true</skip_summary></summary>',
      },
    });

    const generator = new SummaryGenerator({ chat });
    const output = await generator.generate({
      id: 'sum-2',
      memSessionId: 'mem-1',
      project: '/repo/demo',
      sourceText: 'very short context',
    });

    expect(output).toBeUndefined();
  });
});
