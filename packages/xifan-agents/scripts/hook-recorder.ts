#!/usr/bin/env node
/**
 * Claude Code Hook Recorder
 * 部署：cp dist/scripts/hook-recorder.js ~/.xifan/coder/hook-recorder.js
 * 配置：Agent hooks (PostToolUse + Stop)
 */
import { Pool } from 'pg';
import { parseHookPayload } from '../src/scripts/hook-recorder-core.js';

const DB_URL = process.env['XIFAN_DB_URL'] ?? process.env['DATABASE_URL'];
if (!DB_URL) process.exit(0); // no DB configured, skip silently

const pool = new Pool({ connectionString: DB_URL, max: 2 });
const SESSION_FILE = `${process.env['HOME']}/.xifan/coder/cc-session-id`;

async function getCurrentSessionId(): Promise<string | undefined> {
  const { readFileSync } = await import('node:fs');
  try { return readFileSync(SESSION_FILE, 'utf8').trim(); } catch { return undefined; }
}

async function setCurrentSessionId(id: string): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const dir = `${process.env['HOME']}/.xifan`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(SESSION_FILE, id);
}

async function clearSessionId(): Promise<void> {
  const { unlinkSync } = await import('node:fs');
  try { unlinkSync(SESSION_FILE); } catch { /* ok */ }
}

async function main(): Promise<void> {
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk as string; }

  const payload = parseHookPayload(raw.trim() || '{}');

  if (payload.eventType === 'session_end') {
    const sessionId = await getCurrentSessionId();
    if (sessionId) {
      await pool.query(
        `UPDATE xifan_obs.sessions SET status='completed', completed_at=$1 WHERE id=$2`,
        [Date.now(), sessionId]
      );
      await clearSessionId();
    }
  } else {
    let sessionId = await getCurrentSessionId();
    if (!sessionId) {
      const { v4: uuidv4 } = await import('uuid');
      sessionId = uuidv4();
      await pool.query(
        `INSERT INTO xifan_obs.sessions (id, project, user_input, model, started_at)
         VALUES ($1, $2, $3, 'claude-code', $4)
         ON CONFLICT (id) DO NOTHING`,
        [sessionId, process.cwd(), 'claude-code-session', Date.now()]
      );
      await setCurrentSessionId(sessionId);
    }
    await pool.query(
      `INSERT INTO xifan_obs.events (session_id, type, tool_name, payload, ts)
       VALUES ($1, 'tool_call', $2, $3, $4)`,
      [sessionId, payload.toolName ?? 'unknown', JSON.stringify(payload.toolInput), Date.now()]
    );
  }
  await pool.end();
}

main().catch(() => process.exit(0)); // always silent fail
