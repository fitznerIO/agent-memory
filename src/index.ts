import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createConsolidationAgent } from "./consolidation/agent.ts";
import type { ExistingEntry } from "./consolidation/types.ts";
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
import {
  getInverseType,
  getLastModified,
  knowledgeToMemoryType,
  knowledgeTypeDir,
  slugify,
} from "./shared/utils.ts";

import { type MemoryConfig, createDefaultConfig } from "./shared/config.ts";
export type {
  ArchiveCandidate,
  CommitType,
  Connection,
  ConnectionType,
  ConsolidationInput,
  ConsolidationOutput,
  DecayOutput,
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
  RebuildIndexOutput,
  SearchResult,
  StoreSource,
} from "./shared/types.ts";

import type {
  ArchiveCandidate,
  CommitType,
  Connection,
  ConsolidationInput,
  ConsolidationOutput,
  DecayOutput,
  KnowledgeType,
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
  RebuildIndexOutput,
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

  // v2-lite: Index rebuild, Consolidation, Decay
  rebuildIndex(): Promise<RebuildIndexOutput>;
  consolidate(input?: ConsolidationInput): Promise<ConsolidationOutput>;
  getArchiveCandidates(options?: {
    maxAgeDays?: number;
    minAccessCount?: number;
  }): Promise<DecayOutput>;

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
   * Discover similar entries via FTS + vector search, deduplicate, rank, and
   * return top candidates. Used by memoryStore() and update() for connection
   * discovery suggestions.
   */
  async function findSimilarEntries(
    searchQuery: string,
    content: string,
    excludeId: string,
    limit = 5,
  ): Promise<Array<{ id: string; title: string; relevance: number }>> {
    const queryEmbed = await embedding.embed(content);

    let ftsResults: SearchResult[] = [];
    try {
      ftsResults = await project.searchIndex.searchText(searchQuery, limit);
    } catch {
      // FTS can fail on special characters in the query
    }

    const vecResults = await project.searchIndex.searchVector(
      queryEmbed.vector,
      limit,
    );

    // Merge: FTS scores weighted at 0.5, vector scores at 1.0
    const candidates = new Map<
      string,
      { id: string; title: string; relevance: number }
    >();

    for (const r of ftsResults) {
      const id = r.memory.metadata.id;
      if (id === excludeId) continue;
      const score = r.score * 0.5;
      const existing = candidates.get(id);
      if (!existing || existing.relevance < score) {
        candidates.set(id, {
          id,
          title: r.memory.metadata.title,
          relevance: score,
        });
      }
    }

    for (const r of vecResults) {
      const id = r.memory.metadata.id;
      if (id === excludeId) continue;
      const existing = candidates.get(id);
      if (!existing || existing.relevance < r.score) {
        candidates.set(id, {
          id,
          title: r.memory.metadata.title,
          relevance: r.score,
        });
      }
    }

    return [...candidates.values()]
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
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

      const raw = await file.text();
      const doc = parseMarkdown(raw);

      // Get existing connections or initialize
      const connections =
        (doc.frontmatter.connections as Array<Record<string, unknown>>) ?? [];

      // Check if connection already exists
      const exists = connections.some(
        (c) => c.target === targetId && c.type === connType,
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
    } catch (err) {
      // Best-effort: file may not exist yet (e.g. during migration)
      if (process.env.DEBUG) {
        console.warn(
          `[agent-memory] Failed to update frontmatter for ${entryId}:`,
          err,
        );
      }
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
          tags,
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
      const fetchLimit = tagFilterIds || connFilterIds ? limit * 5 : limit;

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
        rawResults = mergeSearchResults(
          projectResults,
          globalResults,
          fetchLimit,
        );
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
          const knowledgeEntry = await project.searchIndex.getKnowledgeById(id);

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

      // Access tracking: update last_accessed and access_count for returned results
      for (const r of enrichedResults) {
        if (r.id) {
          try {
            await project.searchIndex.updateAccessTracking(r.id);
          } catch {
            // Best-effort
          }
        }
      }

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

      // Access tracking: update last_accessed and access_count
      const memId = memory.metadata.id;
      try {
        await project.searchIndex.updateAccessTracking(memId);
      } catch {
        // Best-effort: entry may not exist in knowledge table
      }

      const lastModified = getLastModified(
        memory.metadata as unknown as Record<string, unknown>,
      );

      return {
        content: memory.content,
        lastModified,
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
          suggestedConnections = await findSimilarEntries(
            input.content.slice(0, 200),
            input.content,
            current.metadata.id,
          );
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
      // Capture status BEFORE commit to count changed files
      const statusBefore = await project.git.status();
      const filesChanged =
        statusBefore.staged.length +
        statusBefore.modified.length +
        statusBefore.untracked.length;

      const hash = await project.git.commit(
        input.message,
        input.type as CommitType,
      );

      return {
        success: true,
        commitHash: hash,
        filesChanged,
      };
    },

    // -- v2-lite tools --------------------------------------------------------

    async memoryStore(input: MemoryStoreInput): Promise<MemoryStoreOutput> {
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
          inverseType,
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
        suggestedConnections = await findSimilarEntries(
          `${input.title} ${input.content.slice(0, 100)}`,
          input.content,
          id,
        );
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
        inverseType,
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

    async rebuildIndex(): Promise<RebuildIndexOutput> {
      const startTime = Date.now();

      // 1. Clear all index data
      project.searchIndex.resetAll();

      // 2. Walk all markdown files from disk
      const allMemories = await project.store.list();

      let totalEmbeddings = 0;
      let knowledgeEntries = 0;

      const KNOWLEDGE_TYPES = new Set([
        "decision",
        "incident",
        "entity",
        "pattern",
        "workflow",
        "note",
        "session",
      ]);

      for (const memory of allMemories) {
        // 3. Normalize metadata for v2-lite files (created/updated → createdAt/updatedAt)
        const rawFm = memory.metadata as unknown as Record<string, unknown>;
        const rawType = rawFm.type as string;
        const isV2Lite = KNOWLEDGE_TYPES.has(rawType);

        let normalizedMemory: Memory;
        if (isV2Lite) {
          const createdTs = rawFm.created
            ? new Date(String(rawFm.created)).getTime()
            : Date.now();
          const updatedTs = rawFm.updated
            ? new Date(String(rawFm.updated)).getTime()
            : createdTs;
          normalizedMemory = {
            metadata: {
              id: (rawFm.id as string) ?? memory.metadata.id,
              title:
                (rawFm.title as string) ?? memory.metadata.title ?? "Untitled",
              type: knowledgeToMemoryType(
                rawType as KnowledgeType,
              ) as Memory["metadata"]["type"],
              tags: Array.isArray(rawFm.tags)
                ? (rawFm.tags as string[]).map((t) => String(t).toLowerCase())
                : [],
              importance: "medium",
              createdAt: createdTs,
              updatedAt: updatedTs,
              lastAccessedAt: updatedTs,
              source: "memory-store",
            },
            content: memory.content,
            filePath: memory.filePath,
          };
        } else {
          normalizedMemory = memory;
        }

        // Embed and index in memories/FTS/vec
        try {
          const embResult = await embedding.embed(normalizedMemory.content);
          const memWithEmbed = Object.assign({}, normalizedMemory, {
            embedding: embResult.vector,
          });
          await project.searchIndex.index(memWithEmbed);
          totalEmbeddings++;
        } catch {
          // Best-effort: skip files that fail to embed
          await project.searchIndex.index(normalizedMemory);
        }

        if (isV2Lite) {
          const knType = rawType as KnowledgeType;
          const id = normalizedMemory.metadata.id;
          const title = normalizedMemory.metadata.title;
          const created = new Date(
            normalizedMemory.metadata.createdAt,
          ).toISOString();
          const updated = new Date(
            normalizedMemory.metadata.updatedAt,
          ).toISOString();

          // Index in knowledge table
          await project.searchIndex.indexKnowledge({
            id,
            title,
            type: knType,
            filePath: memory.filePath,
            createdAt: created,
            updatedAt: updated,
            accessCount: 0,
            tags: [],
          });

          // Index tags
          const tags = Array.isArray(rawFm.tags)
            ? (rawFm.tags as string[]).map((t) => String(t).toLowerCase())
            : [];
          if (tags.length > 0) {
            await project.searchIndex.insertTags(id, tags);
          }

          // Index connections (forward + inverse for forward-type connections)
          const FORWARD_TYPES = new Set([
            "related",
            "builds_on",
            "contradicts",
            "part_of",
            "supersedes",
          ]);
          const connections = Array.isArray(rawFm.connections)
            ? (rawFm.connections as Array<Record<string, unknown>>)
            : [];
          for (const conn of connections) {
            if (conn.target && conn.type) {
              const connType = String(conn.type) as Connection["type"];
              const connNote = conn.note ? String(conn.note) : undefined;
              // Always insert the connection as written
              await project.searchIndex.insertConnection(
                id,
                String(conn.target),
                connType,
                connNote,
              );
              // Only insert inverse for forward ConnectionTypes
              if (FORWARD_TYPES.has(connType)) {
                const inverseType = getInverseType(
                  connType as Parameters<typeof getInverseType>[0],
                );
                await project.searchIndex.insertConnection(
                  String(conn.target),
                  id,
                  inverseType,
                  connNote,
                );
              }
            }
          }

          knowledgeEntries++;
        }
      }

      return {
        totalDocuments: allMemories.length,
        totalEmbeddings,
        knowledgeEntries,
        elapsed: Date.now() - startTime,
      };
    },

    async consolidate(
      input?: ConsolidationInput,
    ): Promise<ConsolidationOutput> {
      const consolidator = createConsolidationAgent();
      const dryRun = input?.dryRun ?? false;

      // Gather session notes
      const notes = (session?.notes ?? []).map((n) => ({
        noteId: n.noteId,
        content: n.content,
        type: n.type,
        importance: n.importance,
        tags: n.tags,
      }));

      if (notes.length === 0) {
        return {
          actions: [],
          filesCreated: 0,
          tagsNormalized: 0,
          duplicatesSkipped: 0,
          subsumed: 0,
        };
      }

      // Gather existing entries for dedup/subsumption checks
      const allKnowledge = await project.searchIndex.getAllKnowledgeEntries();
      const existingEntries: ExistingEntry[] = [];
      for (const entry of allKnowledge) {
        try {
          const mem = await project.store.readByPath(entry.filePath);
          existingEntries.push({
            id: entry.id,
            title: entry.title,
            content: mem.content,
            type: entry.type,
            tags: entry.tags,
          });
        } catch {
          // File may not exist
        }
      }

      const actions = consolidator.buildPlan(notes, existingEntries);

      if (dryRun) {
        return {
          actions,
          filesCreated: actions.filter((a) => a.type === "create_file").length,
          tagsNormalized: actions.filter((a) => a.type === "normalize_tags")
            .length,
          duplicatesSkipped: actions.filter((a) => a.type === "skip_duplicate")
            .length,
          subsumed: actions.filter((a) => a.type === "subsume").length,
        };
      }

      // Execute actions
      let filesCreated = 0;
      let tagsNormalized = 0;
      let duplicatesSkipped = 0;
      let subsumed = 0;

      for (const action of actions) {
        switch (action.type) {
          case "create_file": {
            if (action.targetType && action.content) {
              await this.memoryStore({
                title: action.title ?? "Untitled",
                type: action.targetType,
                content: action.content,
                tags: action.tags,
              });
              filesCreated++;
            }
            break;
          }
          case "subsume": {
            if (action.targetType && action.content && action.supersedesId) {
              await this.memoryStore({
                title: action.title ?? "Untitled",
                type: action.targetType,
                content: action.content,
                tags: action.tags,
                connections: [
                  {
                    target: action.supersedesId,
                    type: "supersedes",
                    note: "Superseded by consolidation",
                  },
                ],
              });
              subsumed++;
              filesCreated++;
            }
            break;
          }
          case "skip_duplicate": {
            duplicatesSkipped++;
            break;
          }
          case "normalize_tags": {
            tagsNormalized++;
            break;
          }
        }
      }

      return {
        actions,
        filesCreated,
        tagsNormalized,
        duplicatesSkipped,
        subsumed,
      };
    },

    async getArchiveCandidates(options?: {
      maxAgeDays?: number;
      minAccessCount?: number;
    }): Promise<DecayOutput> {
      const maxAgeDays = options?.maxAgeDays ?? 90;
      const minAccessCount = options?.minAccessCount ?? 2;
      const now = Date.now();

      const allEntries = await project.searchIndex.getAllKnowledgeEntries();
      const candidates: ArchiveCandidate[] = [];

      for (const entry of allEntries) {
        // Calculate days since last access
        const lastAccessTime = entry.lastAccessed
          ? new Date(entry.lastAccessed).getTime()
          : new Date(entry.createdAt).getTime();
        const daysSinceAccess = (now - lastAccessTime) / (1000 * 60 * 60 * 24);

        // Skip recently accessed entries
        if (
          daysSinceAccess < maxAgeDays &&
          entry.accessCount >= minAccessCount
        ) {
          continue;
        }

        // Determine importance from entry type heuristic
        const importance: "high" | "medium" | "low" =
          entry.type === "decision" || entry.type === "pattern"
            ? "high"
            : entry.type === "incident" || entry.type === "workflow"
              ? "medium"
              : "low";

        // Importance-weighted threshold: high-importance entries need more staleness
        const effectiveMaxAge =
          importance === "high"
            ? maxAgeDays * 2
            : importance === "medium"
              ? maxAgeDays * 1.5
              : maxAgeDays;

        if (
          daysSinceAccess < effectiveMaxAge &&
          entry.accessCount >= minAccessCount
        ) {
          continue;
        }

        // Connection-awareness: check active connections (PRD 10.2)
        const activeConnections =
          await project.searchIndex.getActiveConnectionCount(entry.id);

        if (activeConnections > 0) {
          // Connected but stale — don't suggest archiving
          candidates.push({
            id: entry.id,
            title: entry.title,
            type: entry.type,
            lastAccessed: entry.lastAccessed ?? null,
            accessCount: entry.accessCount,
            daysSinceAccess: Math.round(daysSinceAccess),
            importance,
            activeConnections,
            status: "connected_but_stale",
            reason: `${activeConnections} active connection(s) — review rather than archive`,
          });
        } else {
          // No connections, stale — archive candidate
          candidates.push({
            id: entry.id,
            title: entry.title,
            type: entry.type,
            lastAccessed: entry.lastAccessed ?? null,
            accessCount: entry.accessCount,
            daysSinceAccess: Math.round(daysSinceAccess),
            importance,
            activeConnections: 0,
            status: "archive_candidate",
            reason: `Not accessed for ${Math.round(daysSinceAccess)} days, ${entry.accessCount} total accesses`,
          });
        }
      }

      // Sort: archive candidates first, then by staleness
      candidates.sort((a, b) => {
        if (a.status !== b.status) {
          return a.status === "archive_candidate" ? -1 : 1;
        }
        return b.daysSinceAccess - a.daysSinceAccess;
      });

      return {
        candidates,
        totalEvaluated: allEntries.length,
        totalCandidates: candidates.length,
      };
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
