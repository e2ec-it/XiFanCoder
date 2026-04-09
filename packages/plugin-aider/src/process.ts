import { spawn } from 'node:child_process';

export interface ProcessRunInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly inputText?: string;
  readonly timeoutMs: number;
}

export interface ProcessRunResult {
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError?: string;
}

export async function runProcessCommand(input: ProcessRunInput): Promise<ProcessRunResult> {
  return await new Promise<ProcessRunResult>((resolve) => {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError: string | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, 100).unref();
    }, input.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      spawnError = error.message;
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        signal,
        stdout,
        stderr,
        timedOut,
        spawnError,
      });
    });

    if (input.inputText !== undefined) {
      child.stdin.write(input.inputText);
    }
    child.stdin.end();
  });
}
