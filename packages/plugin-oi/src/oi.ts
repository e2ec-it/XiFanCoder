import { runProcessCommand, type ProcessRunInput, type ProcessRunResult } from './process.js';
import type {
  OiAvailability,
  OiExecutionResult,
  OiExecuteInput,
  OiRuntimeConfig,
  OiSandbox,
} from './types.js';

type CommandRunner = (input: ProcessRunInput) => Promise<ProcessRunResult>;

const OI_EXECUTE_SCRIPT = [
  'import json',
  'import sys',
  '',
  'payload = json.loads(sys.stdin.read() or "{}")',
  '',
  'try:',
  '    from interpreter import interpreter',
  'except Exception as exc:',
  '    print(f"open-interpreter import failed: {exc}", file=sys.stderr)',
  '    sys.exit(2)',
  '',
  'model = payload.get("model")',
  'if model:',
  '    try:',
  '        interpreter.llm.model = model',
  '    except Exception:',
  '        pass',
  '',
  'base_url = payload.get("base_url")',
  'if base_url:',
  '    try:',
  '        interpreter.llm.api_base = base_url',
  '    except Exception:',
  '        pass',
  '',
  'api_key = payload.get("api_key")',
  'if api_key:',
  '    try:',
  '        interpreter.llm.api_key = api_key',
  '    except Exception:',
  '        pass',
  '',
  'language = payload.get("language", "")',
  'code = payload.get("code", "")',
  'if not language or not code:',
  '    print("missing language/code", file=sys.stderr)',
  '    sys.exit(3)',
  '',
  'prompt = f"Run in language={language}\\\\n{code}"',
  'result = interpreter.chat(prompt, display=False)',
  'print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))',
].join('\n');

export class OpenInterpreterExecutor {
  private readonly config: OiRuntimeConfig;
  private readonly runCommand: CommandRunner;
  private availabilityCache?: OiAvailability;

  constructor(config: OiRuntimeConfig, runCommand: CommandRunner = runProcessCommand) {
    this.config = config;
    this.runCommand = runCommand;
  }

  async checkAvailability(): Promise<OiAvailability> {
    if (this.availabilityCache) {
      return this.availabilityCache;
    }

    const result = await this.runCommand({
      command: this.resolveOiBin(),
      args: ['-c', 'import interpreter; print("ok")'],
      cwd: this.config.projectPath,
      env: this.buildChildEnv({}, 'local'),
      timeoutMs: 5_000,
    });

    if (result.spawnError?.includes('ENOENT')) {
      this.availabilityCache = {
        available: false,
        reason: 'python3 or open-interpreter module not found in PATH',
      };
      return this.availabilityCache;
    }

    if (result.exitCode !== 0) {
      this.availabilityCache = {
        available: false,
        reason: `open-interpreter python import failed: exit=${result.exitCode}`,
      };
      return this.availabilityCache;
    }

    this.availabilityCache = {
      available: true,
      version: result.stdout.trim() || 'ok',
    };
    return this.availabilityCache;
  }

  async executeTool(toolName: string, args: unknown): Promise<OiExecutionResult> {
    if (toolName !== 'oi_execute') {
      throw new Error(`unsupported tool: ${toolName}`);
    }

    const input = args as OiExecuteInput;
    if (input.confirm !== true) {
      throw new Error('oi_execute requires explicit confirm=true for every call');
    }

    if (!input.language?.trim()) {
      throw new Error('oi_execute requires language');
    }
    if (!input.code?.trim()) {
      throw new Error('oi_execute requires code');
    }

    const availability = await this.checkAvailability();
    if (!availability.available) {
      throw new Error(
        `Open Interpreter unavailable: ${availability.reason ?? 'unknown reason'}. ` +
          'Please install Python >= 3.11 and run: pip install open-interpreter',
      );
    }

    const sandbox: OiSandbox = input.sandbox === 'docker' ? 'docker' : 'local';
    const model = input.model ?? this.config.model;

    const oiArgs = ['-c', OI_EXECUTE_SCRIPT];

    const result = await this.runCommand({
      command: this.resolveOiBin(),
      args: oiArgs,
      cwd: this.config.projectPath,
      env: this.buildChildEnv(input, sandbox),
      inputText: `${JSON.stringify({
        language: input.language,
        code: input.code,
        sandbox,
        model,
        base_url: input.baseUrl ?? this.config.baseUrl,
        api_key: input.apiKey ?? this.config.apiKey,
      })}\n`,
      timeoutMs: input.timeoutMs ?? this.config.timeoutMs ?? 90_000,
    });

    if (result.spawnError) {
      throw new Error(`open-interpreter process error: ${result.spawnError}`);
    }
    if (result.timedOut) {
      throw new Error('open-interpreter execution timed out');
    }
    if (result.exitCode !== 0) {
      throw new Error(
        `open-interpreter command failed: exit=${result.exitCode} stderr=${result.stderr.trim()}`,
      );
    }

    return {
      tool: 'oi_execute',
      command: this.resolveOiBin(),
      args: oiArgs,
      cwd: this.config.projectPath,
      sandbox,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  private resolveOiBin(): string {
    return this.config.oiBin ?? this.config.env.OI_BIN ?? 'python3';
  }

  private buildChildEnv(
    overrides: {
      readonly baseUrl?: string;
      readonly apiKey?: string;
    },
    sandbox: OiSandbox,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.config.env,
    };

    const baseUrl = overrides.baseUrl ?? this.config.baseUrl;
    const apiKey = overrides.apiKey ?? this.config.apiKey;

    if (baseUrl) {
      env.OPENAI_BASE_URL = baseUrl;
      env.OPENAI_API_BASE = baseUrl;
      env.OI_BASE_URL = baseUrl;
    }
    if (apiKey) {
      env.OPENAI_API_KEY = apiKey;
      env.OI_API_KEY = apiKey;
      if (!env.ANTHROPIC_API_KEY) {
        env.ANTHROPIC_API_KEY = apiKey;
      }
    }

    env.OI_SANDBOX = sandbox;
    env.OI_DOCKER_SANDBOX = sandbox === 'docker' ? '1' : '0';
    return env;
  }
}
