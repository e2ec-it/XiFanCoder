export function stringifyStringArray(value: readonly string[]): string {
  return JSON.stringify([...value]);
}

export function parseStringArray(value: string): readonly string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}
