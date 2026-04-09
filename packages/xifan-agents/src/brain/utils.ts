/** Strip markdown code fences that LLMs commonly wrap JSON responses in. */
export function stripMarkdownFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
}
