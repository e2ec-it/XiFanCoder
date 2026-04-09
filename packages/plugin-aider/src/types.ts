export type AiderToolName = 'aider_edit' | 'aider_commit' | 'aider_undo';

export interface AiderRuntimeConfig {
  readonly projectPath: string;
  readonly env: Readonly<Record<string, string>>;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly aiderBin?: string;
  readonly timeoutMs?: number;
}

export interface AiderEditInput {
  readonly files: readonly string[];
  readonly instruction: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly mapTokens?: number;
  readonly timeoutMs?: number;
}

export interface AiderCommitInput {
  readonly files?: readonly string[];
  readonly message?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
}

export interface AiderUndoInput {
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
}

export interface AiderExecutionResult {
  readonly tool: AiderToolName;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly changedFiles: readonly string[];
}

export interface AiderAvailability {
  readonly available: boolean;
  readonly version?: string;
  readonly reason?: string;
}
