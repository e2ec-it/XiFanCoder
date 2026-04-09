CREATE TABLE IF NOT EXISTS mem_sessions (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  project       TEXT NOT NULL,
  user_prompt   TEXT NOT NULL,
  status        TEXT NOT NULL
                CHECK(status IN ('active', 'completed', 'failed')),
  started_at    INTEGER NOT NULL,
  completed_at  INTEGER,
  prompt_count  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mem_sessions_project
  ON mem_sessions(project);
CREATE INDEX IF NOT EXISTS idx_mem_sessions_status
  ON mem_sessions(status);

CREATE TABLE IF NOT EXISTS observations (
  id              TEXT PRIMARY KEY,
  mem_session_id  TEXT NOT NULL REFERENCES mem_sessions(id) ON DELETE CASCADE,
  type            TEXT NOT NULL
                  CHECK(type IN ('decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change')),
  title           TEXT NOT NULL,
  subtitle        TEXT,
  narrative       TEXT NOT NULL,
  facts           TEXT NOT NULL,
  concepts        TEXT NOT NULL,
  files_read      TEXT NOT NULL,
  files_modified  TEXT NOT NULL,
  project         TEXT NOT NULL,
  prompt_number   INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observations_session
  ON observations(mem_session_id);
CREATE INDEX IF NOT EXISTS idx_observations_project
  ON observations(project, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_type
  ON observations(type);

CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  title,
  narrative,
  facts,
  concepts,
  content='observations',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS observations_fts_insert
  AFTER INSERT ON observations BEGIN
    INSERT INTO observations_fts(rowid, title, narrative, facts, concepts)
    VALUES (new.rowid, new.title, new.narrative, new.facts, new.concepts);
  END;

CREATE TRIGGER IF NOT EXISTS observations_fts_delete
  AFTER DELETE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, title, narrative, facts, concepts)
    VALUES ('delete', old.rowid, old.title, old.narrative, old.facts, old.concepts);
  END;

CREATE TRIGGER IF NOT EXISTS observations_fts_update
  AFTER UPDATE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, title, narrative, facts, concepts)
    VALUES ('delete', old.rowid, old.title, old.narrative, old.facts, old.concepts);
    INSERT INTO observations_fts(rowid, title, narrative, facts, concepts)
    VALUES (new.rowid, new.title, new.narrative, new.facts, new.concepts);
  END;

CREATE TABLE IF NOT EXISTS session_summaries (
  id              TEXT PRIMARY KEY,
  mem_session_id  TEXT NOT NULL REFERENCES mem_sessions(id) ON DELETE CASCADE,
  request         TEXT NOT NULL,
  investigated    TEXT NOT NULL,
  learned         TEXT NOT NULL,
  completed       TEXT NOT NULL,
  next_steps      TEXT NOT NULL,
  notes           TEXT,
  files_read      TEXT NOT NULL,
  files_edited    TEXT NOT NULL,
  project         TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_summaries_project
  ON session_summaries(project, created_at DESC);

CREATE TABLE IF NOT EXISTS user_prompts (
  id              TEXT PRIMARY KEY,
  mem_session_id  TEXT NOT NULL REFERENCES mem_sessions(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  project         TEXT NOT NULL,
  prompt_number   INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS user_prompts_fts USING fts5(
  content,
  content='user_prompts',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS user_prompts_fts_insert
  AFTER INSERT ON user_prompts BEGIN
    INSERT INTO user_prompts_fts(rowid, content)
    VALUES (new.rowid, new.content);
  END;

CREATE TRIGGER IF NOT EXISTS user_prompts_fts_delete
  AFTER DELETE ON user_prompts BEGIN
    INSERT INTO user_prompts_fts(user_prompts_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  END;

CREATE TRIGGER IF NOT EXISTS user_prompts_fts_update
  AFTER UPDATE ON user_prompts BEGIN
    INSERT INTO user_prompts_fts(user_prompts_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
    INSERT INTO user_prompts_fts(rowid, content)
    VALUES (new.rowid, new.content);
  END;

CREATE TABLE IF NOT EXISTS pending_queue (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL
              CHECK(type IN ('observation', 'summarize')),
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL
              CHECK(status IN ('pending', 'processing', 'done', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  claimed_at  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_queue_status
  ON pending_queue(status, created_at ASC);
