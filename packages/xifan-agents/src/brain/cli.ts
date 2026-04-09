#!/usr/bin/env node
/**
 * Sprint Runner CLI — 端到端执行 Generator-Evaluator 对抗循环
 *
 * Usage:
 *   npx tsx packages/xifan-agents/src/brain/cli.ts "实现 JWT 验证中间件"
 *   npx tsx packages/xifan-agents/src/brain/cli.ts --task "Fix login bug" --max-iter 3
 *
 * Environment:
 *   LITELLM_BASE_URL   LiteLLM gateway (default: http://localhost:4000)
 *   LITELLM_API_KEY    LiteLLM API key (required)
 *   XIFAN_GENERATOR_MODEL  Generator model (default: qwen3-coder-next)
 *   XIFAN_EVALUATOR_MODEL  Evaluator model (default: qwen2.5-coder-32b)
 */

import { negotiateContract } from './contract-negotiator.js';
import { runSprint, type GeneratorFn } from './sprint-loop.js';
import { chatCompletion } from './llm-client.js';
import { createDefaultRubric } from './types.js';
import { v4 as uuidv4 } from 'uuid';
import { pathToFileURL } from 'node:url';
import type { AcceptanceCriterion, QualityRubric, SprintContract } from './types.js';

const GENERATOR_MODEL = process.env['XIFAN_GENERATOR_MODEL'] ?? 'qwen3-coder-next';

export function parseArgs(argv: string[]): { task: string; maxIter: number; sessionId: string } {
  const args = argv.slice(2);
  let task = '';
  let maxIter = 5;
  const sessionId = `sprint-${uuidv4().slice(0, 8)}`;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task' && args[i + 1]) {
      task = args[++i]!;
    } else if (args[i] === '--max-iter' && args[i + 1]) {
      maxIter = parseInt(args[++i]!, 10);
    } else if (!args[i]!.startsWith('--') && !task) {
      task = args[i]!;
    }
  }

  if (!task) {
    console.error('Usage: npx tsx src/brain/cli.ts "任务描述"');
    console.error('       npx tsx src/brain/cli.ts --task "任务描述" --max-iter 3');
    process.exit(1);
  }

  return { task, maxIter, sessionId };
}

export function createGenerator(taskDescription: string): GeneratorFn {
  return async (feedback: string) => {
    const userPrompt = feedback
      ? `任务：${taskDescription}\n\n上一轮评审反馈：\n${feedback}\n\n请根据反馈改进你的实现。`
      : `任务：${taskDescription}\n\n请提供完整的实现方案和代码。`;

    const response = await chatCompletion({
      model: GENERATOR_MODEL,
      messages: [
        {
          role: 'system',
          content: '你是一个高级软件工程师。请根据任务描述提供完整、高质量的实现方案和代码。',
        },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 4000,
      temperature: 0.3,
      timeoutMs: 60_000,
    });

    return response.content;
  };
}

export async function buildSprintContract(
  task: string,
  maxIter: number,
  rubric: QualityRubric,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SprintContract> {
  if (env['XIFAN_DISABLE_CONTRACT'] === '1') {
    return {
      sprintId: `sp-${uuidv4().slice(0, 8)}`,
      taskDescription: task,
      acceptanceCriteria: [] as readonly AcceptanceCriterion[],
      maxIterations: maxIter,
      qualityRubric: rubric,
      negotiationRounds: 0,
      frozenAt: new Date().toISOString(),
    };
  }

  return negotiateContract(task, rubric);
}

export async function main(): Promise<void> {
  const { task, maxIter, sessionId } = parseArgs(process.argv);

  console.log('== Sprint Runner ==');
  console.log(`Task:       ${task}`);
  console.log(`Session:    ${sessionId}`);
  console.log(`Generator:  ${GENERATOR_MODEL}`);
  console.log(`Evaluator:  ${process.env['XIFAN_EVALUATOR_MODEL'] ?? 'qwen2.5-coder-32b'}`);
  console.log(`Max Iter:   ${maxIter}`);
  console.log('');

  // Phase 1: Negotiate contract
  console.log('[1/3] Negotiating Sprint Contract...');
  const rubric = createDefaultRubric();
  const contract = await buildSprintContract(task, maxIter, rubric);
  if (process.env['XIFAN_DISABLE_CONTRACT'] === '1') {
    console.log('  Contract negotiation skipped (ablation)');
  }

  // Override maxIterations from CLI
  const finalContract = { ...contract, maxIterations: maxIter };

  console.log(`  Sprint ID:    ${finalContract.sprintId}`);
  console.log(`  Criteria:     ${finalContract.acceptanceCriteria.length} items`);
  console.log(`  Negotiation:  ${finalContract.negotiationRounds} rounds`);
  console.log('');

  // Phase 2: Run Sprint Loop
  console.log('[2/3] Running Generator-Evaluator loop...');
  const generator = createGenerator(task);
  const result = await runSprint(finalContract, generator, sessionId);

  // Phase 3: Report
  console.log('');
  console.log('[3/3] Sprint Result');
  console.log(`  Iterations:   ${result.iterations}`);
  console.log(`  Converged:    ${result.converged}`);
  console.log(`  Duration:     ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Verdict:      ${result.finalScores.verdict}`);
  console.log(`  Total Score:  ${result.finalScores.weightedTotal.toFixed(2)}`);
  console.log('');
  console.log('  Dimension Scores:');
  for (const [dim, score] of result.finalScores.scores) {
    const rubricDim = rubric.find((d) => d.name === dim);
    const marker = rubricDim && score < rubricDim.threshold ? ' ⚠' : ' ✓';
    console.log(`    ${dim.padEnd(20)} ${score}/10${marker}`);
  }
  console.log('');
  console.log(`  Feedback: ${result.finalScores.feedback}`);

  if (result.finalScores.evidence.length > 0) {
    console.log('  Evidence:');
    for (const e of result.finalScores.evidence) {
      console.log(`    - ${e}`);
    }
  }

  process.exit(result.converged ? 0 : 1);
}

/* v8 ignore start -- CLI entry-point guard, only runs when executed directly */
function isDirectExecution(argv: readonly string[] = process.argv): boolean {
  const entry = argv[1];
  return typeof entry === 'string' && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectExecution()) {
  main().catch((err) => {
    console.error('Sprint failed:', err instanceof Error ? err.message : String(err));
    process.exit(2);
  });
}
/* v8 ignore stop */
