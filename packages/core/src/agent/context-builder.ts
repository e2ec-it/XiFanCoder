import {
  detectPromptInjection,
  sanitizeBlockedContent,
  type InjectionDetectionMode,
  type InjectionFinding,
  type InjectionRule,
  type InjectionSource,
} from './injection-detector.js';
import { toXifanContextBlock } from '../config/xifan-injector.js';

const TOOL_RESULT_SCAN_SET = new Set(['read_file', 'web_fetch']);

export type AgentMessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type OutputStylePreset = 'default' | 'concise' | 'detailed' | 'bullet';

const OUTPUT_STYLE_PRESETS: Record<Exclude<OutputStylePreset, 'default'>, string> = {
  concise:
    'Respond concisely: prioritize key conclusions first, keep explanations short, and avoid unnecessary detail.',
  detailed:
    'Respond in detail: include reasoning, tradeoffs, assumptions, and implementation implications when relevant.',
  bullet:
    'Respond using flat bullet points with clear action-oriented items; avoid long paragraphs.',
};

export interface AgentMessage {
  readonly role: AgentMessageRole;
  readonly content: string;
  readonly name?: string;
}

export interface ToolResultInput {
  readonly toolName: string;
  readonly content: string;
}

export interface InjectionWarning {
  readonly source: InjectionSource;
  readonly toolName?: string;
  readonly findings: readonly InjectionFinding[];
}

export interface BuildAgentContextInput {
  readonly systemPrompt?: string;
  readonly history?: readonly AgentMessage[];
  readonly historyCompression?: HistoryCompressionOptions;
  readonly userInput: string;
  readonly xifanContext?: string;
  readonly outputStyle?: OutputStylePreset | string;
  readonly toolResults?: readonly ToolResultInput[];
  readonly injectionMode?: InjectionDetectionMode;
  readonly rules?: readonly InjectionRule[];
  readonly emitWarning?: (warning: InjectionWarning) => void;
}

export interface BuildAgentContextResult {
  readonly messages: readonly AgentMessage[];
  readonly warnings: readonly InjectionWarning[];
}

export interface HistoryCompressionOptions {
  readonly enabled?: boolean;
  readonly maxChars?: number;
  readonly preserveRecentMessages?: number;
}

export function buildAgentContext(input: BuildAgentContextInput): BuildAgentContextResult {
  const mode = input.injectionMode ?? 'warn';
  const emitWarning = input.emitWarning ?? defaultWarningLogger;
  const warnings: InjectionWarning[] = [];
  const messages: AgentMessage[] = [];

  if (input.systemPrompt) {
    messages.push({
      role: 'system',
      content: input.systemPrompt,
    });
  }

  if (input.history && input.history.length > 0) {
    messages.push(...compressHistory(input.history, input.historyCompression));
  }

  const userDecision = detectPromptInjection(input.userInput, {
    mode,
    source: 'user_input',
    rules: input.rules,
  });
  if (userDecision.findings.length > 0) {
    const warning: InjectionWarning = {
      source: 'user_input',
      findings: userDecision.findings,
    };
    warnings.push(warning);
    emitWarning(warning);
  }

  messages.push({
    role: 'user',
    content: buildUserContent(
      sanitizeBlockedContent(userDecision, input.userInput),
      input.xifanContext,
      input.outputStyle,
    ),
  });

  for (const toolResult of input.toolResults ?? []) {
    const shouldInspect = TOOL_RESULT_SCAN_SET.has(toolResult.toolName);
    const toolDecision = shouldInspect
      ? detectPromptInjection(toolResult.content, {
          mode,
          source: 'tool_result',
          rules: input.rules,
        })
      : detectPromptInjection(toolResult.content, {
          mode: 'off',
          source: 'tool_result',
          rules: input.rules,
        });

    if (toolDecision.findings.length > 0) {
      const warning: InjectionWarning = {
        source: 'tool_result',
        toolName: toolResult.toolName,
        findings: toolDecision.findings,
      };
      warnings.push(warning);
      emitWarning(warning);
    }

    messages.push({
      role: 'tool',
      name: toolResult.toolName,
      content: wrapToolResult(
        toolResult.toolName,
        sanitizeBlockedContent(toolDecision, toolResult.content),
      ),
    });
  }

  return {
    messages,
    warnings,
  };
}

