import type { CreateObservationInput, ObservationType } from '../types.js';
import { stripPrivateTags } from '../privacy/privacy-filter.js';
import { OBSERVATION_SYSTEM_PROMPT } from './prompts.js';
import { parseObservationXml } from './xml-parser.js';

type QueueLLMRole = 'system' | 'user' | 'assistant';

interface QueueLLMMessage {
  readonly role: QueueLLMRole;
  readonly content: string | null;
}

interface QueueLLMRequest {
  readonly model: string;
  readonly messages: readonly QueueLLMMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
}

interface QueueLLMResponse {
  readonly message: {
    readonly content: string | readonly { readonly type: 'text'; readonly text: string }[] | null;
  };
}

export interface QueueLLMDriver {
  chat(request: QueueLLMRequest): Promise<QueueLLMResponse>;
}

export interface GenerateObservationInput {
  readonly id: string;
  readonly memSessionId: string;
  readonly project: string;
  readonly promptNumber: number;
  readonly sourceText: string;
}

export interface ObservationGeneratorOptions {
  readonly model?: string;
}

const VALID_OBSERVATION_TYPES = new Set<ObservationType>([
  'decision',
  'bugfix',
  'feature',
  'refactor',
  'discovery',
  'change',
]);

function readMessageText(content: QueueLLMResponse['message']['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
  }
  return '';
}

export class ObservationGenerator {
  private readonly driver: QueueLLMDriver;
  private readonly model: string;

  constructor(driver: QueueLLMDriver, options: ObservationGeneratorOptions = {}) {
    this.driver = driver;
    this.model = options.model ?? 'claude-3-5-haiku-latest';
  }

  async generate(input: GenerateObservationInput): Promise<CreateObservationInput> {
    const safeText = stripPrivateTags(input.sourceText);
    const response = await this.driver.chat({
      model: this.model,
      temperature: 0.1,
      maxTokens: 800,
      messages: [
        { role: 'system', content: OBSERVATION_SYSTEM_PROMPT },
        { role: 'user', content: safeText },
      ],
    });

    const xml = readMessageText(response.message.content);
    const parsed = parseObservationXml(xml);
    if (!VALID_OBSERVATION_TYPES.has(parsed.type as ObservationType)) {
      throw new Error(`invalid_observation_type_${parsed.type}`);
    }

    return {
      id: input.id,
      memSessionId: input.memSessionId,
      type: parsed.type as ObservationType,
      title: parsed.title,
      subtitle: parsed.subtitle,
      narrative: parsed.narrative,
      facts: parsed.facts,
      concepts: parsed.concepts,
      filesRead: parsed.filesRead,
      filesModified: parsed.filesModified,
      project: input.project,
      promptNumber: input.promptNumber,
    };
  }
}
