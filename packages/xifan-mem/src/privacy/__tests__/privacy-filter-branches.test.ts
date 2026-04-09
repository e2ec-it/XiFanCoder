import { describe, expect, it } from 'vitest';

import { stripPrivateTags } from '../privacy-filter.js';

describe('stripPrivateTags branch coverage', () => {
  it('returns empty string for empty/falsy input', () => {
    expect(stripPrivateTags('')).toBe('');
  });

  it('returns content unchanged when no private tags present', () => {
    expect(stripPrivateTags('hello world')).toBe('hello world');
  });

  it('passes through closing tag with zero depth (orphan closing tag)', () => {
    // When a </private> appears with depth=0, scanner skips it
    const output = stripPrivateTags('before </private> after');
    expect(output).toBe('before </private> after');
  });

  it('handles whitespace inside opening tag before tag name', () => {
    const output = stripPrivateTags('a < private>secret</ private> b');
    expect(output).toBe('a [REDACTED] b');
  });

  it('handles whitespace inside closing tag after slash', () => {
    const output = stripPrivateTags('a <private>secret</ private> b');
    expect(output).toBe('a [REDACTED] b');
  });

  it('rejects tag-like content that is not the private tag name', () => {
    // <privately> should not match because 'private' is followed by word char 'l'
    const output = stripPrivateTags('a <privately>not secret</privately> b');
    expect(output).toBe('a <privately>not secret</privately> b');
  });

  it('rejects incomplete tag (no closing >)', () => {
    const output = stripPrivateTags('a <private b');
    expect(output).toBe('a <private b');
  });

  it('rejects tag with content[start] not being <', () => {
    // This tests the first guard in parsePrivateTagToken implicitly
    // by ensuring normal text is not parsed as tags
    const output = stripPrivateTags('no angle brackets here');
    expect(output).toBe('no angle brackets here');
  });

  it('handles tag name shorter than "private" inside angle brackets', () => {
    // <pr> has tagNameEnd > closeIndex
    const output = stripPrivateTags('a <pr>b</pr> c');
    expect(output).toBe('a <pr>b</pr> c');
  });

  it('skips tag whose name has correct length but differs from "private"', () => {
    // <publics> has 7 chars like "private" but does not match
    const output = stripPrivateTags('a <publics>text</publics> b');
    expect(output).toBe('a <publics>text</publics> b');
  });

  it('uses custom replacement string', () => {
    const output = stripPrivateTags('a <private>secret</private> b', '***');
    expect(output).toBe('a *** b');
  });

  it('handles non-private angle-bracket content followed by private tag', () => {
    const output = stripPrivateTags('a <div>ok</div> <private>secret</private> b');
    expect(output).toBe('a <div>ok</div> [REDACTED] b');
  });

  it('handles tag with attributes after tag name', () => {
    // <private attr="val"> should still match since boundary is a space (not word char)
    const output = stripPrivateTags('<private attr="x">data</private>');
    expect(output).toBe('[REDACTED]');
  });
});
