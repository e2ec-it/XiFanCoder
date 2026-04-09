import { chatCompletion } from './llm-client.js';
import type { EvaluationResult, QualityRubric, SprintContract } from './types.js';
import { DEFAULT_SPRINT_CONFIG } from './types.js';
import { stripMarkdownFences } from './utils.js';

const EVALUATOR_MODEL = process.env['XIFAN_EVALUATOR_MODEL'] ?? 'qwen2.5-coder-32b';

export function parseEvaluationResponse(
  raw: string,
  sprintId: string,
  round: number,
  rubric: QualityRubric,
): EvaluationResult {
  const parsed = JSON.parse(stripMarkdownFences(raw)) as {
    scores: Record<string, number>;
    feedback: string;
    evidence: string[];
  };

  const scores = new Map<string, number>();
  let weightedTotal = 0;
  for (const dim of rubric) {
    const score = parsed.scores[dim.name] ?? 0;
    scores.set(dim.name, score);
    weightedTotal += score * dim.weight;
  }

  const allAboveThreshold = rubric.every(
    (dim) => (scores.get(dim.name) ?? 0) >= dim.threshold,
  );

  let verdict: 'pass' | 'iterate' | 'abort';
  if (weightedTotal < DEFAULT_SPRINT_CONFIG.abortThreshold) {
    verdict = 'abort';
  } else if (allAboveThreshold) {
    verdict = 'pass';
  } else {
    verdict = 'iterate';
  }

  return {
    sprintId, round, scores, weightedTotal, verdict,
    feedback: parsed.feedback ?? '',
    evidence: parsed.evidence ?? [],
  };
}

function buildEvaluationPrompt(contract: SprintContract, codeOutput: string): string {
  const dimensions = contract.qualityRubric
    .map((d) => `- ${d.name} (weight: ${d.weight}, threshold: ${d.threshold}): ${d.description}`)
    .join('\n');
  const criteria = contract.acceptanceCriteria
    .map((c) => `- [${c.id}] ${c.description} (${c.testMethod})`)
    .join('\n');

  return `你是一个独立的代码评审 Agent。请严格按照以下评分维度和验收标准评估代码输出。

## 任务描述
${contract.taskDescription}

## 验收标准
${criteria}

## 评分维度（每项 1-10 分）
${dimensions}

## 代码输出
\`\`\`
${codeOutput}
\`\`\`

请以 JSON 格式回复，不要包含其他内容：
{
  "scores": { "dimension_name": number, ... },
  "feedback": "自然语言反馈，说明需要改进的具体问题",
  "evidence": ["支持判断的具体证据1", "证据2"]
}`;
}

export async function evaluate(
  contract: SprintContract,
  codeOutput: string,
  round: number,
): Promise<EvaluationResult> {
  const prompt = buildEvaluationPrompt(contract, codeOutput);
  try {
    const response = await chatCompletion({
      model: EVALUATOR_MODEL,
      messages: [
        { role: 'system', content: '你是独立代码评审 Agent，只输出 JSON。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      timeoutMs: DEFAULT_SPRINT_CONFIG.evaluationTimeoutMs,
    });
    return parseEvaluationResponse(
      response.content, contract.sprintId, round, contract.qualityRubric,
    );
  } catch (err) {
    return {
      sprintId: contract.sprintId, round,
      scores: new Map(contract.qualityRubric.map((d) => [d.name, 0])),
      weightedTotal: 0, verdict: 'iterate',
      feedback: `Evaluator error: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
      evidence: [],
    };
  }
}
