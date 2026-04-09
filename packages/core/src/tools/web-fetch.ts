import { ToolExecutionError } from '../errors/tool-errors.js';

export interface WebFetchRequest {
  readonly url: string;
  readonly prompt?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

export interface WebFetchSummaryInput {
  readonly url: string;
  readonly finalUrl: string;
  readonly prompt?: string;
  readonly status: number;
  readonly contentType: string;
  readonly content: string;
}

export type WebFetchSummarizer = (
  input: WebFetchSummaryInput,
) => Promise<string> | string;

export interface WebFetchOptions {
  readonly defaultTimeoutMs?: number;
  readonly defaultMaxBytes?: number;
  readonly summarizer?: WebFetchSummarizer;
}

export interface WebFetchResult {
  readonly url: string;
  readonly finalUrl: string;
  readonly status: number;
  readonly ok: boolean;
  readonly contentType: string;
  readonly fetchedBytes: number;
  readonly truncated: boolean;
  readonly excerpt: string;
  readonly summary: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_EXCERPT_LENGTH = 1_200;

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new ToolExecutionError('web_fetch', `invalid ${name}: ${resolved}`);
  }
  return resolved;
}

function normalizeUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new ToolExecutionError('web_fetch', `invalid url: ${rawUrl}`, error);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ToolExecutionError('web_fetch', `unsupported protocol: ${parsed.protocol}`);
  }

  return parsed.toString();
}

async function readResponseBody(
  response: Response,
  maxBytes: number,
): Promise<{ content: string; fetchedBytes: number; truncated: boolean }> {
  if (!response.body) {
    return { content: '', fetchedBytes: 0, truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let fetchedBytes = 0;
  let truncated = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    const remaining = maxBytes - fetchedBytes;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    if (value.byteLength <= remaining) {
      chunks.push(value);
      fetchedBytes += value.byteLength;
      continue;
    }

    chunks.push(value.subarray(0, remaining));
    fetchedBytes += remaining;
    truncated = true;
    break;
  }

  const content = new TextDecoder().decode(
    chunks.length > 0 ? concatUint8Arrays(chunks) : new Uint8Array(),
  );

  return {
    content,
    fetchedBytes,
    truncated,
  };
}

function concatUint8Arrays(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function fallbackSummary(input: WebFetchSummaryInput): string {
  const excerpt = normalizeText(input.content).slice(0, 320);
  if (!excerpt) {
    return `Fetched ${input.finalUrl} (status ${input.status}), but response body is empty.`;
  }

  if (input.prompt && input.prompt.trim().length > 0) {
    return `Prompt: ${input.prompt.trim()}\nSummary: ${excerpt}`;
  }

  return excerpt;
}

export async function fetchWebContent(
  request: WebFetchRequest,
  options: WebFetchOptions = {},
): Promise<WebFetchResult> {
  const normalizedUrl = normalizeUrl(request.url);
  const timeoutMs = normalizePositiveInteger(
    request.timeoutMs,
    options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    'timeoutMs',
  );
  const maxBytes = normalizePositiveInteger(
    request.maxBytes,
    options.defaultMaxBytes ?? DEFAULT_MAX_BYTES,
    'maxBytes',
  );

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(normalizedUrl, {
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ToolExecutionError('web_fetch', `request failed: ${message}`, error);
  } finally {
    clearTimeout(timeoutHandle);
  }

  const { content, fetchedBytes, truncated } = await readResponseBody(response, maxBytes);
  const normalizedContent = normalizeText(content);
  const excerpt = normalizedContent.slice(0, DEFAULT_EXCERPT_LENGTH);
  const summaryInput: WebFetchSummaryInput = {
    url: normalizedUrl,
    finalUrl: response.url,
    prompt: request.prompt,
    status: response.status,
    contentType: response.headers.get('content-type') ?? 'unknown',
    content: normalizedContent,
  };

  const summary = options.summarizer
    ? await options.summarizer(summaryInput)
    : fallbackSummary(summaryInput);

  return {
    url: normalizedUrl,
    finalUrl: response.url,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type') ?? 'unknown',
    fetchedBytes,
    truncated,
    excerpt,
    summary,
  };
}
