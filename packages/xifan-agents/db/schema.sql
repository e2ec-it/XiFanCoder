-- packages/xifan-agents/db/schema.sql
CREATE SCHEMA IF NOT EXISTS xifan_obs;

CREATE TABLE IF NOT EXISTS xifan_obs.sessions (
  id           TEXT    PRIMARY KEY,
  project      TEXT    NOT NULL,
  user_input   TEXT    NOT NULL,
  model        TEXT,
  status       TEXT    NOT NULL DEFAULT 'active',
  started_at   BIGINT  NOT NULL,
  completed_at BIGINT,
  rounds       INTEGER,
  tool_count   INTEGER
);

CREATE TABLE IF NOT EXISTS xifan_obs.events (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT      NOT NULL REFERENCES xifan_obs.sessions(id),
  type        TEXT      NOT NULL,
  tool_name   TEXT,
  payload     JSONB,
  duration_ms INTEGER,
  ts          BIGINT    NOT NULL
);

CREATE INDEX IF NOT EXISTS events_session_idx ON xifan_obs.events (session_id);
CREATE INDEX IF NOT EXISTS events_ts_idx ON xifan_obs.events (ts DESC);

-- Phase B: xifan_mem schema (五型记忆 + pgvector)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS xifan_mem;

CREATE TABLE IF NOT EXISTS xifan_mem.memories (
  id          TEXT    PRIMARY KEY,
  type        TEXT    NOT NULL CHECK (type IN ('episodic','semantic','procedural','emotional','reflective')),
  summary     TEXT    NOT NULL,
  payload     JSONB,
  embedding   vector(768),
  salience    FLOAT   NOT NULL DEFAULT 1.0,
  project     TEXT,
  created_at  BIGINT  NOT NULL,
  accessed_at BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS memories_hnsw_idx
  ON xifan_mem.memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS memories_type_salience_idx
  ON xifan_mem.memories (type, salience DESC);
CREATE INDEX IF NOT EXISTS memories_project_idx
  ON xifan_mem.memories (project);

-- Full-text search for BM25 hybrid retrieval
ALTER TABLE xifan_mem.memories ADD COLUMN IF NOT EXISTS
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', summary)) STORED;
CREATE INDEX IF NOT EXISTS memories_fts_idx ON xifan_mem.memories USING gin(tsv);
