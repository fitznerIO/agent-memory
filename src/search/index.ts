import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as sqliteVec from "sqlite-vec";
import type { MemoryConfig } from "../shared/config.ts";
import type {
  Connection,
  ConnectionType,
  HybridSearchOptions,
  InverseConnectionType,
  KnowledgeEntry,
  KnowledgeType,
  Memory,
  SearchResult,
} from "../shared/types.ts";
import { TYPE_PREFIX } from "../shared/utils.ts";
import type { ConnectionRow, IndexStats, SearchIndex } from "./types.ts";

/**
 * Row shape returned from the memories table.
 */
interface MemoryRow {
  rowid: number;
  id: string;
  file_path: string;
  content: string;
  memory_type: string;
  importance: string;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
  title: string | null;
  tags: string | null;
  source: string | null;
}

/**
 * Row shape for FTS search results joined with memories.
 */
interface FtsResultRow extends MemoryRow {
  bm25_score: number;
}

/**
 * Row shape for vector search results.
 */
interface VecResultRow {
  memory_rowid: number;
  distance: number;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    metadata: {
      id: row.id,
      title: row.title ?? "",
      type: row.memory_type as Memory["metadata"]["type"],
      tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
      importance: row.importance as Memory["metadata"]["importance"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessedAt: row.last_accessed_at,
      source: row.source ?? "",
    },
    content: row.content,
    filePath: row.file_path,
  };
}

/**
 * Split a SQL file into individual statements and execute each one.
 * Handles semicolons inside trigger bodies by tracking BEGIN/END blocks.
 */
function execSchema(db: Database, sql: string): void {
  const lines = sql.split("\n");
  let current = "";
  let inTrigger = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === "" || trimmed.startsWith("--")) {
      continue;
    }

    current += (current ? "\n" : "") + line;

    // Detect trigger BEGIN
    if (/\bBEGIN\b/i.test(trimmed) && /\bTRIGGER\b/i.test(current)) {
      inTrigger = true;
    }

    // Inside a trigger, look for END; to close it
    if (inTrigger) {
      if (/^END\s*;?\s*$/i.test(trimmed)) {
        inTrigger = false;
        db.run(current.replace(/;\s*$/, ""));
        current = "";
      }
    } else if (trimmed.endsWith(";")) {
      // Regular statement ending with semicolon
      db.run(current.replace(/;\s*$/, ""));
      current = "";
    }
  }

  // Handle any remaining statement without trailing semicolon
  if (current.trim().length > 0) {
    db.run(current.trim().replace(/;\s*$/, ""));
  }
}

let sqliteConfigured = false;

function ensureCustomSQLite(): void {
  if (!sqliteConfigured && process.platform === "darwin") {
    try {
      Database.setCustomSQLite("/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib");
    } catch {
      // Already configured (e.g., by test helper)
    }
  }
  sqliteConfigured = true;
}

