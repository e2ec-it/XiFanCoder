export function stripPrivateTags(content: string, replacement = '[REDACTED]'): string {
  if (!content) {
    return '';
  }

  let depth = 0;
  let cursor = 0;
  let scanIndex = 0;
  let output = '';

  while (scanIndex < content.length) {
    const index = content.indexOf('<', scanIndex);
    if (index === -1) {
      break;
    }
    const token = parsePrivateTagToken(content, index);
    if (!token) {
      scanIndex = index + 1;
      continue;
    }
    const end = token.end;
    const isClosing = token.isClosing;

    if (!isClosing) {
      if (depth === 0) {
        output += content.slice(cursor, index);
      }
      depth += 1;
      cursor = end;
      scanIndex = end;
      continue;
    }

    if (depth > 0) {
      depth -= 1;
      if (depth === 0) {
        output += replacement;
        cursor = end;
      }
      scanIndex = end;
      continue;
    }

    scanIndex = end;
  }

  if (depth > 0) {
    output += replacement;
    return output;
  }

  output += content.slice(cursor);
  return output;
}

interface PrivateTagToken {
  readonly isClosing: boolean;
  readonly end: number;
}

function parsePrivateTagToken(content: string, start: number): PrivateTagToken | undefined {
  /* v8 ignore next 3 -- defensive guard: only called after indexOf('<') */
  if (content[start] !== '<') {
    return undefined;
  }

  const closeIndex = content.indexOf('>', start + 1);
  if (closeIndex === -1) {
    return undefined;
  }

  let cursor = start + 1;
  while (cursor < closeIndex && isWhitespace(content[cursor] ?? '')) {
    cursor += 1;
  }

  let isClosing = false;
  if (cursor < closeIndex && content[cursor] === '/') {
    isClosing = true;
    cursor += 1;
    while (cursor < closeIndex && isWhitespace(content[cursor] ?? '')) {
      cursor += 1;
    }
  }

  const tagName = 'private';
  const tagNameEnd = cursor + tagName.length;
  if (tagNameEnd > closeIndex) {
    return undefined;
  }
  if (content.slice(cursor, tagNameEnd).toLowerCase() !== tagName) {
    return undefined;
  }

  const boundary = content[tagNameEnd] ?? '';
  if (isWordChar(boundary)) {
    return undefined;
  }

  return {
    isClosing,
    end: closeIndex + 1,
  };
}

function isWhitespace(value: string): boolean {
  return value === ' ' || value === '\t' || value === '\n' || value === '\r' || value === '\f';
}

function isWordChar(value: string): boolean {
  const code = value.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}
