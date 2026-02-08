import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createEmbeddingEngine } from "./embedding/engine.ts";
import type { EmbeddingEngine } from "./embedding/types.ts";
import { createGitManager } from "./git/manager.ts";
import type { GitManager } from "./git/types.ts";
import { parseMarkdown, serializeMarkdown } from "./memory/parser.ts";
import { createMemoryStore } from "./memory/store.ts";
import type { MemoryStore } from "./memory/types.ts";
import { createSearchIndex } from "./search/index.ts";
import type { SearchIndex } from "./search/types.ts";
export type { MemoryConfig } from "./shared/config.ts";
export { findProjectRoot } from "./shared/config.ts";

import { type MemoryConfig, createDefaultConfig } from "./shared/config.ts";
export type {
  CommitType,
  Connection,
  ConnectionType,
  Importance,
  KnowledgeEntry,
  KnowledgeType,
  Memory,
  MemoryCommitInput,
  MemoryCommitOutput,
  MemoryConnectInput,
  MemoryConnectOutput,
  MemoryForgetInput,
  MemoryForgetOutput,
  MemoryMetadata,
  MemoryNoteInput,
  MemoryNoteOutput,
  MemoryReadInput,
  MemoryReadOutput,
  MemorySearchInput,
  MemorySearchOutput,
  MemoryStoreInput,
  MemoryStoreOutput,
  MemoryTraverseInput,
  MemoryTraverseOutput,
  MemoryType,
  MemoryUpdateInput,
  MemoryUpdateOutput,
  SearchResult,
  StoreSource,
} from "./shared/types.ts";

import type {
  CommitType,
  ConnectionType,
  Memory,
  MemoryCommitInput,
  MemoryCommitOutput,
  MemoryConnectInput,
  MemoryConnectOutput,
  MemoryForgetInput,
  MemoryForgetOutput,
  MemoryNoteInput,
  MemoryNoteOutput,
  MemoryReadInput,
  MemoryReadOutput,
  MemorySearchInput,
  MemorySearchOutput,
  MemoryStoreInput,
  MemoryStoreOutput,
  MemoryTraverseInput,
  MemoryTraverseOutput,
  MemoryUpdateInput,
  MemoryUpdateOutput,
  SearchResult,
  SessionState,
} from "./shared/types.ts";

export interface MemorySystem {
  // v1 Tools API
  note(input: MemoryNoteInput): Promise<MemoryNoteOutput>;
  search(input: MemorySearchInput): Promise<MemorySearchOutput>;
  read(input: MemoryReadInput): Promise<MemoryReadOutput>;
  update(input: MemoryUpdateInput): Promise<MemoryUpdateOutput>;
  forget(input: MemoryForgetInput): Promise<MemoryForgetOutput>;
  commit(input: MemoryCommitInput): Promise<MemoryCommitOutput>;

  // v2-lite Tools API
  memoryStore(input: MemoryStoreInput): Promise<MemoryStoreOutput>;
  memoryConnect(input: MemoryConnectInput): Promise<MemoryConnectOutput>;
  memoryTraverse(input: MemoryTraverseInput): Promise<MemoryTraverseOutput>;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;

  // Project store internals
  store: MemoryStore;
  searchIndex: SearchIndex;
  git: GitManager;
  embedding: EmbeddingEngine;
  config: MemoryConfig;

  // Global store internals (present when globalDir is configured)
  globalStore?: MemoryStore;
  globalSearchIndex?: SearchIndex;
  globalGit?: GitManager;
}

/**
 * Ensure the project's .gitignore contains the memory store directory.
 * Only acts when a project .git/ exists alongside the memory store.
 */
function ensureGitignore(memoryDir: string): void {
  const projectRoot = dirname(memoryDir);
  const projectGitDir = join(projectRoot, ".git");

  // Only manage .gitignore for project repos
  if (!existsSync(projectGitDir)) return;

  const gitignorePath = join(projectRoot, ".gitignore");
  const entry = basename(memoryDir);

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    // Check if already ignored (exact line match)
    const lines = content.split("\n");
    if (
      lines.some((line) => line.trim() === entry || line.trim() === `${entry}/`)
    ) {
      return;
    }
    // Append
    const separator = content.endsWith("\n") ? "" : "\n";
    writeFileSync(
      gitignorePath,
      `${content}${separator}\n# Agent memory store\n${entry}/\n`,
    );
  } else {
    writeFileSync(gitignorePath, `# Agent memory store\n${entry}/\n`);
  }
}

