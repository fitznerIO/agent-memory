-- Core content table
CREATE TABLE IF NOT EXISTS memories (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  importance TEXT NOT NULL DEFAULT 'medium',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL
);

-- FTS5 full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content='memories',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- sqlite-vec vector index (384 dimensions for all-MiniLM-L6-v2)
CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
  memory_rowid INTEGER PRIMARY KEY,
  embedding float[384]
);

-- ---------------------------------------------------------------------------
-- v2-lite: Knowledge entries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS knowledge (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL,
  file_path     TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_accessed TEXT,
  access_count  INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge(updated_at);

-- v2-lite: Namespace tags

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id      TEXT NOT NULL,
  tag           TEXT NOT NULL,
  PRIMARY KEY (entry_id, tag),
  FOREIGN KEY (entry_id) REFERENCES knowledge(id)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON entry_tags(tag);

-- v2-lite: Typed connections

CREATE TABLE IF NOT EXISTS connections (
  source_id     TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  type          TEXT NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id, type),
  FOREIGN KEY (source_id) REFERENCES knowledge(id),
  FOREIGN KEY (target_id) REFERENCES knowledge(id)
);

CREATE INDEX IF NOT EXISTS idx_conn_source ON connections(source_id);
CREATE INDEX IF NOT EXISTS idx_conn_target ON connections(target_id);
CREATE INDEX IF NOT EXISTS idx_conn_type ON connections(type);
