import { describe, expect, it, vi } from 'vitest';

import { ObservationGenerator } from '../observation-generator.js';

describe('ObservationGenerator', () => {
  it('generates structured observation and strips private tags before llm call', async () => {
    const chat = vi.fn().mockResolvedValue({
      message: {
        content: [
          {
            type: 'text',
            text: [
              '<observation>',
              '<type>bugfix</type>',
              '<title>Harden websocket auth</title>',
              '<subtitle>Token check</subtitle>',
              '<narrative>added token and origin verification</narrative>',
              '<facts><item>401 for missing token</item></facts>',
              '<concepts><item>security</item></concepts>',
              '<files_read><item>server.ts</item></files_read>',
              '<files_modified><item>security.ts</item></files_modified>',
              '</observation>',
            ].join(''),
          },
        ],
      },
    });

    const generator = new ObservationGenerator({ chat });
    const output = await generator.generate({
      id: 'obs-1',
      memSessionId: 'mem-1',
      project: '/repo/demo',
      promptNumber: 2,
      sourceText: 'secret=<private>sk-123</private>',
    });

    expect(output.type).toBe('bugfix');
    expect(output.title).toBe('Harden websocket auth');
    expect(output.filesModified).toEqual(['security.ts']);

    const request = chat.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string | null }>;
    };
    expect(request.messages[1]?.content).toContain('[REDACTED]');
    expect(request.messages[1]?.content).not.toContain('sk-123');
  });
});