// -- v2-lite helpers ----------------------------------------------------------

/** Map v2-lite KnowledgeType to directory path relative to baseDir. */
function knowledgeTypeDir(type: string): string {
  switch (type) {
    case "decision":
      return "semantic/decisions";
    case "entity":
      return "semantic/entities";
    case "incident":
      return "episodic/incidents";
    case "pattern":
      return "procedural/patterns";
    case "workflow":
      return "procedural/workflows";
    case "note":
      return "semantic/notes";
    case "session":
      return "episodic/sessions";
    default:
      return "semantic";
  }
}

/** Map v2-lite KnowledgeType to v1 MemoryType for the memories table. */
function knowledgeToMemoryType(type: string): string {
  switch (type) {
    case "decision":
    case "entity":
    case "note":
      return "semantic";
    case "incident":
    case "session":
      return "episodic";
    case "pattern":
    case "workflow":
      return "procedural";
    default:
      return "semantic";
  }
}

/** Convert title to URL-friendly slug. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => {
      const map: Record<string, string> = {
        ä: "ae",
        ö: "oe",
        ü: "ue",
        ß: "ss",
      };
      return map[c] ?? c;
    })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/** Get the inverse connection type. */
function getInverseType(type: ConnectionType): string {
  switch (type) {
    case "related":
      return "related";
    case "builds_on":
      return "extended_by";
    case "contradicts":
      return "contradicts";
    case "part_of":
      return "contains";
    case "supersedes":
      return "superseded_by";
    default:
      return "related";
  }
}

function createModuleSet(
  config: MemoryConfig,
  overridePaths?: { baseDir: string; sqlitePath: string },
) {
  const baseDir = overridePaths?.baseDir ?? config.baseDir;
  const sqlitePath = overridePaths?.sqlitePath ?? config.sqlitePath;

  mkdirSync(baseDir, { recursive: true });
  mkdirSync(dirname(sqlitePath), { recursive: true });

  const moduleConfig = { ...config, baseDir, sqlitePath };
  return {
    store: createMemoryStore(moduleConfig),
    searchIndex: createSearchIndex(moduleConfig),
    git: createGitManager(moduleConfig),
    config: moduleConfig,
  };
}

