import { describe, expect, it } from 'vitest';

import { parseObservationXml, parseSummaryXml } from '../xml-parser.js';

describe('parseSummaryXml', () => {
  it('tolerates missing fields and returns empty-string defaults', () => {
    const parsed = parseSummaryXml('<summary><request>only request</request></summary>');

    expect(parsed.request).toBe('only request');
    expect(parsed.investigated).toBe('');
    expect(parsed.learned).toBe('');
    expect(parsed.completed).toBe('');
    expect(parsed.nextSteps).toBe('');
    expect(parsed.filesRead).toEqual([]);
    expect(parsed.filesEdited).toEqual([]);
    expect(parsed.skipSummary).toBe(false);
  });

  it('parses skip_summary marker for queue short-circuit behavior', () => {
    const parsed = parseSummaryXml([
      '<summary>',
      '<skip_summary>true</skip_summary>',
      '<notes>too small to summarize</notes>',
      '</summary>',
    ].join(''));

    expect(parsed.skipSummary).toBe(true);
    expect(parsed.notes).toBe('too small to summarize');
  });

  it('parses repeated item tags without regex backtracking behavior', () => {
    const parsed = parseSummaryXml([
      '<summary>',
      '<files_read><item>a.ts</item><item>b.ts</item></files_read>',
      '<files_edited><item>c.ts</item></files_edited>',
      '</summary>',
    ].join(''));

    expect(parsed.filesRead).toEqual(['a.ts', 'b.ts']);
    expect(parsed.filesEdited).toEqual(['c.ts']);
  });
});

describe('parseObservationXml', () => {
  it('parses tags case-insensitively', () => {
    const parsed = parseObservationXml([
      '<OBSERVATION>',
      '<TYPE>insight</TYPE>',
      '<TITLE>sample</TITLE>',
      '<NARRATIVE>details</NARRATIVE>',
      '<FACTS><ITEM>f1</ITEM></FACTS>',
      '<CONCEPTS><ITEM>c1</ITEM></CONCEPTS>',
      '<FILES_READ><ITEM>r1</ITEM></FILES_READ>',
      '<FILES_MODIFIED><ITEM>m1</ITEM></FILES_MODIFIED>',
      '</OBSERVATION>',
    ].join(''));

    expect(parsed.type).toBe('insight');
    expect(parsed.title).toBe('sample');
    expect(parsed.narrative).toBe('details');
    expect(parsed.facts).toEqual(['f1']);
    expect(parsed.concepts).toEqual(['c1']);
    expect(parsed.filesRead).toEqual(['r1']);
    expect(parsed.filesModified).toEqual(['m1']);
  });
});
