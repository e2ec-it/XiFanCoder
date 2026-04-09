import type { AnxietySignal, EvaluationResult } from './types.js';

export type ContextStrategy = 'continue' | 'compact' | 'reset';

interface AnxietyInput {
  readonly outputs: readonly string[];
  readonly scores: readonly Pick<EvaluationResult, 'weightedTotal'>[];
}

const CONCLUSION_PATTERNS = [
  '让我总结', '总结一下', 'to conclude', 'in summary', 'to summarize',
  'let me wrap up', '综上所述', '最终总结',
];

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/).filter(Boolean));
  const setB = new Set(b.split(/\s+/).filter(Boolean));
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function detectAnxiety(input: AnxietyInput): AnxietySignal[] {
  const signals: AnxietySignal[] = [];

  // 1. Repetition detection (Jaccard > 0.8 between adjacent outputs)
  for (let i = 1; i < input.outputs.length; i++) {
    const sim = jaccardSimilarity(input.outputs[i - 1]!, input.outputs[i]!);
    if (sim > 0.8) {
      signals.push({
        type: 'repetition',
        severity: sim,
        detectionMethod: 'heuristic',
        evidence: `Adjacent outputs ${i - 1}↔${i} Jaccard similarity: ${sim.toFixed(2)}`,
      });
    }
  }

  // 2. Quality degradation (consecutive 2-round decline)
  if (input.scores.length >= 3) {
    const last3 = input.scores.slice(-3);
    if (last3[2]!.weightedTotal < last3[1]!.weightedTotal
        && last3[1]!.weightedTotal < last3[0]!.weightedTotal) {
      const drop = last3[0]!.weightedTotal - last3[2]!.weightedTotal;
      signals.push({
        type: 'quality_degradation',
        severity: Math.min(1, drop / 5),
        detectionMethod: 'heuristic',
        evidence: `Score trend: ${last3.map((s) => s.weightedTotal.toFixed(1)).join(' → ')}`,
      });
    }
  }

  // 3. Premature conclusion keyword matching
  const lastOutput = input.outputs.at(-1) ?? '';
  const lower = lastOutput.toLowerCase();
  for (const pattern of CONCLUSION_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      signals.push({
        type: 'premature_conclusion',
        severity: 0.7,
        detectionMethod: 'heuristic',
        evidence: `Conclusion keyword found: "${pattern}"`,
      });
      break;
    }
  }

  return signals;
}

export function decideStrategy(signals: readonly AnxietySignal[]): ContextStrategy {
  if (signals.length === 0) return 'continue';
  const maxSeverity = Math.max(...signals.map((s) => s.severity));
  if (signals.length >= 2 && maxSeverity >= 0.8) return 'reset';
  if (maxSeverity >= 0.5) return 'compact';
  return 'continue';
}