export function createMemorySystem(
  overrides?: Partial<MemoryConfig>,
): MemorySystem {
  const config = { ...createDefaultConfig(), ...overrides };

  // Create project store modules
  const project = createModuleSet(config);
  const embedding = createEmbeddingEngine(config);

  // Create global store modules if configured
  const global = config.globalDir
    ? createModuleSet(config, {
        baseDir: config.globalDir,
        sqlitePath:
          config.globalSqlitePath ??
          join(config.globalDir, ".index", "search.sqlite"),
      })
    : undefined;

  let session: SessionState | null = null;

  async function indexMemoryWithEmbedding(
    memory: Memory,
    searchIndex: SearchIndex,
  ): Promise<void> {
    const result = await embedding.embed(memory.content);
    const memoryWithEmbedding = Object.assign({}, memory, {
      embedding: result.vector,
    });
    await searchIndex.index(memoryWithEmbedding);
  }

  /**
   * Update a knowledge file's frontmatter to add a connection.
   * Looks up the file path from the knowledge table.
   */
  async function updateFrontmatterConnections(
    entryId: string,
    targetId: string,
    connType: string,
    note?: string,
  ): Promise<void> {
    const entry = await project.searchIndex.getKnowledgeById(entryId);
    if (!entry) return;

    const absPath = join(config.baseDir, entry.filePath);
    try {
      const file = Bun.file(absPath);
      if (!(await file.exists())) return;

      // parseMarkdown/serializeMarkdown imported at top level
      const raw = await file.text();
      const doc = parseMarkdown(raw);

      // Get existing connections or initialize
      const connections = (
        doc.frontmatter.connections as Array<Record<string, unknown>>
      ) ?? [];

      // Check if connection already exists
      const exists = connections.some(
        (c) =>
          c.target === targetId &&
          c.type === connType,
      );

      if (!exists) {
        const newConn: Record<string, unknown> = {
          target: targetId,
          type: connType,
        };
        if (note) newConn.note = note;
        connections.push(newConn);
        doc.frontmatter.connections = connections;
        doc.frontmatter.updated = new Date().toISOString().slice(0, 10);

        const serialized = serializeMarkdown(doc);
        writeFileSync(absPath, serialized);
      }
    } catch {
      // Best-effort: file might not exist yet during migration
    }
  }

  /**
   * Merge project and global search results.
   * Project results are preferred at equal scores.
   */
  function mergeSearchResults(
    projectResults: SearchResult[],
    globalResults: SearchResult[],
    limit: number,
  ): SearchResult[] {
    const globalTagged = globalResults.map((r) => ({
      ...r,
      storeSource: "global" as const,
    }));

    const merged = [...projectResults, ...globalTagged];

    // Deduplicate by memory ID, preferring project store
    const seen = new Set<string>();
    const deduped: SearchResult[] = [];
    for (const r of merged) {
      const id = r.memory.metadata.id;
      if (!seen.has(id)) {
        seen.add(id);
        deduped.push(r);
      }
    }

    // Sort by score descending (project wins ties due to stable sort + appearing first)
    deduped.sort((a, b) => b.score - a.score);
    return deduped.slice(0, limit);
  }

  return {
    store: project.store,
    searchIndex: project.searchIndex,
    git: project.git,
    embedding,
    config,
    globalStore: global?.store,
    globalSearchIndex: global?.searchIndex,
    globalGit: global?.git,

    async note(input: MemoryNoteInput): Promise<MemoryNoteOutput> {
      const timestamp = Date.now();

      // Create a real memory file in the store
      const title =
        input.content.length <= 60
          ? input.content
          : `${input.content.slice(0, 57)}...`;
      const tags = (input.tags ?? []).map((t) => t.toLowerCase());
      const memory = await project.store.create({
        metadata: {
          title,
          type: input.type,
          tags,
          importance: input.importance,
          source: "agent-session",
        },
        content: input.content,
        filePath: "",
      });

      // Index for search
      await indexMemoryWithEmbedding(memory, project.searchIndex);

      // Track in session state
      if (session) {
        session.notes.push({
          noteId: memory.metadata.id,
          content: input.content,
          type: input.type,
          importance: input.importance,
          timestamp,
        });
      }

      return {
        success: true,
        noteId: memory.metadata.id,
        message: `Note saved: ${input.content.slice(0, 50)}${input.content.length > 50 ? "..." : ""}`,
      };
    },

    async search(input: MemorySearchInput): Promise<MemorySearchOutput> {
      const queryEmbedding = await embedding.embed(input.query);
      const limit = input.limit ?? 5;

      // Build filter sets for v2-lite tag and connected_to filters
      let tagFilterIds: Set<string> | null = null;
      let connFilterIds: Set<string> | null = null;

      if (input.tags && input.tags.length > 0) {
        const ids = await project.searchIndex.getEntriesByTags(input.tags);
        tagFilterIds = new Set(ids);
      }

      if (input.connected_to) {
        const ids = await project.searchIndex.getConnectedEntryIds(
          input.connected_to,
        );
        connFilterIds = new Set(ids);
      }

      // Fetch more results to account for post-filtering
      const fetchLimit =
        tagFilterIds || connFilterIds ? limit * 5 : limit;

      // Search project store
      const projectResults = await project.searchIndex.searchHybrid(
        input.query,
        queryEmbedding.vector,
        { limit: fetchLimit, minScore: input.minScore ?? 0.3 },
      );

      // Search global store if available
      let rawResults: SearchResult[];
      if (global) {
        const globalResults = await global.searchIndex.searchHybrid(
          input.query,
          queryEmbedding.vector,
          { limit: fetchLimit, minScore: input.minScore ?? 0.3 },
        );
        rawResults = mergeSearchResults(projectResults, globalResults, fetchLimit);
      } else {
        rawResults = projectResults;
      }

      // Apply v2-lite filters
      let finalResults = rawResults;
      if (tagFilterIds) {
        finalResults = finalResults.filter((r) =>
          tagFilterIds.has(r.memory.metadata.id),
        );
      }
      if (connFilterIds) {
        finalResults = finalResults.filter((r) =>
          connFilterIds.has(r.memory.metadata.id),
        );
      }

      finalResults = finalResults.slice(0, limit);

      // Enrich results with v2-lite metadata
      const enrichedResults = await Promise.all(
        finalResults.map(async (r) => {
          const id = r.memory.metadata.id;
          const knowledgeEntry =
            await project.searchIndex.getKnowledgeById(id);

          return {
            content: r.memory.content,
            source: r.memory.filePath,
            score: r.score,
            type: r.memory.metadata.type,
            lastAccessed: new Date(
              r.memory.metadata.lastAccessedAt,
            ).toISOString(),
            storeSource: r.storeSource,
            // v2-lite enrichment (only if entry exists in knowledge table)
            id: knowledgeEntry?.id ?? id,
            title: knowledgeEntry?.title ?? r.memory.metadata.title,
            tags: knowledgeEntry?.tags,
            connections: knowledgeEntry?.connections,
          };
        }),
      );

      return {
        results: enrichedResults,
        totalFound: enrichedResults.length,
      };
    },

    async read(input: MemoryReadInput): Promise<MemoryReadOutput> {
      let memory: Memory;
      try {
        memory = await project.store.readByPath(input.path);
      } catch {
        // Fall back to global store if available
        if (!global) throw new Error(`Memory not found: ${input.path}`);
        memory = await global.store.readByPath(input.path);
      }

      return {
        content: memory.content,
        lastModified: new Date(memory.metadata.updatedAt).toISOString(),
        wordCount: memory.content.split(/\s+/).filter(Boolean).length,
      };
    },

    async update(input: MemoryUpdateInput): Promise<MemoryUpdateOutput> {
      const current = await project.store.readByPath(input.path);
      const oldContent = current.content;
      const updated = await project.store.update(
        current.metadata.id,
        input.content,
      );

      let indexed = false;
      try {
        await indexMemoryWithEmbedding(updated, project.searchIndex);
        indexed = true;
      } catch {
        // Indexing failed, continue
      }

      const diff = `Updated: ${input.reason}. Previous length: ${oldContent.length}, new length: ${input.content.length}`;

      // v2-lite: Connection discovery on significant change (>20% content diff)
      const lengthRatio =
        oldContent.length > 0
          ? Math.abs(input.content.length - oldContent.length) /
            oldContent.length
          : 1;

      let suggestedConnections:
        | MemoryUpdateOutput["suggested_connections"]
        | undefined;

      if (lengthRatio > 0.2 && indexed) {
        try {
          const queryEmbed = await embedding.embed(input.content);

          let ftsResults: SearchResult[] = [];
          try {
            const searchQuery = input.content.slice(0, 200);
            ftsResults = await project.searchIndex.searchText(searchQuery, 5);
          } catch {
            // FTS might fail with special characters
          }

          const vecResults = await project.searchIndex.searchVector(
            queryEmbed.vector,
            5,
          );

          const candidates = new Map<
            string,
            { id: string; title: string; relevance: number }
          >();
          const currentId = current.metadata.id;

          for (const r of ftsResults) {
            if (r.memory.metadata.id === currentId) continue;
            const score = r.score * 0.5;
            const existing = candidates.get(r.memory.metadata.id);
            if (!existing || existing.relevance < score) {
              candidates.set(r.memory.metadata.id, {
                id: r.memory.metadata.id,
                title: r.memory.metadata.title,
                relevance: score,
              });
            }
          }

          for (const r of vecResults) {
            if (r.memory.metadata.id === currentId) continue;
            const existing = candidates.get(r.memory.metadata.id);
            if (!existing || existing.relevance < r.score) {
              candidates.set(r.memory.metadata.id, {
                id: r.memory.metadata.id,
                title: r.memory.metadata.title,
                relevance: r.score,
              });
            }
          }

          suggestedConnections = [...candidates.values()]
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, 5);
        } catch {
          // Discovery is best-effort
        }
      }

      return {
        success: true,
        diff,
        indexed,
        suggested_connections: suggestedConnections,
      };
    },

    async forget(input: MemoryForgetInput): Promise<MemoryForgetOutput> {
      if (!input.confirm) {
        return {
          success: false,
          forgotten: [],
          message:
            "Confirm required: set confirm=true to proceed with deletion.",
        };
      }

      const queryEmbedding = await embedding.embed(input.query);
      const results = await project.searchIndex.searchHybrid(
        input.query,
        queryEmbedding.vector,
        { limit: input.scope === "entry" ? 1 : 10, minScore: 0.3 },
      );

      const forgotten: string[] = [];
      for (const result of results) {
        const id = result.memory.metadata.id;
        await project.store.delete(id);
        await project.searchIndex.remove(id);
        forgotten.push(result.memory.filePath);
      }

      return {
        success: true,
        forgotten,
        message: `Forgot ${forgotten.length} memor${forgotten.length === 1 ? "y" : "ies"}.`,
      };
    },

    async commit(input: MemoryCommitInput): Promise<MemoryCommitOutput> {
      const hash = await project.git.commit(
        input.message,
        input.type as CommitType,
      );

      const status = await project.git.status();
      const filesChanged =
        status.staged.length + status.modified.length + status.untracked.length;

      return {
        success: true,
        commitHash: hash,
        filesChanged,
      };
    },

    // -- v2-lite tools --------------------------------------------------------

    async memoryStore(
      input: MemoryStoreInput,
    ): Promise<MemoryStoreOutput> {
      const now = new Date();
      const isoNow = now.toISOString();

      // Generate sequential ID
      const id = await project.searchIndex.getNextSequentialId(input.type);
      const slug = slugify(input.title);
      const typeDir = knowledgeTypeDir(input.type);
      const fileName = `${id}-${slug}.md`;
      const relFilePath = join(typeDir, fileName);
      const absFilePath = join(config.baseDir, relFilePath);

      // Normalize tags to lowercase
      const tags = (input.tags ?? []).map((t) => t.toLowerCase());

      // Build connections for frontmatter
      const connections = (input.connections ?? []).map((c) => ({
        target: c.target,
        type: c.type,
        note: c.note,
      }));

      // Build frontmatter
      const frontmatter: Record<string, unknown> = {
        id,
        title: input.title,
        type: input.type,
        tags,
        created: isoNow.slice(0, 10),
        updated: isoNow.slice(0, 10),
        connections,
      };

      // Ensure directory exists
      const dir = dirname(absFilePath);
      mkdirSync(dir, { recursive: true });

      // Serialize and write markdown file
      // serializeMarkdown imported at top level
      const serialized = serializeMarkdown({
        frontmatter,
        body: input.content,
      });
      writeFileSync(absFilePath, serialized);

      // Index in knowledge table
      await project.searchIndex.indexKnowledge({
        id,
        title: input.title,
        type: input.type,
        filePath: relFilePath,
        createdAt: isoNow,
        updatedAt: isoNow,
        accessCount: 0,
        tags,
      });

      // Insert tags
      if (tags.length > 0) {
        await project.searchIndex.insertTags(id, tags);
      }

      // Also index in v1 memories table for search compatibility
      const memoryObj: Memory = {
        metadata: {
          id,
          title: input.title,
          type: knowledgeToMemoryType(input.type) as Memory["metadata"]["type"],
          tags,
          importance: "medium",
          createdAt: now.getTime(),
          updatedAt: now.getTime(),
          lastAccessedAt: now.getTime(),
          source: "memory-store",
        },
        content: input.content,
        filePath: relFilePath,
      };
      await indexMemoryWithEmbedding(memoryObj, project.searchIndex);

      // Handle initial connections if provided
      for (const conn of input.connections ?? []) {
        const inverseType = getInverseType(conn.type);
        // Insert forward connection
        await project.searchIndex.insertConnection(
          id,
          conn.target,
          conn.type,
          conn.note,
        );
        // Insert inverse connection
        await project.searchIndex.insertConnection(
          conn.target,
          id,
          inverseType as ConnectionType,
          conn.note,
        );
        // Update target file's frontmatter with inverse connection
        await updateFrontmatterConnections(
          conn.target,
          id,
          inverseType,
          conn.note,
        );
      }

      // Connection discovery: find related entries
      let suggestedConnections: MemoryStoreOutput["suggested_connections"] = [];
      try {
        const queryEmbed = await embedding.embed(input.content);

        // FTS search
        let ftsResults: SearchResult[] = [];
        try {
          // Use title + first 100 chars of content as search query
          const searchQuery = `${input.title} ${input.content.slice(0, 100)}`;
          ftsResults = await project.searchIndex.searchText(searchQuery, 5);
        } catch {
          // FTS might fail with special characters
        }

        // Vector search
        const vecResults = await project.searchIndex.searchVector(
          queryEmbed.vector,
          5,
        );

        // Deduplicate and rank
        const candidates = new Map<
          string,
          { id: string; title: string; relevance: number }
        >();

        for (const r of ftsResults) {
          if (r.memory.metadata.id === id) continue;
          const existing = candidates.get(r.memory.metadata.id);
          const score = r.score * 0.5;
          if (!existing || existing.relevance < score) {
            candidates.set(r.memory.metadata.id, {
              id: r.memory.metadata.id,
              title: r.memory.metadata.title,
              relevance: score,
            });
          }
        }

        for (const r of vecResults) {
          if (r.memory.metadata.id === id) continue;
          const existing = candidates.get(r.memory.metadata.id);
          const score = r.score;
          if (!existing || existing.relevance < score) {
            candidates.set(r.memory.metadata.id, {
              id: r.memory.metadata.id,
              title: r.memory.metadata.title,
              relevance: score,
            });
          }
        }

        suggestedConnections = [...candidates.values()]
          .sort((a, b) => b.relevance - a.relevance)
          .slice(0, 5);
      } catch {
        // Discovery is best-effort
      }

      // Get existing tags for autocomplete
      const existingTags = await project.searchIndex.getExistingTags();

      return {
        id,
        file_path: relFilePath,
        suggested_connections: suggestedConnections,
        existing_tags: existingTags,
      };
    },

    async memoryConnect(
      input: MemoryConnectInput,
    ): Promise<MemoryConnectOutput> {
      const inverseType = getInverseType(input.type);

      // Insert forward connection in SQLite
      await project.searchIndex.insertConnection(
        input.source_id,
        input.target_id,
        input.type,
        input.note,
      );

      // Insert inverse connection in SQLite
      await project.searchIndex.insertConnection(
        input.target_id,
        input.source_id,
        inverseType as ConnectionType,
        input.note,
      );

      // Update source file frontmatter
      await updateFrontmatterConnections(
        input.source_id,
        input.target_id,
        input.type,
        input.note,
      );

      // Update target file frontmatter (inverse)
      await updateFrontmatterConnections(
        input.target_id,
        input.source_id,
        inverseType,
        input.note,
      );

      return {
        success: true,
        inverse_type: inverseType,
      };
    },

    async memoryTraverse(
      input: MemoryTraverseInput,
    ): Promise<MemoryTraverseOutput> {
      const depth = Math.min(input.depth ?? 1, 2);
      const results: MemoryTraverseOutput["results"] = [];
      const visited = new Set<string>([input.start_id]);

      // BFS traversal
      let currentLevel = [input.start_id];

      for (let d = 1; d <= depth; d++) {
        const nextLevel: string[] = [];

        for (const nodeId of currentLevel) {
          const connections = await project.searchIndex.getConnections(
            nodeId,
            input.direction,
            input.types,
          );

          for (const conn of connections) {
            const neighborId =
              conn.source_id === nodeId ? conn.target_id : conn.source_id;

            if (visited.has(neighborId)) continue;
            visited.add(neighborId);

            // Look up knowledge entry for title and type
            const entry =
              await project.searchIndex.getKnowledgeById(neighborId);

            results.push({
              id: neighborId,
              title: entry?.title ?? neighborId,
              type: entry?.type ?? "unknown",
              connection_type: conn.type,
              distance: d,
            });

            nextLevel.push(neighborId);
          }
        }

        currentLevel = nextLevel;
      }

      return { results };
    },

    async start(): Promise<void> {
      session = {
        sessionId: randomUUID(),
        startedAt: Date.now(),
        notes: [],
      };

      // Ensure project .gitignore contains .agent-memory/
      ensureGitignore(config.baseDir);

      // Ensure base directories exist
      await mkdir(config.baseDir, { recursive: true });

      // Initialize project git if needed
      const initialized = await project.git.isInitialized();
      if (!initialized) {
        await project.git.init();
      }

      // Initialize global store if configured
      if (global && config.globalDir) {
        await mkdir(config.globalDir, { recursive: true });
        const globalInitialized = await global.git.isInitialized();
        if (!globalInitialized) {
          await global.git.init();
        }
        await global.store.loadCore();
      }

      // Load core memories
      await project.store.loadCore();
    },

    async stop(): Promise<void> {
      // Cleanup
      project.searchIndex.close();
      if (global) {
        global.searchIndex.close();
      }
      session = null;
    },
  };
}
