import type { SearchResult } from './retriever.js';

const MAX_TOKENS = 1800;
const AVG_CHARS_PER_TOKEN = 4;
const MAX_CHARS = MAX_TOKENS * AVG_CHARS_PER_TOKEN;

const TYPE_LABEL: Record<string, string> = {
  episodic: '经验',
  semantic: '知识',
  procedural: '技能',
  emotional: '偏好',
  reflective: '洞察',
};

export function assembleContext(results: readonly SearchResult[]): string {
  if (results.length === 0) return '';

  const parts: string[] = [];
  let totalChars = 0;

  for (const r of results) {
    const label = TYPE_LABEL[r.type] ?? r.type;
    const entry = `[${label}#${r.id.slice(0, 4)}] ${r.summary}`;
    if (totalChars + entry.length > MAX_CHARS) break;
    parts.push(entry);
    totalChars += entry.length;
  }

  return `<xifan-context>\n${parts.join('\n\n')}\n</xifan-context>`;
}
