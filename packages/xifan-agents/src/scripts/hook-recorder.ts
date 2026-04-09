#!/usr/bin/env node
/**
 * hook-recorder.ts — Claude Code PostToolUse / Stop hook entry point
 *
 * Invoked by Claude Code after each tool call. Reads JSON payload from stdin,
 * then forwards the event to the XiFan-Agents Memory API via HTTP.
 *
 * Environment variables:
 *   XIFAN_AGENTS_API_URL   Memory API base URL, e.g. http://localhost:8090 (required)
 *   XIFAN_AGENTS_API_KEY   Bearer token for Memory API auth (optional)
 *   XIFAN_EVENT_TYPE       Set to "session_end" for Stop hook (optional)
 */

import { sendEvent } from './hook-recorder-core.js';

interface RawHookInput {
  readonly session_id?: string;
  readonly hook_event_name?: string;
  readonly tool_name?: string;
  readonly tool_input?: unknown;
  readonly tool_response?: unknown;
  readonly cwd?: string;
  readonly model?: string;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf.trim()));
    process.stdin.on('error', () => resolve(''));
  });
}

async function main(): Promise<void> {
  const apiUrl = process.env['XIFAN_AGENTS_API_URL'];
  if (!apiUrl) {
    // Not configured — silently exit, never block Claude Code
    process.exit(0);
  }

  const apiKey = process.env['XIFAN_AGENTS_API_KEY'];

  const raw = await readStdin();
  if (!raw) process.exit(0);

  let input: RawHookInput;
  try {
    input = JSON.parse(raw) as RawHookInput;
  } catch {
    process.exit(0);
  }

  const sessionId = input.session_id;
  if (!sessionId) process.exit(0);

  const isSessionEnd =
    process.env['XIFAN_EVENT_TYPE'] === 'session_end' ||
    input.hook_event_name === 'Stop';

  try {
    await sendEvent(apiUrl, apiKey, {
      sessionId,
      eventType: isSessionEnd ? 'session_end' : 'tool_call',
      toolName: isSessionEnd ? undefined : input.tool_name,
      payload: isSessionEnd
        ? undefined
        : { input: input.tool_input, response: input.tool_response },
      cwd: input.cwd,
      model: input.model,
    });
  } catch {
    // Silent failure — never block Claude Code
  }
}

main().catch(() => {});
