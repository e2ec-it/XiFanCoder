import {
  estimateCost,
  estimateTextTokens,
  type AgentMode,
} from '@xifan-coder/core';

import { executeCommandDetailed, formatCommandResultText, helpText } from './commands.js';
import { parseCliArgs } from './parse.js';

export interface ReplUsageSummary {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface ReplTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ReplState {
  model: string;
  mode: AgentMode;
  outputStyle: string;
  turns: ReplTurn[];
  usage: ReplUsageSummary;
}

export interface SlashCommandContext {
  readonly state: ReplState;
  readonly cwd: string;
  readonly print: (line: string) => void;
}

export interface SlashCommandResult {
  readonly type: 'success' | 'error' | 'noop';
  readonly message?: string;
}

export interface SlashCommandDef {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly handler: (ctx: SlashCommandContext, args: string) => Promise<SlashCommandResult>;
}

function createUsageSummary(): ReplUsageSummary {
  return {
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}

export function createInitialReplState(): ReplState {
  return {
    model: 'claude-sonnet-4-6',
    mode: 'build',
    outputStyle: 'default',
    turns: [],
    usage: createUsageSummary(),
  };
}

export class SlashCommandRouter {
  private readonly commands = new Map<string, SlashCommandDef>();

  constructor(commandDefs: readonly SlashCommandDef[]) {
    for (const command of commandDefs) {
      this.commands.set(command.name, command);
      for (const alias of command.aliases ?? []) {
        this.commands.set(alias, command);
      }
    }
  }

  isSlashCommand(input: string): boolean {
    return input.trimStart().startsWith('/');
  }

  getAllCommands(): readonly SlashCommandDef[] {
    const unique = new Map<string, SlashCommandDef>();
    for (const command of this.commands.values()) {
      unique.set(command.name, command);
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async dispatch(input: string, ctx: SlashCommandContext): Promise<SlashCommandResult> {
    const trimmed = input.trim();
    if (!this.isSlashCommand(trimmed)) {
      return { type: 'noop' };
    }

    const body = trimmed.slice(1).trim();
    if (!body) {
      return {
        type: 'error',
        message: '空命令。输入 /help 查看可用命令。',
      };
    }
    const [name, ...parts] = body.split(/\s+/);
    /* v8 ignore next 6 -- defensive: body is non-empty so split always yields a name */
    if (!name) {
      return {
        type: 'error',
        message: '空命令。输入 /help 查看可用命令。',
      };
    }
    const command = this.commands.get(name.toLowerCase());
    if (!command) {
      return {
        type: 'error',
        message: `未知命令 /${name}。输入 /help 查看可用命令。`,
      };
    }
    return await command.handler(ctx, parts.join(' '));
  }
}

function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}

function splitSlashArgs(input: string): readonly string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (const ch of input) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = undefined;
      } else {
        current += ch;
      }
      continue;
    }

