interface TaskConfig {
  readonly useExperiences: boolean;
  readonly ratio: number;
}

const AB_CONFIG: Record<string, TaskConfig> = {
  bugfix:   { useExperiences: true,  ratio: 1.0 },
  feature:  { useExperiences: true,  ratio: 0.5 },
  refactor: { useExperiences: false, ratio: 0.0 },
};

const DEFAULT_CONFIG: TaskConfig = { useExperiences: true, ratio: 0.3 };

export function shouldUseExperiences(taskType: string): boolean {
  const config = AB_CONFIG[taskType] ?? DEFAULT_CONFIG;
  if (!config.useExperiences) return false;
  return Math.random() < config.ratio;
}

export function detectTaskType(userInput: string): string {
  const lower = userInput.toLowerCase();
  if (/fix|bug|error|crash|fail/.test(lower)) return 'bugfix';
  if (/refactor|clean|rename|reorganize/.test(lower)) return 'refactor';
  if (/add|implement|create|build|new/.test(lower)) return 'feature';
  return 'general';
}
