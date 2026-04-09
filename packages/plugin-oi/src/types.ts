export type OiSandbox = 'local' | 'docker';

export interface OiRuntimeConfig {
  readonly projectPath: string;
  readonly env: Readonly<Record<string, string>>;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly oiBin?: string;
  readonly timeoutMs?: number;
}

export interface OiExecuteInput {
  readonly language: string;
  readonly code: string;
  readonly sandbox?: OiSandbox;
  readonly confirm: boolean;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
}

export interface OiAvailability {
  readonly available: boolean;
  readonly version?: string;
  readonly reason?: string;
}

export interface OiExecutionResult {
  readonly tool: 'oi_execute';
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly sandbox: OiSandbox;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}
