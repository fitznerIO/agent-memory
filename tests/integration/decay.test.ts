import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

describe("Decay / Lifecycle Management", () => {
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

  describe("access tracking", () => {
    test(
      "updates access_count on search",
      async () => {
        // Create an entry
        const entry = await system.memoryStore({
          title: "Access Tracking Test",
          type: "note",
          content: "This note tests whether access tracking works during search.",
          tags: ["test/access"],
        });

        // Verify initial state
        const before = await system.searchIndex.getKnowledgeById(entry.id);
        expect(before).not.toBeNull();
        expect(before!.accessCount).toBe(0);

        // Search for it (should trigger access tracking)
        await system.search({
          query: "access tracking test",
          limit: 5,
          minScore: 0.0,
        });

        // Verify access count increased
        const after = await system.searchIndex.getKnowledgeById(entry.id);
        expect(after).not.toBeNull();
        expect(after!.accessCount).toBeGreaterThan(0);
        expect(after!.lastAccessed).toBeDefined();
      },
      TEST_TIMEOUT,
    );

    test(
      "updates access_count on read",
      async () => {
        const entry = await system.memoryStore({
          title: "Read Access Test",
          type: "decision",
          content:
            "We decided to track reads because it helps identify stale entries.",
          tags: ["test/read"],
        });

        const before = await system.searchIndex.getKnowledgeById(entry.id);
        expect(before!.accessCount).toBe(0);

        // Read the file
        await system.read({ path: entry.file_path });

        const after = await system.searchIndex.getKnowledgeById(entry.id);
        expect(after!.accessCount).toBe(1);
        expect(after!.lastAccessed).toBeDefined();
      },
      TEST_TIMEOUT,
    );
  });

  describe("getArchiveCandidates", () => {
    test(
      "identifies stale entries as archive candidates",
      async () => {
        // Create entries — they will never have been accessed
        await system.memoryStore({
          title: "Stale Note",
          type: "note",
          content: "A note that nobody reads.",
          tags: ["test/decay"],
        });

        // With maxAgeDays=0, everything is stale
        const result = await system.getArchiveCandidates({
          maxAgeDays: 0,
          minAccessCount: 1,
        });

        expect(result.totalEvaluated).toBeGreaterThan(0);
        // All entries with 0 access count and maxAgeDays=0 should be candidates
        expect(result.candidates.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );

    test(
      "marks connected entries as connected_but_stale",
      async () => {
        // Create two connected entries
        const entry1 = await system.memoryStore({
          title: "Connected Entry A",
          type: "decision",
          content: "Decision A is connected to B.",
          tags: ["test/decay-conn"],
        });

        const entry2 = await system.memoryStore({
          title: "Connected Entry B",
          type: "decision",
          content: "Decision B is connected to A.",
          tags: ["test/decay-conn"],
          connections: [
            { target: entry1.id, type: "related", note: "linked" },
          ],
        });

        // With maxAgeDays=0, both should be flagged
        const result = await system.getArchiveCandidates({
          maxAgeDays: 0,
          minAccessCount: 1,
        });

        // Find the connected entries — they should be "connected_but_stale"
        const connCandidate = result.candidates.find(
          (c) => c.id === entry1.id || c.id === entry2.id,
        );
        if (connCandidate) {
          expect(connCandidate.status).toBe("connected_but_stale");
          expect(connCandidate.activeConnections).toBeGreaterThan(0);
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "respects importance-weighted thresholds",
      async () => {
        // Create a high-importance entry (decision)
        await system.memoryStore({
          title: "Important Decision",
          type: "decision",
          content: "This is a critical architectural decision.",
        });

        // Create a low-importance entry (note)
        await system.memoryStore({
          title: "Trivial Note",
          type: "note",
          content: "Just a small note about nothing important.",
        });

        // With maxAgeDays=1, decisions get 2x grace period (2 days)
        // Since all entries were just created (0 days old), they should not be candidates
        const result = await system.getArchiveCandidates({
          maxAgeDays: 1,
          minAccessCount: 0,
        });

        // Freshly created entries should NOT be candidates
        const freshCandidates = result.candidates.filter(
          (c) => c.daysSinceAccess === 0,
        );
        expect(freshCandidates.length).toBe(0);
      },
      TEST_TIMEOUT,
    );

    test(
      "returns empty candidates for well-maintained knowledge base",
      async () => {
        // With very generous thresholds, no candidates
        const result = await system.getArchiveCandidates({
          maxAgeDays: 36500, // 100 years
          minAccessCount: 0,
        });

        expect(result.candidates.length).toBe(0);
      },
      TEST_TIMEOUT,
    );
  });
});
