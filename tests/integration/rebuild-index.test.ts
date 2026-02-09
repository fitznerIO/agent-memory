import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

describe("rebuild-index", () => {
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

  test(
    "rebuilds index from markdown files with re-embedding",
    async () => {
      // 1. Create some entries via memoryStore (writes markdown files + indexes)
      const entry1 = await system.memoryStore({
        title: "Use Bun Runtime",
        type: "decision",
        content: "We decided to use Bun as runtime because of speed.",
        tags: ["tech/bun", "tech/runtime"],
      });

      const entry2 = await system.memoryStore({
        title: "SSL Certificate Expired",
        type: "incident",
        content: "The SSL certificate expired and caused downtime.",
        tags: ["tech/infrastructure/ssl"],
      });

      // 2. Verify search works before rebuild
      const beforeSearch = await system.search({
        query: "Bun runtime",
        limit: 5,
        minScore: 0.0,
      });
      expect(
        beforeSearch.results.some((r) => r.content.includes("Bun")),
      ).toBe(true);

      // 3. Rebuild the index
      const result = await system.rebuildIndex();

      expect(result.totalDocuments).toBeGreaterThanOrEqual(2);
      expect(result.totalEmbeddings).toBeGreaterThanOrEqual(2);
      expect(result.knowledgeEntries).toBeGreaterThanOrEqual(2);
      expect(result.elapsed).toBeGreaterThan(0);

      // 4. Verify search still works after rebuild
      const afterSearch = await system.search({
        query: "Bun runtime",
        limit: 5,
        minScore: 0.0,
      });
      expect(afterSearch.results.some((r) => r.content.includes("Bun"))).toBe(
        true,
      );

      // 5. Verify knowledge entries are restored
      const knowledge = await system.searchIndex.getKnowledgeById(entry1.id);
      expect(knowledge).not.toBeNull();
      expect(knowledge!.title).toBe("Use Bun Runtime");
      expect(knowledge!.type).toBe("decision");

      // 6. Verify tags are restored
      const tags = await system.searchIndex.getTagsByEntryId(entry1.id);
      expect(tags).toContain("tech/bun");
      expect(tags).toContain("tech/runtime");
    },
    TEST_TIMEOUT,
  );

  test(
    "rebuild handles v1 format memories",
    async () => {
      // Create a v1 format memory via store.create
      await system.store.create({
        metadata: {
          title: "V1 Memory",
          type: "semantic",
          tags: ["legacy"],
          importance: "medium",
          source: "test",
        },
        content: "This is a v1 format memory about quantum computing.",
        filePath: "",
      });

      // Rebuild
      const result = await system.rebuildIndex();
      expect(result.totalDocuments).toBeGreaterThan(0);

      // V1 memory should be searchable after rebuild
      const search = await system.search({
        query: "quantum computing",
        limit: 5,
        minScore: 0.0,
      });
      expect(
        search.results.some((r) => r.content.includes("quantum")),
      ).toBe(true);
    },
    TEST_TIMEOUT,
  );
});
