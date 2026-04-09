export interface SessionSummary {
  readonly status: 'completed' | 'max_rounds' | 'error';
  readonly toolCount: number;
  readonly filesModified: number;
}

export function scoreTrajectory(session: SessionSummary): number {
  const taskSuccess    = session.status === 'completed' ? 1.0 : 0.0;
  const toolEfficiency = Math.min(1.0, 5 / Math.max(1, session.toolCount));
  const fixRate        = session.filesModified > 0 ? 1.0 : 0.3;
  return taskSuccess * 0.5 + toolEfficiency * 0.3 + fixRate * 0.2;
}
