-- ==============================================================
-- XiFanCoder sessions.db — 完整 DDL
-- 存储路径：~/.xifan/coder/sessions.db
-- 引擎：SQLite 3（better-sqlite3）
-- 版本：v1.0（对应迁移 001_initial_schema）
-- ==============================================================

-- 运行时 PRAGMA（由 DatabaseManager 在连接初始化时设置，不写入此文件）
-- PRAGMA journal_mode = WAL;
-- PRAGMA foreign_keys = ON;
-- PRAGMA synchronous = NORMAL;

-- ==============================================================
-- 迁移元表
-- ==============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  applied_at INTEGER NOT NULL        -- epoch ms
);

-- ==============================================================
-- 表 1: sessions — 会话记录
-- ==============================================================

CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT    PRIMARY KEY,
  project_path     TEXT    NOT NULL,
  model            TEXT    NOT NULL,
  provider         TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'active'
                   CHECK(status IN ('active','completed','failed','archived')),
  agent_mode       TEXT    NOT NULL DEFAULT 'build'
                   CHECK(agent_mode IN ('build','plan')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  completed_at     INTEGER,
  context_snapshot TEXT,             -- JSON: ContextSnapshot（/compact 后）
  total_tokens     INTEGER NOT NULL DEFAULT 0,
  total_cost_usd   REAL    NOT NULL DEFAULT 0.0,
  message_count    INTEGER NOT NULL DEFAULT 0,
  mem_session_id   TEXT               -- xifan-mem 对应会话 ID（可为空）
);

CREATE INDEX IF NOT EXISTS idx_sessions_project
  ON sessions(project_path, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_status
  ON sessions(status, updated_at DESC);

-- ==============================================================
-- 表 2: messages — 对话消息
-- ==============================================================

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT    PRIMARY KEY,
  session_id   TEXT    NOT NULL
               REFERENCES sessions(id) ON DELETE CASCADE,
  role         TEXT    NOT NULL
               CHECK(role IN ('system','user','assistant','tool')),
  content      TEXT    NOT NULL,     -- JSON: string | ContentPart[]
  tool_calls   TEXT,                 -- JSON: LLMToolCall[]（assistant 有工具调用时）
  tool_call_id TEXT,                 -- role='tool' 时：对应 tool_use id
  tool_name    TEXT,                 -- role='tool' 时：工具名
  token_count  INTEGER,              -- 估算 token 数（可为 NULL）
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session
  ON messages(session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_messages_role
  ON messages(session_id, role);

-- ==============================================================
-- 表 3: token_usage — LLM 请求 Token 统计
-- ==============================================================

CREATE TABLE IF NOT EXISTS token_usage (
  id                 TEXT    PRIMARY KEY,
  session_id         TEXT    NOT NULL
                     REFERENCES sessions(id) ON DELETE CASCADE,
  model              TEXT    NOT NULL,
  provider           TEXT    NOT NULL,
  role               TEXT    NOT NULL
                     CHECK(role IN ('user','assistant','tool')),
  prompt_tokens      INTEGER NOT NULL DEFAULT 0,
  completion_tokens  INTEGER NOT NULL DEFAULT 0,
  total_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd           REAL    NOT NULL DEFAULT 0.0,
  tool_call_count    INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_token_usage_session
  ON token_usage(session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_token_usage_time
  ON token_usage(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_token_usage_model
  ON token_usage(model, created_at DESC);

-- ==============================================================
-- 表 4: plugin_registry — 插件注册与状态
-- ==============================================================

CREATE TABLE IF NOT EXISTS plugin_registry (
  name          TEXT    PRIMARY KEY,
  version       TEXT    NOT NULL,
  type          TEXT    NOT NULL
                CHECK(type IN ('stdio','node','python')),
  enabled       INTEGER NOT NULL DEFAULT 1
                CHECK(enabled IN (0,1)),
  manifest_json TEXT    NOT NULL,    -- JSON: 完整 PluginManifest
  status        TEXT    NOT NULL DEFAULT 'unloaded'
                CHECK(status IN ('unloaded','loading','ready','error','disabled')),
  last_error    TEXT,
  loaded_at     INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- ==============================================================
-- 表 5: session_tasks — 会话任务状态（TDD/续跑约束）
-- ==============================================================

CREATE TABLE IF NOT EXISTS session_tasks (
  id          TEXT    PRIMARY KEY,
  session_id  TEXT    NOT NULL
              REFERENCES sessions(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  status      TEXT    NOT NULL
              CHECK(status IN ('pending','in_progress','done','blocked')),
  last_reason TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_tasks_session
  ON session_tasks(session_id, updated_at DESC);

-- ==============================================================
-- 表 6: messages_fts — 消息全文搜索（FTS5 虚拟表）
-- ==============================================================

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 1'
);

-- FTS5 同步触发器（仅索引 user / assistant 消息）

CREATE TRIGGER IF NOT EXISTS messages_fts_insert
  AFTER INSERT ON messages
  WHEN new.role IN ('user', 'assistant')
BEGIN
  INSERT INTO messages_fts(rowid, content)
  VALUES (
    new.rowid,
    CASE
      WHEN json_valid(new.content) AND json_type(new.content) = 'array'
        THEN (
          SELECT COALESCE(group_concat(json_extract(value, '$.text'), ' '), '')
          FROM json_each(new.content)
          WHERE json_extract(value, '$.type') = 'text'
        )
      ELSE COALESCE(json_extract(new.content, '$'), '')
    END
  );
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_delete
  AFTER DELETE ON messages
  WHEN old.role IN ('user', 'assistant')
BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content)
  VALUES ('delete', old.rowid, '');
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_update
  AFTER UPDATE OF content ON messages
  WHEN new.role IN ('user', 'assistant')
BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content)
  VALUES ('delete', old.rowid, '');
  INSERT INTO messages_fts(rowid, content)
  VALUES (
    new.rowid,
    CASE
      WHEN json_valid(new.content) AND json_type(new.content) = 'array'
        THEN (
          SELECT COALESCE(group_concat(json_extract(value, '$.text'), ' '), '')
          FROM json_each(new.content)
          WHERE json_extract(value, '$.type') = 'text'
        )
      ELSE COALESCE(json_extract(new.content, '$'), '')
    END
  );
END;
