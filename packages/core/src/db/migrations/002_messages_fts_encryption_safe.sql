-- Rebuild FTS triggers to tolerate encrypted/non-JSON content.

DROP TRIGGER IF EXISTS messages_fts_insert;
DROP TRIGGER IF EXISTS messages_fts_delete;
DROP TRIGGER IF EXISTS messages_fts_update;

CREATE TRIGGER IF NOT EXISTS messages_fts_insert
  AFTER INSERT ON messages
  WHEN new.role IN ('user', 'assistant')
BEGIN
  INSERT INTO messages_fts(rowid, content)
  VALUES (
    new.rowid,
    CASE
      WHEN new.content LIKE 'enc:v1:%'
        THEN ''
      WHEN json_valid(new.content) AND json_type(new.content) = 'array'
        THEN (
          SELECT COALESCE(group_concat(json_extract(value, '$.text'), ' '), '')
          FROM json_each(new.content)
          WHERE json_extract(value, '$.type') = 'text'
        )
      WHEN json_valid(new.content)
        THEN COALESCE(json_extract(new.content, '$'), '')
      ELSE COALESCE(new.content, '')
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
      WHEN new.content LIKE 'enc:v1:%'
        THEN ''
      WHEN json_valid(new.content) AND json_type(new.content) = 'array'
        THEN (
          SELECT COALESCE(group_concat(json_extract(value, '$.text'), ' '), '')
          FROM json_each(new.content)
          WHERE json_extract(value, '$.type') = 'text'
        )
      WHEN json_valid(new.content)
        THEN COALESCE(json_extract(new.content, '$'), '')
      ELSE COALESCE(new.content, '')
    END
  );
END;
