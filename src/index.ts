import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createEmbeddingEngine } from "./embedding/engine.ts";
import type { EmbeddingEngine } from "./embedding/types.ts";
import { createGitManager } from "./git/manager.ts";
import type { GitManager } from "./git/types.ts";
import { createMemoryStore } from "./memory/store.ts";
import type { MemoryStore } from "./memory/types.ts";
import { createSearchIndex } from "./search/index.ts";
import type { SearchIndex } from "./search/types.ts";
export type { MemoryConfig } from "./shared/config.ts";
export { findProjectRoot } from "./shared/config.ts";

import { type MemoryConfig, createDefaultConfig } from "./shared/config.ts";
export type {
  CommitType,
  Importance,
  Memory,
  MemoryCommitInput,
  MemoryCommitOutput,
  MemoryForgetInput,
  MemoryForgetOutput,
  MemoryMetadata,
  MemoryNoteInput,
  MemoryNoteOutput,
  MemoryReadInput,
  MemoryReadOutput,
  MemorySearchInput,
  MemorySearchOutput,
  MemoryType,
  MemoryUpdateInput,
  MemoryUpdateOutput,
  SearchResult,
  StoreSource,
} from "./shared/types.ts";

import type {
  CommitType,
  Memory,
  MemoryCommitInput,
  MemoryCommitOutput,
  MemoryForgetInput,
  MemoryForgetOutput,
  MemoryNoteInput,
  MemoryNoteOutput,
  MemoryReadInput,
  MemoryReadOutput,
  MemorySearchInput,
  MemorySearchOutput,
  MemoryUpdateInput,
  MemoryUpdateOutput,
  SearchResult,
  SessionState,
} from "./shared/types.ts";

export interface MemorySystem {
  // Tools API
  note(input: MemoryNoteInput): Promise<MemoryNoteOutput>;
  search(input: MemorySearchInput): Promise<MemorySearchOutput>;
  read(input: MemoryReadInput): Promise<MemoryReadOutput>;
  update(input: MemoryUpdateInput): Promise<MemoryUpdateOutput>;
  forget(input: MemoryForgetInput): Promise<MemoryForgetOutput>;
  commit(input: MemoryCommitInput): Promise<MemoryCommitOutput>;

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

  const sessionDir = join(config.baseDir, ".session");
  const notesPath = join(sessionDir, "notes.md");

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
      const noteId = randomUUID();
      const timestamp = Date.now();
      const entry = `\n## [${new Date(timestamp).toISOString()}] [${input.importance}]\n\n${input.content}\n`;

      // Ensure session directory exists
      await mkdir(sessionDir, { recursive: true });

      // Append to session notes file
      const file = Bun.file(notesPath);
      const existing = (await file.exists()) ? await file.text() : "";
      await Bun.write(notesPath, existing + entry);

      // Track in session state
      if (session) {
        session.notes.push({
          noteId,
          content: input.content,
          type: input.type,
          importance: input.importance,
          timestamp,
        });
      }

      return {
        success: true,
        noteId,
        message: `Note saved: ${input.content.slice(0, 50)}${input.content.length > 50 ? "..." : ""}`,
      };
    },

    async search(input: MemorySearchInput): Promise<MemorySearchOutput> {
      const queryEmbedding = await embedding.embed(input.query);
      const limit = input.limit ?? 5;

      // Search project store
      const projectResults = await project.searchIndex.searchHybrid(
        input.query,
        queryEmbedding.vector,
        { limit, minScore: input.minScore ?? 0.3 },
      );

      // Search global store if available
      let finalResults: SearchResult[];
      if (global) {
        const globalResults = await global.searchIndex.searchHybrid(
          input.query,
          queryEmbedding.vector,
          { limit, minScore: input.minScore ?? 0.3 },
        );
        finalResults = mergeSearchResults(projectResults, globalResults, limit);
      } else {
        finalResults = projectResults;
      }

      return {
        results: finalResults.map((r) => ({
          content: r.memory.content,
          source: r.memory.filePath,
          score: r.score,
          type: r.memory.metadata.type,
          lastAccessed: new Date(
            r.memory.metadata.lastAccessedAt,
          ).toISOString(),
          storeSource: r.storeSource,
        })),
        totalFound: finalResults.length,
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

      try {
        await indexMemoryWithEmbedding(updated, project.searchIndex);
        return {
          success: true,
          diff: `Updated: ${input.reason}. Previous length: ${oldContent.length}, new length: ${input.content.length}`,
          indexed: true,
        };
      } catch {
        return {
          success: true,
          diff: `Updated: ${input.reason}. Previous length: ${oldContent.length}, new length: ${input.content.length}`,
          indexed: false,
        };
      }
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
      await mkdir(sessionDir, { recursive: true });

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
      const file = Bun.file(notesPath);
      if (await file.exists()) {
        const notes = await file.text();
        if (notes.trim().length > 0) {
          try {
            await project.git.commit(
              `Session ${session?.sessionId ?? "unknown"}: ${session?.notes.length ?? 0} notes captured`,
              "consolidate",
            );
          } catch {
            // No changes to commit
          }
        }
      }

      // Cleanup
      project.searchIndex.close();
      if (global) {
        global.searchIndex.close();
      }
      session = null;
    },
  };
}
