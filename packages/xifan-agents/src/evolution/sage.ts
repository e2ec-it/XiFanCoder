import type { Pool } from 'pg';

import { saveMemory } from '../memory/store.js';
import { getReplay } from '../observer/replay.js';
import { scoreTrajectory } from './quality-scorer.js';

const SAGE_THRESHOLD = 0.7;

export async function extractSkillIfWorthy(
  pool: Pool,
  sessionId: string,
  meta: {
    userInput: string;
    status: 'completed' | 'max_rounds' | 'error';
    toolCount: number;
    filesModified: number;
  },
): Promise<string | undefined> {
  const score = scoreTrajectory({
    status: meta.status,
    toolCount: meta.toolCount,
    filesModified: meta.filesModified,
  });
  if (score < SAGE_THRESHOLD) return undefined;

  const events = await getReplay(pool, sessionId);
  const toolSequence = events
    .filter((e) => e.type === 'tool_call' && e.tool_name)
    .map((e) => e.tool_name)
    .join(' → ');

  const summary = `[技能] ${meta.userInput.slice(0, 50)}：${toolSequence}（质量分 ${score.toFixed(2)}）`;
  return saveMemory(pool, {
    type: 'procedural',
    summary,
    payload: { sessionId, toolSequence, score },
    salience: score,
  });
}
