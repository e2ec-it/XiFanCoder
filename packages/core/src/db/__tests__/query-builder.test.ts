import { describe, expect, it } from 'vitest';

import { buildParameterizedUpdateQuery } from '../query-builder.js';

describe('buildParameterizedUpdateQuery', () => {
  it('builds parameterized update SQL with named placeholders', () => {
    const built = buildParameterizedUpdateQuery({
      table: 'sessions',
      idColumn: 'id',
      idValue: 's1',
      fields: {
        status: { column: 'status', value: 'completed' },
        messageCount: { column: 'message_count', value: 3 },
      },
    });

    expect(built?.sql).toBe(
      'UPDATE sessions SET status = @status, message_count = @messageCount WHERE id = @id',
    );
    expect(built?.params).toEqual({
      id: 's1',
      status: 'completed',
      messageCount: 3,
    });
  });

  it('returns undefined when no fields have definitions', () => {
    const result = buildParameterizedUpdateQuery({
      table: 'sessions',
      idColumn: 'id',
      idValue: 's1',
      fields: {
        optionalField: undefined,
      },
    });

    expect(result).toBeUndefined();
  });

  it('rejects unsafe table identifiers', () => {
    expect(() =>
      buildParameterizedUpdateQuery({
        table: 'sessions; DROP TABLE sessions; --',
        idColumn: 'id',
        idValue: 's1',
        fields: {},
      }),
    ).toThrowError('unsafe sql identifier');
  });
});
