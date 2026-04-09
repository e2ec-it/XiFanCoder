import { describe, expect, it } from 'vitest';

import { parseObservationXml, parseSummaryXml } from '../xml-parser.js';

describe('xml-parser branch coverage', () => {
  it('throws when required tag is missing from observation xml', () => {
    expect(() => parseObservationXml('<observation></observation>')).toThrow(
      'invalid_xml_missing_type',
    );
  });

  it('returns undefined for extractTag when close tag is missing', () => {
    // <type>bugfix has no closing </type>, so extractTag returns undefined for type
    expect(() => parseObservationXml('<type>bugfix')).toThrow(
      'invalid_xml_missing_type',
    );
    // Also test when type is present but title close tag is missing
    expect(() => parseObservationXml('<type>bugfix</type><title>T')).toThrow(
      'invalid_xml_missing_title',
    );
  });

  it('returns undefined subtitle when subtitle tag is empty', () => {
    const parsed = parseObservationXml([
      '<type>bugfix</type>',
      '<title>T</title>',
      '<subtitle></subtitle>',
      '<narrative>N</narrative>',
    ].join(''));
    expect(parsed.subtitle).toBeUndefined();
  });

  it('handles extractItems when inner close tag is missing (break on closeIndex -1)', () => {
    const parsed = parseSummaryXml([
      '<files_read><item>a.ts<item>b.ts</item></files_read>',
    ].join(''));
    // First <item> has no </item> before second <item>, so it reads until next </item>
    // which captures 'a.ts<item>b.ts' then no more items after
    expect(parsed.filesRead.length).toBeGreaterThanOrEqual(1);
  });

  it('handles extractItems with empty items (filtered out)', () => {
    const parsed = parseSummaryXml([
      '<files_read><item></item><item>a.ts</item></files_read>',
    ].join(''));
    expect(parsed.filesRead).toEqual(['a.ts']);
  });

  it('handles extractItems when no item tags present', () => {
    const parsed = parseSummaryXml([
      '<files_read>just text no items</files_read>',
    ].join(''));
    expect(parsed.filesRead).toEqual([]);
  });

  it('breaks when item open tag found but close tag missing', () => {
    // <item>a.ts has open tag but no </item> at all -> closeIndex=-1 -> break
    const parsed = parseSummaryXml('<files_read><item>a.ts</files_read>');
    expect(parsed.filesRead).toEqual([]);
  });

  it('handles notes tag with empty content', () => {
    const parsed = parseSummaryXml('<notes></notes>');
    expect(parsed.notes).toBeUndefined();
  });
});
