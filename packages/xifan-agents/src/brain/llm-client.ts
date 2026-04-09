const LITELLM_BASE = process.env['LITELLM_BASE_URL'] ?? 'http://localhost:4000';
const LITELLM_KEY  = process.env['LITELLM_API_KEY']  ?? '';

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ChatCompletionInput {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly timeoutMs?: number;
}

export interface ChatCompletionResult {
  readonly content: string;
  readonly usage: { readonly promptTokens: number; readonly completionTokens: number };
}

export async function chatCompletion(input: ChatCompletionInput): Promise<ChatCompletionResult> {
  const controller = new AbortController();
  const timeout = input.timeoutMs ?? 30_000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException('The operation was aborted due to timeout.', 'AbortError'));
    }, timeout);
    if (typeof timer === 'object' && 'unref' in timer) {
      (timer as NodeJS.Timeout).unref();
    }
  });

  try {
  const fetchPromise = fetch(`${LITELLM_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LITELLM_KEY}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      max_tokens: input.maxTokens ?? 2000,
      temperature: input.temperature ?? 0.3,
    }),
    signal: controller.signal,
  });

  const res = await Promise.race([fetchPromise, timeoutPromise]);

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`LLM API error ${res.status}: ${msg}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const content = data.choices[0]?.message.content;
  if (!content) throw new Error('No response from LLM');

  return {
    content,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    },
  };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