    if ((ch === '"' || ch === "'") && current.length === 0) {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (escaping) {
    current += '\\';
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function createDefaultCommands(): readonly SlashCommandDef[] {
  return [
    {
      name: 'help',
      description: 'Show command help',
      handler: async (ctx) => {
        const commands = [
          '/help',
          '/mode [build|plan]',
          '/model [model-id]',
          '/style [default|concise|detailed|bullet|<custom-style>]',
          '/cost',
          '/tools [--crush-cmd <command>]',
          '/memory search --query <text> [--project <path>] [--limit <n>] [--db <path>]',
          '/memory open [--host <addr>] [--port <n>] [--db <path>]',
          '/plugin list',
          '/plugin <name> [args|--tool <tool> --args-json <json>]',
          '/undo',
          '/compact',
          '/init [--force]',
          '/exit',
        ];
        ctx.print(commands.join('\n'));
        return {
          type: 'success',
          message: helpText(),
        };
      },
    },
    {
      name: 'mode',
      description: 'Get or set runtime mode',
      handler: async (ctx, args) => {
        const value = args.trim();
        if (!value) {
          const modeResult = await executeCommandDetailed({
            type: 'mode',
            action: 'get',
          });
          /* v8 ignore next 3 -- defensive: executeCommandDetailed('mode') always returns mode type */
          if (modeResult.type !== 'mode') {
            throw new Error('mode command result type mismatch');
          }
          ctx.state.mode = modeResult.mode;
          ctx.print(formatCommandResultText(modeResult));
          return { type: 'success' };
        }
        if (value !== 'build' && value !== 'plan') {
          return {
            type: 'error',
            message: 'mode 仅支持 build 或 plan',
          };
        }
        const modeResult = await executeCommandDetailed({
          type: 'mode',
          action: 'set',
          value,
        });
        /* v8 ignore next 3 -- defensive: executeCommandDetailed('mode') always returns mode type */
        if (modeResult.type !== 'mode') {
          throw new Error('mode command result type mismatch');
        }
        ctx.state.mode = value;
        ctx.print(formatCommandResultText(modeResult));
        return { type: 'success' };
      },
    },
    {
      name: 'model',
      aliases: ['m'],
      description: 'Get or set model id',
      handler: async (ctx, args) => {
        const model = args.trim();
        if (!model) {
          ctx.print(`model=${ctx.state.model}`);
          return { type: 'success' };
        }
        ctx.state.model = model;
        ctx.print(`model=${ctx.state.model}`);
        return { type: 'success' };
      },
    },
    {
      name: 'style',
      description: 'Get or set assistant output style',
      handler: async (ctx, args) => {
        const style = args.trim();
        if (!style) {
          ctx.print(`style=${ctx.state.outputStyle}`);
          return { type: 'success' };
        }
        ctx.state.outputStyle = style;
        ctx.print(`style=${ctx.state.outputStyle}`);
        return { type: 'success' };
      },
    },
    {
      name: 'cost',
      description: 'Print usage and cost summary',
      handler: async (ctx) => {
        const usage = ctx.state.usage;
        ctx.print([
          `model=${ctx.state.model}`,
          `prompt_tokens=${usage.promptTokens}`,
          `completion_tokens=${usage.completionTokens}`,
          `cache_read_tokens=${usage.cacheReadTokens}`,
          `cache_write_tokens=${usage.cacheWriteTokens}`,
          `total_tokens=${usage.promptTokens + usage.completionTokens}`,
          `cost_usd=${formatUsd(usage.costUsd)}`,
        ].join('\n'));
        return { type: 'success' };
      },
    },
    {
      name: 'tools',
      description: 'List available tools and sources',
      handler: async (ctx, args) => {
        const parsedArgs = splitSlashArgs(args.trim());
        let parsed;
        try {
          parsed = parseCliArgs(['/tools', ...parsedArgs]);
        /* v8 ignore start -- defensive: /tools parsing does not throw for any args */
        } catch (error) {
          return {
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          };
        }

        if (parsed.type !== 'tools') {
          return {
            type: 'error',
            message: `不支持的 /tools 参数: ${args.trim()}`,
          };
        }
        /* v8 ignore stop */

        const result = await executeCommandDetailed(parsed);
        ctx.print(formatCommandResultText(result));
        return { type: 'success' };
      },
    },
    {
      name: 'memory',
      description: 'Search memory or open memory viewer',
      handler: async (ctx, args) => {
        const raw = args.trim();
        if (!raw) {
          return {
            type: 'error',
            message: '用法: /memory search --query <text> 或 /memory open',
          };
        }

        const parsedArgs = splitSlashArgs(raw);
        let parsed;
        try {
          parsed = parseCliArgs(['/memory', ...parsedArgs]);
        } catch (error) {
          return {
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          };
        }

        /* v8 ignore next 6 -- defensive: parseCliArgs('/memory') always returns memory type */
        if (parsed.type !== 'memory') {
          return {
            type: 'error',
            message: `不支持的 /memory 子命令: ${raw}`,
          };
        }

        const result = await executeCommandDetailed(parsed);
        ctx.print(formatCommandResultText(result));
        return { type: 'success' };
      },
    },
    {
      name: 'plugin',
      description: 'List plugins or execute plugin tool',
      handler: async (ctx, args) => {
        const raw = args.trim();
        if (!raw) {
          return {
            type: 'error',
            message: '用法: /plugin list 或 /plugin <name> <args>',
          };
        }

        const parsedArgs = splitSlashArgs(raw);
        let parsed;
        try {
          parsed = parseCliArgs(['/plugin', ...parsedArgs]);
        } catch (error) {
          return {
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          };
        }

        /* v8 ignore next 6 -- defensive: parseCliArgs('/plugin') always returns plugin-discover or plugin-exec */
        if (parsed.type !== 'plugin-discover' && parsed.type !== 'plugin-exec') {
          return {
            type: 'error',
            message: `不支持的 /plugin 子命令: ${raw}`,
          };
        }

        const hasModeFlag = parsedArgs.includes('--mode');
        const effectiveCommand =
          parsed.type === 'plugin-exec' && !hasModeFlag
            ? {
                ...parsed,
                mode: ctx.state.mode,
              }
            : parsed;

        const result = await executeCommandDetailed(effectiveCommand);
        ctx.print(formatCommandResultText(result));
        return { type: 'success' };
      },
    },
    {
      name: 'undo',
      description: 'Remove latest user/assistant turn pair',
      handler: async (ctx) => {
        if (ctx.state.turns.length < 2) {
          return {
            type: 'error',
            message: '没有可撤销的对话。',
          };
        }
        ctx.state.turns.pop();
        ctx.state.turns.pop();
        ctx.print(`remaining_turns=${ctx.state.turns.length}`);
        return { type: 'success' };
      },
    },
    {
      name: 'compact',
      description: 'Compact local turn history',
      handler: async (ctx) => {
        if (ctx.state.turns.length <= 8) {
          ctx.print(`history_compacted=false turns=${ctx.state.turns.length}`);
          return { type: 'success' };
        }
        const tail = ctx.state.turns.slice(-8);
        ctx.state.turns = [
          {
            role: 'assistant',
            content: `[compact-summary] dropped=${ctx.state.turns.length - tail.length}`,
          },
          ...tail,
        ];
        ctx.print(`history_compacted=true turns=${ctx.state.turns.length}`);
        return { type: 'success' };
      },
    },
    {
      name: 'init',
      description: 'Initialize local .xifan/XIFAN.md',
      handler: async (ctx, args) => {
        const force = args.includes('--force');
        const result = await executeCommandDetailed({
          type: 'context',
          action: 'init',
          cwd: ctx.cwd,
          force,
        });
        ctx.print(formatCommandResultText(result));
        return { type: 'success' };
      },
    },
  ];
}

export function createDefaultSlashRouter(): SlashCommandRouter {
  return new SlashCommandRouter(createDefaultCommands());
}

export function updateUsageSummary(state: ReplState, input: {
  readonly userText: string;
  readonly assistantText: string;
}): void {
  const promptTokens = estimateTextTokens(input.userText);
  const completionTokens = estimateTextTokens(input.assistantText);
  state.usage.promptTokens += promptTokens;
  state.usage.completionTokens += completionTokens;
  state.usage.costUsd += estimateCost(state.model, {
    promptTokens,
    completionTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}
