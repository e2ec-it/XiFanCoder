export type LLMDriverMode = 'auto' | 'builtin' | 'litellm';

export type LLMDriverSelectionReason =
  | 'forced_builtin'
  | 'forced_litellm'
  | 'auto_no_litellm'
  | 'auto_headless_fallback'
  | 'auto_prompt_unavailable'
  | 'auto_user_accepted'
  | 'auto_user_declined';

export interface ResolveLLMDriverModeOptions {
  readonly mode?: LLMDriverMode;
  readonly headless?: boolean;
  readonly litellmBaseUrl?: string;
  readonly confirmUseLiteLLM?: () => Promise<boolean>;
  readonly detectLiteLLMOnline?: (baseUrl: string, timeoutMs: number) => Promise<boolean>;
  readonly detectTimeoutMs?: number;
}

export interface ResolvedLLMDriverMode {
  readonly selectedDriver: 'builtin' | 'litellm';
  readonly reason: LLMDriverSelectionReason;
  readonly litellmDetected: boolean;
  readonly litellmBaseUrl: string;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function modelEndpointCandidates(baseUrl: string): readonly string[] {
  const normalized = stripTrailingSlash(baseUrl);

  if (normalized.endsWith('/v1')) {
    return [`${normalized}/models`];
  }

  return [`${normalized}/v1/models`, `${normalized}/models`];
}

export async function detectLiteLLMProxyOnline(
  baseUrl: string,
  timeoutMs = 1_000,
): Promise<boolean> {
  for (const endpoint of modelEndpointCandidates(baseUrl)) {
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // Ignore network errors and continue probing fallback endpoint candidates.
    }
  }

  return false;
}

export async function resolveLLMDriverMode(
  options: ResolveLLMDriverModeOptions = {},
): Promise<ResolvedLLMDriverMode> {
  const mode = options.mode ?? 'auto';
  const headless = options.headless ?? false;
  const litellmBaseUrl = options.litellmBaseUrl ?? 'http://localhost:4000';

  if (mode === 'builtin') {
    return {
      selectedDriver: 'builtin',
      reason: 'forced_builtin',
      litellmDetected: false,
      litellmBaseUrl,
    };
  }

  if (mode === 'litellm') {
    return {
      selectedDriver: 'litellm',
      reason: 'forced_litellm',
      litellmDetected: true,
      litellmBaseUrl,
    };
  }

  const detectTimeoutMs = options.detectTimeoutMs ?? 1_000;
  const detectLiteLLMOnline = options.detectLiteLLMOnline ?? detectLiteLLMProxyOnline;
  const litellmDetected = await detectLiteLLMOnline(litellmBaseUrl, detectTimeoutMs);

  if (!litellmDetected) {
    return {
      selectedDriver: 'builtin',
      reason: 'auto_no_litellm',
      litellmDetected: false,
      litellmBaseUrl,
    };
  }

  if (headless) {
    return {
      selectedDriver: 'builtin',
      reason: 'auto_headless_fallback',
      litellmDetected: true,
      litellmBaseUrl,
    };
  }

  const confirmUseLiteLLM = options.confirmUseLiteLLM;
  if (!confirmUseLiteLLM) {
    return {
      selectedDriver: 'builtin',
      reason: 'auto_prompt_unavailable',
      litellmDetected: true,
      litellmBaseUrl,
    };
  }

  const accepted = await confirmUseLiteLLM();
  if (!accepted) {
    return {
      selectedDriver: 'builtin',
      reason: 'auto_user_declined',
      litellmDetected: true,
      litellmBaseUrl,
    };
  }

  return {
    selectedDriver: 'litellm',
    reason: 'auto_user_accepted',
    litellmDetected: true,
    litellmBaseUrl,
  };
}
