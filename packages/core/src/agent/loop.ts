import type { ILLMDriver, LLMMessage, LLMRequest, LLMResponse, LLMTool, ToolCall } from '../llm/index.js';
import type { ToolExecutionResult } from '../tools/dispatcher.js';

import {
  buildAgentContext,
  type AgentMessage,
  type HistoryCompressionOptions,
  type OutputStylePreset,
} from './context-builder.js';

export interface AgentLoopOptions {
  readonly model: string;
  readonly maxRounds?: number;
  readonly systemPrompt?: string;
  readonly xifanContext?: string;
  readonly outputStyle?: OutputStylePreset | string;
  readonly history?: readonly AgentMessage[];
  readonly historyCompression?: HistoryCompressionOptions;
  readonly tools?: readonly LLMTool[];
  readonly toolChoice?: LLMRequest['tool_choice'];
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface AgentLoopRunInput extends AgentLoopOptions {
  readonly userInput: string;
}

export interface AgentToolCallExecution {
  readonly callId: string;
  readonly toolName: string;
  readonly rawArguments: string;
  readonly parsedArguments: unknown;
  readonly output: unknown;
  readonly durationMs: number;
}

export interface AgentLoopRunResult {
  readonly status: 'completed' | 'max_rounds';
  readonly rounds: number;
  readonly assistantText: string;
  readonly messages: readonly LLMMessage[];
  readonly toolCalls: readonly AgentToolCallExecution[];
  readonly lastResponse: LLMResponse;
}

export interface AgentLoopDeps {
  readonly llmDriver: Pick<ILLMDriver, 'chat'>;
  readonly executeTool: (toolName: string, args: unknown) => Promise<ToolExecutionResult>;
}

function toLlmMessages(messages: readonly AgentMessage[]): LLMMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    name: message.name,
  }));
}

function parseToolArguments(raw: string): unknown {
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  return JSON.stringify(output);
}

function messageContentToText(content: LLMMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function buildInitialMessages(input: AgentLoopRunInput): LLMMessage[] {
  const context = buildAgentContext({
    systemPrompt: input.systemPrompt,
    history: input.history,
    historyCompression: input.historyCompression,
    userInput: input.userInput,
    xifanContext: input.xifanContext,
    outputStyle: input.outputStyle,
  });
  return toLlmMessages(context.messages);
}

function buildRequest(
  input: AgentLoopRunInput,
  messages: readonly LLMMessage[],
): LLMRequest {
  return {
    model: input.model,
    // Snapshot message list for this round to avoid later mutation side effects.
    messages: [...messages],
    tools: input.tools,
    tool_choice: input.toolChoice,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
  };
}

function addToolResultMessage(
  messages: LLMMessage[],
  toolCall: ToolCall,
  toolName: string,
  output: unknown,
): void {
  messages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    name: toolName,
    content: stringifyToolOutput(output),
  });
}

export class AgentLoop {
  private readonly deps: AgentLoopDeps;

  constructor(deps: AgentLoopDeps) {
    this.deps = deps;
  }

  async run(input: AgentLoopRunInput): Promise<AgentLoopRunResult> {
    const maxRounds = input.maxRounds ?? 50;
    const messages = buildInitialMessages(input);
    const executedToolCalls: AgentToolCallExecution[] = [];
    let rounds = 0;
    let lastResponse: LLMResponse | undefined;

    while (rounds < maxRounds) {
      rounds += 1;
      const request = buildRequest(input, messages);
      const response = await this.deps.llmDriver.chat(request);
      lastResponse = response;
      messages.push(response.message);

      const toolCalls = response.message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        return {
          status: 'completed',
          rounds,
          assistantText: messageContentToText(response.message.content),
          messages,
          toolCalls: executedToolCalls,
          lastResponse: response,
        };
      }

      for (const toolCall of toolCalls) {
        const parsedArguments = parseToolArguments(toolCall.function.arguments);
        const executed = await this.deps.executeTool(toolCall.function.name, parsedArguments);
        executedToolCalls.push({
          callId: toolCall.id,
          toolName: toolCall.function.name,
          rawArguments: toolCall.function.arguments,
          parsedArguments,
          output: executed.output,
          durationMs: executed.durationMs,
        });
        addToolResultMessage(messages, toolCall, toolCall.function.name, executed.output);
      }
    }

    /* v8 ignore next 3 -- defensive guard: maxRounds >= 1 ensures at least one response */
    if (!lastResponse) {
      throw new Error('Agent loop exited without an LLM response');
    }
    return {
      status: 'max_rounds',
      rounds,
      assistantText: messageContentToText(lastResponse.message.content),
      messages,
      toolCalls: executedToolCalls,
      lastResponse,
    };
  }
}