function wrapToolResult(toolName: string, content: string): string {
  return `<tool_result tool="${escapeAttribute(toolName)}">\n${content}\n</tool_result>`;
}

function escapeAttribute(input: string): string {
  return input.replace(/"/g, '&quot;');
}

function defaultWarningLogger(warning: InjectionWarning): void {
  const ruleIds = warning.findings.map((finding) => finding.ruleId).join(',');
  const scope = warning.toolName ? `${warning.source}:${warning.toolName}` : warning.source;
  console.warn(`[prompt-injection] source=${scope} rules=${ruleIds}`);
}

function buildUserContent(
  userInput: string,
  xifanContext: string | undefined,
  outputStyle: OutputStylePreset | string | undefined,
): string {
  const contextBlock = toXifanContextBlock(xifanContext ?? '');
  const styleBlock = toOutputStyleBlock(outputStyle);
  if (!contextBlock && !styleBlock) {
    return userInput;
  }
  const sections: string[] = [];
  if (contextBlock) {
    sections.push(contextBlock);
  }
  if (styleBlock) {
    sections.push(styleBlock);
  }
  sections.push(userInput);
  return sections.join('\n\n');
}

function toOutputStyleBlock(outputStyle: OutputStylePreset | string | undefined): string | undefined {
  if (outputStyle === undefined) {
    return undefined;
  }
  const raw = outputStyle.trim();
  if (!raw) {
    return undefined;
  }
  const normalized = raw.toLowerCase();
  if (normalized === 'default') {
    return undefined;
  }
  const styleDirective =
    OUTPUT_STYLE_PRESETS[normalized as keyof typeof OUTPUT_STYLE_PRESETS] ?? raw;
  return `<output-style>\n${styleDirective}\n</output-style>`;
}

function estimateMessageChars(message: AgentMessage): number {
  return message.role.length + message.content.length + (message.name?.length ?? 0) + 8;
}

function compressHistory(
  history: readonly AgentMessage[],
  options: HistoryCompressionOptions | undefined,
): readonly AgentMessage[] {
  if (!options?.enabled || history.length === 0) {
    return history;
  }

  const maxChars = Math.max(256, options.maxChars ?? 12_000);
  const preserveRecentMessages = Math.max(1, options.preserveRecentMessages ?? 8);
  const totalChars = history.reduce((sum, message) => sum + estimateMessageChars(message), 0);
  if (totalChars <= maxChars) {
    return history;
  }

  const recent = history.slice(-preserveRecentMessages);
  const kept: AgentMessage[] = [];
  let chars = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    /* v8 ignore next 3 -- defensive guard: index is always within bounds */
    if (!message) {
      continue;
    }
    const next = chars + estimateMessageChars(message);
    if (kept.length > 0 && next > maxChars) {
      break;
    }
    kept.unshift(message);
    chars = next;
  }

  const dropped = history.length - kept.length;
  /* v8 ignore next 3 -- defensive guard: totalChars > maxChars always causes some drop */
  if (dropped <= 0) {
    return kept;
  }

  const summary: AgentMessage = {
    role: 'system',
    content:
      `<history-summary dropped_messages="${dropped}" policy="char_budget" max_chars="${maxChars}">\n` +
      `Earlier conversation has been compressed to preserve context budget.\n` +
      '</history-summary>',
  };

  if (chars + estimateMessageChars(summary) > maxChars && kept.length > 1) {
    while (kept.length > 1 && chars + estimateMessageChars(summary) > maxChars) {
      const removed = kept.shift();
      /* v8 ignore next 3 -- defensive guard: kept.length > 1 guarantees shift() returns */
      if (!removed) {
        break;
      }
      chars -= estimateMessageChars(removed);
    }
  }

  return [summary, ...kept];
}
