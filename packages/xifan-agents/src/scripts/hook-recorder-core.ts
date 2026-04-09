export interface HookPayload {
  readonly eventType: 'tool_call' | 'session_end';
  readonly toolName?: string;
  readonly toolInput?: unknown;
  readonly toolResponse?: unknown;
}

export function parseHookPayload(raw: string): HookPayload {
  const data = JSON.parse(raw) as {
    hook_event_name?: string;
    tool_name?: string;
    tool_input?: unknown;
    tool_response?: unknown;
  };

  if (data.hook_event_name === 'Stop') {
    return { eventType: 'session_end' };
  }

  return {
    eventType: 'tool_call',
    toolName: data.tool_name,
    toolInput: data.tool_input,
    toolResponse: data.tool_response,
  };
}

export interface EventBody {
  readonly sessionId: string;
  readonly eventType: 'tool_call' | 'session_end';
  readonly toolName?: string;
  readonly payload?: { input?: unknown; response?: unknown };
  readonly cwd?: string;
  readonly model?: string;
}

export async function sendEvent(
  apiUrl: string,
  apiKey: string | undefined,
  body: EventBody,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  const res = await fetch(`${apiUrl}/api/v1/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Memory API returned ${res.status}`);
  }
}
