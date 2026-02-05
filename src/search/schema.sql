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