function initDatabase(config: MemoryConfig): Database {
  ensureCustomSQLite();

  const db = new Database(config.sqlitePath);

  // Load sqlite-vec extension
  sqliteVec.load(db);

  // Set pragmas
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA cache_size = -64000");

  // Execute schema from file
  const schemaPath = join(dirname(import.meta.dir), "search", "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  execSchema(db, schema);

  // Add extra columns for fields not in the original schema.
  // Use try/catch since ALTER TABLE does not support IF NOT EXISTS.
  try {
    db.run("ALTER TABLE memories ADD COLUMN title TEXT DEFAULT ''");
  } catch {
    // Column already exists
  }
  try {
    db.run("ALTER TABLE memories ADD COLUMN tags TEXT DEFAULT '[]'");
  } catch {
    // Column already exists
  }
  try {
    db.run("ALTER TABLE memories ADD COLUMN source TEXT DEFAULT ''");
  } catch {
    // Column already exists
  }

  return db;
}

export function createSearchIndex(config: MemoryConfig): SearchIndex {
  const db = initDatabase(config);

  // Cached prepared statements
  const insertMemory = db.query(`
    INSERT OR REPLACE INTO memories (id, file_path, content, memory_type, importance, created_at, updated_at, last_accessed_at, title, tags, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const selectRowid = db.query<{ rowid: number }, [string]>(
    "SELECT rowid FROM memories WHERE id = ?",
  );

  const deleteVecByRowid = db.query(
    "DELETE FROM memories_vec WHERE memory_rowid = ?",
  );

  const insertVec = db.query(
    "INSERT INTO memories_vec (memory_rowid, embedding) VALUES (?, ?)",
  );

  const deleteMemory = db.query("DELETE FROM memories WHERE id = ?");

  const searchFts = db.query<FtsResultRow, [string, number]>(`
    SELECT m.*, bm25(memories_fts) AS bm25_score
    FROM memories_fts fts
    JOIN memories m ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ?
    ORDER BY bm25(memories_fts) ASC
    LIMIT ?
  `);

  const searchVec = db.query<VecResultRow, [Float32Array, number]>(`
    SELECT memory_rowid, distance
    FROM memories_vec
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `);

  const selectByRowid = db.query<MemoryRow, [number]>(
    "SELECT * FROM memories WHERE rowid = ?",
  );

  const selectAll = db.query<MemoryRow, []>("SELECT * FROM memories");

  const countDocuments = db.query<{ cnt: number }, []>(
    "SELECT COUNT(*) AS cnt FROM memories",
  );

  const countEmbeddings = db.query<{ cnt: number }, []>(
    "SELECT COUNT(*) AS cnt FROM memories_vec",
  );

  const indexMemory = db.transaction(
    (memory: Memory, embedding?: Float32Array) => {
      // Check if memory already exists (for re-indexing)
      const existing = selectRowid.get(memory.metadata.id);
      if (existing) {
        deleteVecByRowid.run(existing.rowid);
      }

      // INSERT OR REPLACE into memories
      insertMemory.run(
        memory.metadata.id,
        memory.filePath,
        memory.content,
        memory.metadata.type,
        memory.metadata.importance,
        memory.metadata.createdAt,
        memory.metadata.updatedAt,
        memory.metadata.lastAccessedAt,
        memory.metadata.title,
        JSON.stringify(memory.metadata.tags),
        memory.metadata.source,
      );

      // Get the rowid for the vec table
      const row = selectRowid.get(memory.metadata.id);
      if (!row) {
        throw new Error(
          `Failed to retrieve rowid for memory ${memory.metadata.id}`,
        );
      }

      // Insert embedding if provided
      if (embedding) {
        insertVec.run(row.rowid, embedding);
      }
    },
  );

  const removeMemory = db.transaction((id: string) => {
    const existing = selectRowid.get(id);
    if (existing) {
      deleteVecByRowid.run(existing.rowid);
    }
    deleteMemory.run(id);
  });

  // -- v2-lite: Knowledge prepared statements ---------------------------------

  const insertKnowledge = db.query(`
    INSERT OR REPLACE INTO knowledge (id, title, type, file_path, created_at, updated_at, last_accessed, access_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const selectKnowledge = db.query<
    {
      id: string;
      title: string;
      type: string;
      file_path: string;
      created_at: string;
      updated_at: string;
      last_accessed: string | null;
      access_count: number;
    },
    [string]
  >("SELECT * FROM knowledge WHERE id = ?");

  const deleteKnowledge = db.query("DELETE FROM knowledge WHERE id = ?");

  const selectMaxIdForType = db.query<{ max_id: string | null }, [string]>(
    "SELECT MAX(id) as max_id FROM knowledge WHERE type = ?",
  );

  // -- v2-lite: Tag prepared statements ---------------------------------------

  const insertTag = db.query(
    "INSERT OR IGNORE INTO entry_tags (entry_id, tag) VALUES (?, ?)",
  );

  const deleteTags = db.query("DELETE FROM entry_tags WHERE entry_id = ?");

  const selectAllTags = db.query<{ tag: string }, []>(
    "SELECT DISTINCT tag FROM entry_tags ORDER BY tag",
  );

  const selectTagsByEntry = db.query<{ tag: string }, [string]>(
    "SELECT tag FROM entry_tags WHERE entry_id = ? ORDER BY tag",
  );

  // -- v2-lite: Connection prepared statements --------------------------------

  const insertConn = db.query(`
    INSERT OR REPLACE INTO connections (source_id, target_id, type, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const deleteConnByEntry = db.query(
    "DELETE FROM connections WHERE source_id = ? OR target_id = ?",
  );

  const selectConnOutgoing = db.query<ConnectionRow, [string]>(
    "SELECT * FROM connections WHERE source_id = ?",
  );

  const selectConnIncoming = db.query<ConnectionRow, [string]>(
    "SELECT * FROM connections WHERE target_id = ?",
  );

  const selectConnBoth = db.query<ConnectionRow, [string, string]>(
    "SELECT * FROM connections WHERE source_id = ? OR target_id = ?",
  );

  const selectConnCount = db.query<{ cnt: number }, [string, string]>(
    "SELECT COUNT(*) as cnt FROM connections WHERE source_id = ? OR target_id = ?",
  );

  // PRD 10.2: Decay connection-awareness — exclude supersedes/superseded_by
  const selectActiveConnCount = db.query<{ cnt: number }, [string, string]>(
    "SELECT COUNT(*) as cnt FROM connections WHERE (source_id = ? OR target_id = ?) AND type NOT IN ('supersedes', 'superseded_by')",
  );

  // -- v2-lite: ID helpers ------------------------------------------------------

  function parseSequentialNumber(id: string): number {
    const match = id.match(/-(\d+)$/);
    const numStr = match?.[1];
    return numStr ? Number.parseInt(numStr, 10) : 0;
  }

  return {
    async index(memory: Memory): Promise<void> {
      // Extract embedding from memory if it is attached (duck typing)
      const memoryWithEmbed = memory as Memory & { embedding?: Float32Array };
      indexMemory(memory, memoryWithEmbed.embedding);
    },

    async remove(id: string): Promise<void> {
      removeMemory(id);
    },

    async searchText(query: string, limit?: number): Promise<SearchResult[]> {
      const effectiveLimit = limit ?? config.hybridDefaults.limit;
      const rows = searchFts.all(query, effectiveLimit);
      return rows.map((row) => ({
        memory: rowToMemory(row),
        score: -row.bm25_score, // Negate: bm25() returns negative, more negative = better
        matchType: "fts" as const,
        source: "fts5",
        storeSource: "project" as const,
      }));
    },

    async searchVector(
      vector: Float32Array,
      limit?: number,
    ): Promise<SearchResult[]> {
      const effectiveLimit = limit ?? config.hybridDefaults.limit;
      const vecRows = searchVec.all(vector, effectiveLimit);

      const results: SearchResult[] = [];
      for (const vecRow of vecRows) {
        const memRow = selectByRowid.get(vecRow.memory_rowid);
        if (memRow) {
          results.push({
            memory: rowToMemory(memRow),
            score: 1 - vecRow.distance, // cosine distance 0..2 -> similarity 1..-1
            matchType: "vector" as const,
            source: "sqlite-vec",
            storeSource: "project" as const,
          });
        }
      }
      return results;
    },

    async searchHybrid(
      query: string,
      vector: Float32Array,
      options?: Partial<HybridSearchOptions>,
    ): Promise<SearchResult[]> {
      const opts: HybridSearchOptions = {
        ...config.hybridDefaults,
        ...options,
      };

      // Fetch a larger pool to ensure we have enough after RRF merge
      const poolSize = opts.limit * 3;

      const ftsResults = await this.searchText(query, poolSize);
      const vecResults = await this.searchVector(vector, poolSize);

      // Build rank maps (1-indexed)
      const ftsRanks = new Map<
        string,
        { rank: number; result: SearchResult }
      >();
      ftsResults.forEach((r, i) => {
        ftsRanks.set(r.memory.metadata.id, { rank: i + 1, result: r });
      });

      const vecRanks = new Map<
        string,
        { rank: number; result: SearchResult }
      >();
      vecResults.forEach((r, i) => {
        vecRanks.set(r.memory.metadata.id, { rank: i + 1, result: r });
      });

      // Collect all unique memory IDs
      const allIds = new Set<string>([...ftsRanks.keys(), ...vecRanks.keys()]);

      // Max ranks for fallback (documents not found in one result set)
      const maxFtsRank = ftsResults.length + 1;
      const maxVecRank = vecResults.length + 1;

      const now = Date.now();
      const k = opts.rrfK;

      const scored: Array<{ id: string; score: number; memory: Memory }> = [];

      for (const id of allIds) {
        const ftsEntry = ftsRanks.get(id);
        const vecEntry = vecRanks.get(id);

        const rankFts = ftsEntry ? ftsEntry.rank : maxFtsRank;
        const rankVec = vecEntry ? vecEntry.rank : maxVecRank;

        const memory = (ftsEntry?.result.memory ??
          vecEntry?.result.memory) as Memory;

        // RRF score
        let score =
          opts.weightFts * (1 / (k + rankFts)) +
          opts.weightVector * (1 / (k + rankVec));

        // Recency boost
        const daysSinceUpdate =
          (now - memory.metadata.updatedAt) / (1000 * 60 * 60 * 24);
        const recencyFactor = 1 / (1 + daysSinceUpdate / 365);
        score += opts.weightRecency * recencyFactor;

        scored.push({ id, score, memory });
      }

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // Filter by minScore and limit
      return scored
        .filter((s) => s.score >= opts.minScore)
        .slice(0, opts.limit)
        .map((s) => ({
          memory: s.memory,
          score: s.score,
          matchType: "hybrid" as const,
          source: "hybrid-rrf",
          storeSource: "project" as const,
        }));
    },

    async rebuild(): Promise<IndexStats> {
      // Get all existing memories before dropping tables
      const allMemories = selectAll.all();

      // Drop and recreate FTS
      db.run("DROP TABLE IF EXISTS memories_fts");
      db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          content,
          content='memories',
          content_rowid='rowid',
          tokenize='porter unicode61'
        )
      `);

      // Recreate FTS triggers
      db.run("DROP TRIGGER IF EXISTS memories_ai");
      db.run("DROP TRIGGER IF EXISTS memories_ad");
      db.run("DROP TRIGGER IF EXISTS memories_au");
      db.run(`
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
        END
      `);
      db.run(`
        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        END
      `);
      db.run(`
        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
          INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
        END
      `);

      // Re-populate FTS from all memories
      for (const row of allMemories) {
        db.run("INSERT INTO memories_fts(rowid, content) VALUES (?, ?)", [
          row.rowid,
          row.content,
        ]);
      }

      // Drop and recreate vec table
      db.run("DROP TABLE IF EXISTS memories_vec");
      db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
          memory_rowid INTEGER PRIMARY KEY,
          embedding float[${config.embeddingDimensions}]
        )
      `);

      // Note: embeddings cannot be rebuilt from stored data alone
      // (would need re-embedding). Total embeddings will be 0 after rebuild.

      const docCount = countDocuments.get();
      return {
        totalDocuments: docCount?.cnt ?? 0,
        totalEmbeddings: 0,
        lastRebuilt: Date.now(),
      };
    },

    close(): void {
      db.close();
    },

    // -- v2-lite: Knowledge operations ----------------------------------------

    async indexKnowledge(
      entry: Omit<KnowledgeEntry, "connections">,
    ): Promise<void> {
      insertKnowledge.run(
        entry.id,
        entry.title,
        entry.type,
        entry.filePath,
        entry.createdAt,
        entry.updatedAt,
        entry.lastAccessed ?? null,
        entry.accessCount,
      );
    },

    async removeKnowledge(id: string): Promise<void> {
      deleteTags.run(id);
      deleteConnByEntry.run(id, id);
      deleteKnowledge.run(id);
    },

    async getKnowledgeById(id: string): Promise<KnowledgeEntry | null> {
      const row = selectKnowledge.get(id);
      if (!row) return null;

      const tags = selectTagsByEntry.all(id).map((r) => r.tag);
      const connRows = selectConnBoth.all(id, id);
      const connections: Connection[] = connRows.map((c) => ({
        target: c.source_id === id ? c.target_id : c.source_id,
        type: c.type as Connection["type"],
        note: c.note ?? undefined,
      }));

      return {
        id: row.id,
        title: row.title,
        type: row.type as KnowledgeType,
        filePath: row.file_path,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastAccessed: row.last_accessed ?? undefined,
        accessCount: row.access_count,
        tags,
        connections,
      };
    },

    async getNextSequentialId(type: KnowledgeType): Promise<string> {
      const prefix = TYPE_PREFIX[type] ?? type;
      const row = selectMaxIdForType.get(type);

      if (!row?.max_id) {
        return `${prefix}-001`;
      }

      const currentMax = parseSequentialNumber(row.max_id);
      const next = currentMax + 1;
      return `${prefix}-${String(next).padStart(3, "0")}`;
    },

    // -- v2-lite: Tag operations ----------------------------------------------

    async insertTags(entryId: string, tags: string[]): Promise<void> {
      for (const tag of tags) {
        insertTag.run(entryId, tag.toLowerCase());
      }
    },

    async removeTags(entryId: string): Promise<void> {
      deleteTags.run(entryId);
    },

    async getExistingTags(): Promise<string[]> {
      return selectAllTags.all().map((r) => r.tag);
    },

    async getTagsByEntryId(entryId: string): Promise<string[]> {
      return selectTagsByEntry.all(entryId).map((r) => r.tag);
    },

    // -- v2-lite: Connection operations ---------------------------------------

    async insertConnection(
      sourceId: string,
      targetId: string,
      type: ConnectionType | InverseConnectionType,
      note?: string,
    ): Promise<void> {
      const now = new Date().toISOString();
      insertConn.run(sourceId, targetId, type, note ?? null, now);
    },

    async removeConnections(entryId: string): Promise<void> {
      deleteConnByEntry.run(entryId, entryId);
    },

    async getConnections(
      id: string,
      direction: "outgoing" | "incoming" | "both",
      types?: ConnectionType[],
    ): Promise<ConnectionRow[]> {
      let rows: ConnectionRow[];
      switch (direction) {
        case "outgoing":
          rows = selectConnOutgoing.all(id);
          break;
        case "incoming":
          rows = selectConnIncoming.all(id);
          break;
        case "both":
          rows = selectConnBoth.all(id, id);
          break;
      }

      if (types && types.length > 0) {
        const typeSet = new Set<string>(types);
        rows = rows.filter((r) => typeSet.has(r.type));
      }

      return rows;
    },

    async getConnectionCount(id: string): Promise<number> {
      const row = selectConnCount.get(id, id);
      return row?.cnt ?? 0;
    },

    async getActiveConnectionCount(id: string): Promise<number> {
      const row = selectActiveConnCount.get(id, id);
      return row?.cnt ?? 0;
    },

    async getEntriesByTags(tags: string[]): Promise<string[]> {
      if (tags.length === 0) return [];

      // Build query with hierarchical LIKE matching per tag
      // Each tag "tech/ai" matches exact "tech/ai" or prefix "tech/ai/%"
      const conditions = tags.map(
        () => "(tag = ? OR tag LIKE ? ESCAPE '\\')",
      );
      const params: string[] = [];
      for (const tag of tags) {
        const normalized = tag.toLowerCase().replace(/\/+$/, "");
        params.push(normalized);
        params.push(`${normalized}/%`);
      }

      const sql = `SELECT DISTINCT entry_id FROM entry_tags WHERE ${conditions.join(" OR ")}`;
      const rows = db.query<{ entry_id: string }, string[]>(sql).all(...params);
      return rows.map((r) => r.entry_id);
    },

    async getConnectedEntryIds(id: string): Promise<string[]> {
      const rows = selectConnBoth.all(id, id);
      const ids = new Set<string>();
      for (const row of rows) {
        if (row.source_id === id) ids.add(row.target_id);
        else ids.add(row.source_id);
      }
      return [...ids];
    },
  };
}
