import path from 'node:path';

import { runProcessCommand, type ProcessRunInput, type ProcessRunResult } from './process.js';
import type {
  AiderAvailability,
  AiderCommitInput,
  AiderEditInput,
  AiderExecutionResult,
  AiderRuntimeConfig,
  AiderToolName,
  AiderUndoInput,
} from './types.js';

type CommandRunner = (input: ProcessRunInput) => Promise<ProcessRunResult>;

function parseChangedFiles(stdout: string, stderr: string): readonly string[] {
  const merged = `${stdout}\n${stderr}`;
  const results = new Set<string>();
  const pattern = /([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|py|md|json|yaml|yml|txt))/g;
  let match: RegExpExecArray | null;
  for (;;) {
    match = pattern.exec(merged);
    if (!match) {
      break;
    }
    const file = match[1];
    if (file) {
      results.add(file);
    }
  }
  return [...results];
}

function resolveToolName(name: string): AiderToolName {
  if (name === 'aider_edit' || name === 'aider_commit' || name === 'aider_undo') {
    return name;
  }
  throw new Error(`unsupported tool: ${name}`);
}

export class AiderExecutor {
  private readonly config: AiderRuntimeConfig;
  private readonly runCommand: CommandRunner;
  private availabilityCache?: AiderAvailability;

  constructor(config: AiderRuntimeConfig, runCommand: CommandRunner = runProcessCommand) {
    this.config = config;
    this.runCommand = runCommand;
  }

  async checkAvailability(): Promise<AiderAvailability> {
    if (this.availabilityCache) {
      return this.availabilityCache;
    }

    const result = await this.runCommand({
      command: this.resolveAiderBin(),
      args: ['--version'],
      cwd: this.config.projectPath,
      env: this.buildChildEnv({}),
      timeoutMs: 5_000,
    });

    if (result.spawnError?.includes('ENOENT')) {
      this.availabilityCache = {
        available: false,
        reason: 'aider not found in PATH',
      };
      return this.availabilityCache;
    }

    if (result.exitCode !== 0) {
      this.availabilityCache = {
        available: false,
        reason: `aider --version failed: exit=${result.exitCode}`,
      };
      return this.availabilityCache;
    }

    this.availabilityCache = {
      available: true,
      version: result.stdout.trim() || result.stderr.trim(),
    };
    return this.availabilityCache;
  }

  async executeTool(toolName: string, args: unknown): Promise<AiderExecutionResult> {
    const tool = resolveToolName(toolName);

    const availability = await this.checkAvailability();
    if (!availability.available) {
      throw new Error(
        `Aider unavailable: ${availability.reason ?? 'unknown reason'}. ` +
          'Please install Python >= 3.11 and run: pip install aider-chat',
      );
    }

    if (tool === 'aider_edit') {
      return await this.executeEdit(args as AiderEditInput);
    }
    if (tool === 'aider_commit') {
      return await this.executeCommit(args as AiderCommitInput);
    }
    return await this.executeUndo(args as AiderUndoInput);
  }

  private async executeEdit(input: AiderEditInput): Promise<AiderExecutionResult> {
    if (!Array.isArray(input.files) || input.files.length === 0) {
      throw new Error('aider_edit requires non-empty files');
    }
    if (!input.instruction?.trim()) {
      throw new Error('aider_edit requires instruction');
    }

    const args = this.buildCommonArgs({
      files: input.files,
      model: input.model,
      noAutoCommits: true,
    });
    if (input.mapTokens && input.mapTokens > 0) {
      args.push('--map-tokens', String(input.mapTokens));
    }

    const result = await this.runCommand({
      command: this.resolveAiderBin(),
      args,
      cwd: this.config.projectPath,
      env: this.buildChildEnv(input),
      inputText: `${input.instruction.trim()}\n`,
      timeoutMs: input.timeoutMs ?? this.config.timeoutMs ?? 120_000,
    });

    return this.toExecutionResult('aider_edit', args, result);
  }

  private async executeCommit(input: AiderCommitInput): Promise<AiderExecutionResult> {
    const args = this.buildCommonArgs({
      files: input.files ?? [],
      model: input.model,
      noAutoCommits: false,
    });

    const commandText = input.message?.trim().length
      ? `/commit ${input.message?.trim()}\n`
      : '/commit\n';

    const result = await this.runCommand({
      command: this.resolveAiderBin(),
      args,
      cwd: this.config.projectPath,
      env: this.buildChildEnv(input),
      inputText: commandText,
      timeoutMs: input.timeoutMs ?? this.config.timeoutMs ?? 90_000,
    });

    return this.toExecutionResult('aider_commit', args, result);
  }

  private async executeUndo(input: AiderUndoInput): Promise<AiderExecutionResult> {
    const args = this.buildCommonArgs({
      files: [],
      model: input.model,
      noAutoCommits: false,
    });

    const result = await this.runCommand({
      command: this.resolveAiderBin(),
      args,
      cwd: this.config.projectPath,
      env: this.buildChildEnv(input),
      inputText: '/undo\n',
      timeoutMs: input.timeoutMs ?? this.config.timeoutMs ?? 60_000,
    });

    return this.toExecutionResult('aider_undo', args, result);
  }

  private buildCommonArgs(input: {
    readonly files: readonly string[];
    readonly model?: string;
    readonly noAutoCommits: boolean;
  }): string[] {
    const args: string[] = ['--yes-always'];
    if (input.noAutoCommits) {
      args.push('--no-auto-commits');
    }

    const model = input.model ?? this.config.model;
    if (model) {
      args.push('--model', model);
    }

    for (const file of input.files) {
      args.push('--file', path.resolve(this.config.projectPath, file));
    }

    return args;
  }

  private buildChildEnv(overrides: {
    readonly baseUrl?: string;
    readonly apiKey?: string;
  }): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.config.env,
    };

    const baseUrl = overrides.baseUrl ?? this.config.baseUrl;
    const apiKey = overrides.apiKey ?? this.config.apiKey;

    if (baseUrl) {
      env.AIDER_API_BASE = baseUrl;
      env.OPENAI_API_BASE = baseUrl;
      env.OPENAI_BASE_URL = baseUrl;
    }

    if (apiKey) {
      env.AIDER_API_KEY = apiKey;
      env.OPENAI_API_KEY = apiKey;
      if (!env.ANTHROPIC_API_KEY) {
        env.ANTHROPIC_API_KEY = apiKey;
      }
    }

    return env;
  }

  private resolveAiderBin(): string {
    return this.config.aiderBin ?? this.config.env.AIDER_BIN ?? 'aider';
  }

  private toExecutionResult(
    tool: AiderToolName,
    args: readonly string[],
    result: ProcessRunResult,
  ): AiderExecutionResult {
    if (result.spawnError) {
      throw new Error(`aider process error: ${result.spawnError}`);
    }
    if (result.timedOut) {
      throw new Error(`aider timed out after command execution: tool=${tool}`);
    }
    if (result.exitCode !== 0) {
      throw new Error(`aider command failed: exit=${result.exitCode} stderr=${result.stderr.trim()}`);
    }

    return {
      tool,
      command: this.resolveAiderBin(),
      args,
      cwd: this.config.projectPath,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      changedFiles: parseChangedFiles(result.stdout, result.stderr),
    };
  }
}
