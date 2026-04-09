import { describe, expect, it } from 'vitest';

import { parseStringArray, stringifyStringArray } from '../serde.js';

describe('serde', () => {
  describe('stringifyStringArray', () => {
    it('serializes a string array to JSON', () => {
      expect(stringifyStringArray(['a', 'b'])).toBe('["a","b"]');
    });
  });

  describe('parseStringArray', () => {
    it('parses a valid JSON string array', () => {
      expect(parseStringArray('["a","b"]')).toEqual(['a', 'b']);
    });

    it('returns empty array for non-array JSON', () => {
      expect(parseStringArray('"not-array"')).toEqual([]);
      expect(parseStringArray('42')).toEqual([]);
      expect(parseStringArray('{}')).toEqual([]);
    });

    it('returns empty array for invalid JSON', () => {
      expect(parseStringArray('not json')).toEqual([]);
      expect(parseStringArray('')).toEqual([]);
    });

    it('filters out non-string items', () => {
      expect(parseStringArray('[1, "a", null, "b", true]')).toEqual(['a', 'b']);
    });
  });
});
