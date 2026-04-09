const PRIVATE_BLOCK_PATTERN = /<private\b[^>]*>[\s\S]*?<\/private>/gi;

export const DEFAULT_PRIVATE_REPLACEMENT = '[REDACTED]';

export interface MemorySanitizeResult {
  readonly content: string;
  readonly redacted: boolean;
}

export function stripPrivateBlocks(
  content: string,
  replacement = DEFAULT_PRIVATE_REPLACEMENT,
): string {
  if (!content) {
    return '';
  }
  return content.replace(PRIVATE_BLOCK_PATTERN, replacement);
}

export function sanitizeMemoryContent(
  content: string,
  replacement = DEFAULT_PRIVATE_REPLACEMENT,
): MemorySanitizeResult {
  const sanitized = stripPrivateBlocks(content, replacement);
  return {
    content: sanitized,
    redacted: sanitized !== content,
  };
}
