const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  /\b(Bearer\s+[A-Za-z0-9._~+/-]{8,})\b/gi,
  /\b(api[_-]?key|token|password|secret)\s*[:=]\s*([^\s,;]+)/gi,
];

export function sanitizeLogValue<T>(value: T): T {
  return sanitizeValue(value) as T;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (looksSensitiveKey(key)) {
      next[key] = '****';
      continue;
    }
    next[key] = sanitizeValue(item);
  }
  return next;
}

function sanitizeString(input: string): string {
  let output = input;
  output = output.replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*([^\s,;]+)/gi, '$1=****');

  for (const pattern of SENSITIVE_PATTERNS) {
    output = output.replace(pattern, '****');
  }

  return output;
}

function looksSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized.includes('api_key') ||
    normalized.includes('apikey')
  );
}
