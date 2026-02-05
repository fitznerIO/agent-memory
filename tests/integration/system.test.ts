import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import {
  cleanupTempDir,
  createTempDir,
} from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

describe("MemorySystem Integration", () => {
  let tempDir: string;
  let system: MemorySystem;

  beforeAll(async () => {
    tempDir = await createTempDir();
    system = createMemorySystem({
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
    });
    await system.start();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    try {
      await system.stop();
    } catch {
      // may fail if already stopped
    }
    await cleanupTempDir(tempDir);
  }, TEST_TIMEOUT);

  describe("createMemorySystem", () => {
    test("creates a system with all modules wired together", () => {
      expect(system.store).toBeDefined();
      expect(system.searchIndex).toBeDefined();
      expect(system.git).toBeDefined();
      expect(system.embedding).toBeDefined();
      expect(system.config).toBeDefined();
    });

    test("applies config overrides to all modules", () => {
      expect(system.config.baseDir).toBe(tempDir);
      expect(system.config.sqlitePath).toBe(
        join(tempDir, ".index", "search.sqlite"),
      );
    });

    test("uses default config when no overrides given", () => {
      expect(system.config.embeddingModel).toBe("Xenova/all-MiniLM-L6-v2");
      expect(system.config.embeddingDimensions).toBe(384);
    });
  });

  describe("end-to-end flow", () => {
    test(
      "create memory -> index -> search -> find",
      async () => {
        // Create a memory via the store
        const memory = await system.store.create({
          metadata: {
            title: "TypeScript Tips",
            type: "semantic",
            tags: ["typescript", "programming"],
            importance: "high",
            source: "integration-test",
          },
          content:
            "TypeScript generics allow you to write reusable, type-safe functions and classes.",
          filePath: "semantic/ts-tips.md",
        });

        // Index with embedding
        const embeddingResult = await system.embedding.embed(memory.content);
        const memoryWithEmbedding = Object.assign({}, memory, {
          embedding: embeddingResult.vector,
        });
        await system.searchIndex.index(memoryWithEmbedding);

        // Search via the tools API
        const searchResult = await system.search({
          query: "TypeScript generics",
          limit: 5,
          minScore: 0.0,
        });

        expect(searchResult.totalFound).toBeGreaterThan(0);
        expect(searchResult.results[0]?.content).toContain("generics");
      },
      TEST_TIMEOUT,
    );

    test(
      "create memory -> commit -> retrieve from git history",
      async () => {
        // Create a memory
        const memory = await system.store.create({
          metadata: {
            title: "Git Integration Test",
            type: "episodic",
            tags: ["git", "test"],
            importance: "medium",
            source: "integration-test",
          },
          content: "Testing git integration with the memory system.",
          filePath: "episodic/git-test.md",
        });

        // Commit via tools API
        const commitResult = await system.commit({
          message: "Add git integration test memory",
          type: "episodic",
        });

        expect(commitResult.success).toBe(true);
        expect(commitResult.commitHash).toBeDefined();
        expect(commitResult.commitHash.length).toBeGreaterThan(0);

        // Verify via git log
        const log = await system.git.log(1);
        expect(log.length).toBeGreaterThan(0);
        expect(log[0]?.message).toContain("git integration test");
      },
      TEST_TIMEOUT,
    );

    test(
      "update memory -> re-index -> search returns updated content",
      async () => {
        // Create a memory
        const memory = await system.store.create({
          metadata: {
            title: "Update Test",
            type: "semantic",
            tags: ["update"],
            importance: "medium",
            source: "integration-test",
          },
          content: "Original content about databases and SQL queries.",
          filePath: "semantic/update-test.md",
        });

        // Index original
        const origEmbed = await system.embedding.embed(memory.content);
        await system.searchIndex.index(
          Object.assign({}, memory, { embedding: origEmbed.vector }),
        );

        // Update via tools API
        const updateResult = await system.update({
          path: memory.filePath,
          content:
            "Updated content about NoSQL databases like MongoDB and Redis.",
          reason: "Changed focus to NoSQL",
        });

        expect(updateResult.success).toBe(true);

        // Search should find the updated content
        const searchResult = await system.search({
          query: "NoSQL MongoDB",
          limit: 5,
          minScore: 0.0,
        });

        const found = searchResult.results.find((r) =>
          r.content.includes("NoSQL"),
        );
        expect(found).toBeDefined();
      },
      TEST_TIMEOUT,
    );

    test(
      "delete memory -> remove from index -> search returns nothing",
      async () => {
        // Create a memory with unique content
        const memory = await system.store.create({
          metadata: {
            title: "Forgettable Memory",
            type: "procedural",
            tags: ["forget"],
            importance: "low",
            source: "integration-test",
          },
          content:
            "This memory about quantum entanglement will be forgotten soon.",
          filePath: "procedural/forget-test.md",
        });

        // Index it
        const embed = await system.embedding.embed(memory.content);
        await system.searchIndex.index(
          Object.assign({}, memory, { embedding: embed.vector }),
        );

        // Verify it's searchable
        const before = await system.search({
          query: "quantum entanglement",
          limit: 5,
          minScore: 0.0,
        });
        const foundBefore = before.results.find((r) =>
          r.content.includes("quantum"),
        );
        expect(foundBefore).toBeDefined();

        // Delete from store and index
        await system.store.delete(memory.metadata.id);
        await system.searchIndex.remove(memory.metadata.id);

        // Verify it's gone from search
        const after = await system.search({
          query: "quantum entanglement",
          limit: 5,
          minScore: 0.0,
        });
        const foundAfter = after.results.find((r) =>
          r.content.includes("quantum entanglement"),
        );
        expect(foundAfter).toBeUndefined();
      },
      TEST_TIMEOUT,
    );
  });
});
