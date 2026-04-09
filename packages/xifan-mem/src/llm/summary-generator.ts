import type { CreateSessionSummaryInput } from '../types.js';
import { stripPrivateTags } from '../privacy/privacy-filter.js';
import { SUMMARY_SYSTEM_PROMPT } from './prompts.js';
import { parseSummaryXml } from './xml-parser.js';
import type { QueueLLMDriver } from './observation-generator.js';

export interface GenerateSummaryInput {
  readonly id: string;
  readonly memSessionId: string;
  readonly project: string;
  readonly sourceText: string;
}

export interface SummaryGeneratorOptions {
  readonly model?: string;
}

interface QueueLLMTextContentPart {
  readonly type: 'text';
  readonly text: string;
}

function readMessageText(
  content: string | readonly QueueLLMTextContentPart[] | null,
): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => part.text).join('');
  }
  return '';
}

export class SummaryGenerator {
  private readonly driver: QueueLLMDriver;
  private readonly model: string;

  constructor(driver: QueueLLMDriver, options: SummaryGeneratorOptions = {}) {
    this.driver = driver;
    this.model = options.model ?? 'claude-3-5-haiku-latest';
  }

  async generate(input: GenerateSummaryInput): Promise<CreateSessionSummaryInput | undefined> {
    const safeText = stripPrivateTags(input.sourceText);
    const response = await this.driver.chat({
      model: this.model,
      temperature: 0.1,
      maxTokens: 900,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: safeText },
      ],
    });

    const xml = readMessageText(response.message.content);
    const parsed = parseSummaryXml(xml);
    if (parsed.skipSummary) {
      return undefined;
    }

    return {
      id: input.id,
      memSessionId: input.memSessionId,
      request: parsed.request,
      investigated: parsed.investigated,
      learned: parsed.learned,
      completed: parsed.completed,
      nextSteps: parsed.nextSteps,
      notes: parsed.notes,
      filesRead: parsed.filesRead,
      filesEdited: parsed.filesEdited,
      project: input.project,
    };
  }
}
