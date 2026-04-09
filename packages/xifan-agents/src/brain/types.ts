// ── QualityRubric ──────────────────────────────────────────────────────────

export interface RubricDimension {
  readonly name: string;
  readonly weight: number;
  readonly threshold: number;
  readonly description: string;
}

export type QualityRubric = readonly RubricDimension[];

export function createDefaultRubric(): QualityRubric {
  return [
    { name: 'task_completeness', weight: 0.30, threshold: 7, description: '是否完整完成任务需求' },
    { name: 'code_quality',      weight: 0.25, threshold: 6, description: '可读性、命名、结构' },
    { name: 'robustness',        weight: 0.20, threshold: 6, description: '错误处理、边界情况' },
    { name: 'originality',       weight: 0.10, threshold: 5, description: '解决方案的创新程度' },
    { name: 'tool_efficiency',   weight: 0.15, threshold: 6, description: '工具调用效率、避免冗余' },
  ] as const;
}

// ── EvaluationResult ────────────────────────────────────────────────────────

export interface EvaluationResult {
  readonly sprintId: string;
  readonly round: number;
  readonly scores: ReadonlyMap<string, number>;
  readonly weightedTotal: number;
  readonly verdict: 'pass' | 'iterate' | 'abort';
  readonly feedback: string;
  readonly evidence: readonly string[];
}

// ── AcceptanceCriterion ─────────────────────────────────────────────────────

export type TestMethod = 'shell_command' | 'api_call' | 'code_review' | 'playwright';

export interface AcceptanceCriterion {
  readonly id: string;
  readonly description: string;
  readonly testMethod: TestMethod;
  readonly testCommand?: string;
  readonly expectedOutcome: string;
}

// ── SprintContract ──────────────────────────────────────────────────────────

export interface SprintContract {
  readonly sprintId: string;
  readonly taskDescription: string;
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly maxIterations: number;
  readonly qualityRubric: QualityRubric;
  readonly negotiationRounds: number;
  readonly frozenAt: string;
}

export function validateContract(contract: SprintContract): boolean {
  if (!contract.taskDescription.trim()) return false;
  if (contract.maxIterations < 1 || contract.maxIterations > 10) return false;
  if (!contract.sprintId) return false;
  return true;
}

// ── SprintConfig ────────────────────────────────────────────────────────────

export interface SprintConfig {
  readonly maxIterations: number;
  readonly maxNegotiationRounds: number;
  readonly evaluationTimeoutMs: number;
  readonly abortThreshold: number;
  readonly convergenceDelta: number;
}

export const DEFAULT_SPRINT_CONFIG: SprintConfig = {
  maxIterations: 5,
  maxNegotiationRounds: 2,
  evaluationTimeoutMs: 30_000,
  abortThreshold: 3.0,
  convergenceDelta: 0.5,
} as const;

// ── AnxietySignal ───────────────────────────────────────────────────────────

export type AnxietyType = 'repetition' | 'quality_degradation' | 'premature_conclusion'
                        | 'scope_narrowing' | 'hallucination_spike';

export interface AnxietySignal {
  readonly type: AnxietyType;
  readonly severity: number;
  readonly detectionMethod: 'heuristic' | 'model';
  readonly evidence: string;
}

// ── SprintResult ────────────────────────────────────────────────────────────

export interface SprintResult {
  readonly sprintId: string;
  readonly contract: SprintContract;
  readonly iterations: number;
  readonly finalScores: EvaluationResult;
  readonly converged: boolean;
  readonly durationMs: number;
}
