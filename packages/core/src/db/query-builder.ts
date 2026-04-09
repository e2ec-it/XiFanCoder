export interface UpdateFieldDefinition {
  readonly column: string;
  readonly value: unknown;
}

export interface BuildUpdateQueryInput {
  readonly table: string;
  readonly idColumn: string;
  readonly idValue: unknown;
  readonly idParamName?: string;
  readonly fields: Record<string, UpdateFieldDefinition | undefined>;
}

export interface BuiltUpdateQuery {
  readonly sql: string;
  readonly params: Record<string, unknown>;
}

const SAFE_SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertSafeIdentifier(value: string): void {
  if (!SAFE_SQL_IDENTIFIER.test(value)) {
    throw new Error(`unsafe sql identifier: ${value}`);
  }
}

export function buildParameterizedUpdateQuery(
  input: BuildUpdateQueryInput,
): BuiltUpdateQuery | undefined {
  assertSafeIdentifier(input.table);
  assertSafeIdentifier(input.idColumn);

  const idParamName = input.idParamName ?? 'id';
  assertSafeIdentifier(idParamName);

  const assignments: string[] = [];
  const params: Record<string, unknown> = {
    [idParamName]: input.idValue,
  };

  for (const [paramName, definition] of Object.entries(input.fields)) {
    if (!definition) {
      continue;
    }
    assertSafeIdentifier(paramName);
    assertSafeIdentifier(definition.column);
    assignments.push(`${definition.column} = @${paramName}`);
    params[paramName] = definition.value;
  }

  if (assignments.length === 0) {
    return undefined;
  }

  return {
    sql: `UPDATE ${input.table} SET ${assignments.join(', ')} WHERE ${input.idColumn} = @${idParamName}`,
    params,
  };
}
