import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createEmbeddingEngine } from "./embedding/engine.ts";
import type { EmbeddingEngine } from "./embedding/types.ts";
import { createGitManager } from "./git/manager.ts";
import type { GitManager } from "./git/types.ts";
import { createMemoryStore } from "./memory/store.ts";
import type { MemoryStore } from "./memory/types.ts";
import { createSearchIndex } from "./search/index.ts";
import type { SearchIndex } from "./search/types.ts";
import { type MemoryConfig, createDefaultConfig } from "./shared/config.ts";
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
  SessionState,
} from "./shared/types.ts";

export interface MemorySystem {
  // Tools API (PRD F-01 through F-06)
  note(input: MemoryNoteInput): Promise<MemoryNoteOutput>;
  search(input: MemorySearchInput): Promise<MemorySearchOutput>;
  read(input: MemoryReadInput): Promise<MemoryReadOutput>;
  update(input: MemoryUpdateInput): Promise<MemoryUpdateOutput>;
  forget(input: MemoryForgetInput): Promise<MemoryForgetOutput>;
  commit(input: MemoryCommitInput): Promise<MemoryCommitOutput>;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;

  // Access to internals
  store: MemoryStore;
  searchIndex: SearchIndex;
  git: GitManager;
  embedding: EmbeddingEngine;
  config: MemoryConfig;
}

export function createMemorySystem(
  overrides?: Partial<MemoryConfig>,
): MemorySystem {
  const config = { ...createDefaultConfig(), ...overrides };

  // Ensure directories exist before modules initialize
  mkdirSync(config.baseDir, { recursive: true });
  mkdirSync(dirname(config.sqlitePath), { recursive: true });

  const store = createMemoryStore(config);
  const searchIndex = createSearchIndex(config);
  const git = createGitManager(config);
  const embedding = createEmbeddingEngine(config);

  let session: SessionState | null = null;

  const sessionDir = join(config.baseDir, ".session");
  const notesPath = join(sessionDir, "notes.md");

  async function indexMemoryWithEmbedding(memory: Memory): Promise<void> {
    const result = await embedding.embed(memory.content);
    const memoryWithEmbedding = Object.assign({}, memory, {
      embedding: result.vector,
    });
    await searchIndex.index(memoryWithEmbedding);
  }

  return {
    store,
    searchIndex,
    git,
    embedding,
    config,

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
      // Embed the query
      const queryEmbedding = await embedding.embed(input.query);

      // Run hybrid search
      const results = await searchIndex.searchHybrid(
        input.query,
        queryEmbedding.vector,
        {
          limit: input.limit ?? 5,
          minScore: input.minScore ?? 0.3,
        },
      );

      return {
        results: results.map((r) => ({
          content: r.memory.content,
          source: r.memory.filePath,
          score: r.score,
          type: r.memory.metadata.type,
          lastAccessed: new Date(
            r.memory.metadata.lastAccessedAt,
          ).toISOString(),
        })),
        totalFound: results.length,
      };
    },

    async read(input: MemoryReadInput): Promise<MemoryReadOutput> {
      const memory = await store.readByPath(input.path);

      return {
        content: memory.content,
        lastModified: new Date(memory.metadata.updatedAt).toISOString(),
        wordCount: memory.content.split(/\s+/).filter(Boolean).length,
      };
    },

    async update(input: MemoryUpdateInput): Promise<MemoryUpdateOutput> {
      // Read current content for diff
      const current = await store.readByPath(input.path);
      const oldContent = current.content;

      // Update via store
      const updated = await store.update(current.metadata.id, input.content);

      // Re-index with new embedding
      try {
        await indexMemoryWithEmbedding(updated);
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

      // Search for matching memories
      const queryEmbedding = await embedding.embed(input.query);
      const results = await searchIndex.searchHybrid(
        input.query,
        queryEmbedding.vector,
        { limit: input.scope === "entry" ? 1 : 10, minScore: 0.3 },
      );

      const forgotten: string[] = [];
      for (const result of results) {
        const id = result.memory.metadata.id;
        await store.delete(id);
        await searchIndex.remove(id);
        forgotten.push(result.memory.filePath);
      }

      return {
        success: true,
        forgotten,
        message: `Forgot ${forgotten.length} memor${forgotten.length === 1 ? "y" : "ies"}.`,
      };
    },

    async commit(input: MemoryCommitInput): Promise<MemoryCommitOutput> {
      const hash = await git.commit(input.message, input.type as CommitType);

      const status = await git.status();
      const filesChanged =
        status.staged.length + status.modified.length + status.untracked.length;

      return {
        success: true,
        commitHash: hash,
        filesChanged,
      };
    },

    async start(): Promise<void> {
      // Initialize session
      session = {
        sessionId: randomUUID(),
        startedAt: Date.now(),
        notes: [],
      };

      // Ensure base directories exist
      await mkdir(config.baseDir, { recursive: true });
      await mkdir(sessionDir, { recursive: true });

      // Initialize git if needed
      const initialized = await git.isInitialized();
      if (!initialized) {
        await git.init();
      }

      // Load core memories (available for system prompt injection)
      await store.loadCore();
    },

    async stop(): Promise<void> {
      // Read session notes if they exist
      const file = Bun.file(notesPath);
      if (await file.exists()) {
        const notes = await file.text();
        if (notes.trim().length > 0) {
          // Commit pending changes with session summary
          try {
            await git.commit(
              `Session ${session?.sessionId ?? "unknown"}: ${session?.notes.length ?? 0} notes captured`,
              "consolidate",
            );
          } catch {
            // No changes to commit
          }
        }
      }

      // Cleanup
      searchIndex.close();
      session = null;
    },
  };
}
