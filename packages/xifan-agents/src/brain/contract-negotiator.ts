import { v4 as uuidv4 } from 'uuid';
import { chatCompletion } from './llm-client.js';
import type { AcceptanceCriterion, QualityRubric, SprintContract } from './types.js';
import { createDefaultRubric, DEFAULT_SPRINT_CONFIG } from './types.js';
import { stripMarkdownFences } from './utils.js';

const NEGOTIATOR_MODEL = process.env['XIFAN_NEGOTIATOR_MODEL'] ?? process.env['XIFAN_EVALUATOR_MODEL'] ?? 'qwen2.5-coder-32b';

export function parseContractResponse(
  raw: string,
  taskDescription: string,
  rubric: QualityRubric,
): SprintContract {
  const parsed = JSON.parse(stripMarkdownFences(raw)) as {
    acceptanceCriteria?: unknown;
    maxIterations?: number;
  };

  const criteria = Array.isArray(parsed.acceptanceCriteria)
    ? parsed.acceptanceCriteria as AcceptanceCriterion[]
    : [];

  return {
    sprintId: `sp-${uuidv4().slice(0, 8)}`,
    taskDescription,
    acceptanceCriteria: criteria,
    maxIterations: Math.min(parsed.maxIterations ?? DEFAULT_SPRINT_CONFIG.maxIterations, 10),
    qualityRubric: rubric,
    negotiationRounds: 1,
    frozenAt: new Date().toISOString(),
  };
}

function buildNegotiationPrompt(taskDescription: string, rubric: QualityRubric): string {
  const dims = rubric.map((d) => `- ${d.name}: ${d.description}`).join('\n');
  return `你是 Sprint Contract 协商 Agent。根据以下任务描述，生成明确的验收标准。

## 任务描述
${taskDescription}

## 评分维度
${dims}

请以 JSON 格式回复（不要包含其他内容）：
{
  "acceptanceCriteria": [
    {
      "id": "ac-1",
      "description": "验收标准描述",
      "testMethod": "shell_command" | "api_call" | "code_review",
      "testCommand": "可选的具体测试命令",
      "expectedOutcome": "预期结果"
    }
  ],
  "maxIterations": 3
}`;
}

export async function negotiateContract(
  taskDescription: string,
  rubric: QualityRubric = createDefaultRubric(),
): Promise<SprintContract> {
  try {
    const response = await chatCompletion({
      model: NEGOTIATOR_MODEL,
      messages: [
        { role: 'system', content: '你是 Sprint Contract 协商 Agent，只输出 JSON。' },
        { role: 'user', content: buildNegotiationPrompt(taskDescription, rubric) },
      ],
      temperature: 0.2,
    });
    return parseContractResponse(response.content, taskDescription, rubric);
  } catch (err) {
    console.warn('[xifan-agents] Contract negotiation failed, using fallback:', err instanceof Error ? err.message : String(err));
    return {
      sprintId: `sp-${uuidv4().slice(0, 8)}`,
      taskDescription,
      acceptanceCriteria: [],
      maxIterations: DEFAULT_SPRINT_CONFIG.maxIterations,
      qualityRubric: rubric,
      negotiationRounds: 0,
      frozenAt: new Date().toISOString(),
    };
  }
}
