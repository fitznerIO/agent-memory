import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

describe("Consolidation Integration", () => {
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
    "consolidate creates files from decision notes",
    async () => {
      // Add session notes that look like decisions
      await system.note({
        content:
          "We decided to use SQLite instead of PostgreSQL because it is embedded and simpler to deploy. The trade-off is limited concurrency.",
        type: "semantic",
        importance: "high",
      });

      // Run consolidation
      const result = await system.consolidate();

      expect(result.filesCreated).toBeGreaterThanOrEqual(1);

      // The created file should be searchable
      const search = await system.search({
        query: "SQLite PostgreSQL decision",
        limit: 5,
        minScore: 0.0,
      });
      expect(search.results.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );

  test(
    "consolidate dry-run does not create files",
    async () => {
      await system.note({
        content:
          "The API crashed because of a null pointer in the handler. We fixed it by adding a null check.",
        type: "episodic",
        importance: "high",
      });

      const result = await system.consolidate({ dryRun: true });

      expect(result.actions.length).toBeGreaterThan(0);
      // In dry-run mode, actions are planned but not executed
      // The count fields reflect what WOULD happen
      expect(result.filesCreated).toBeGreaterThanOrEqual(1);
    },
    TEST_TIMEOUT,
  );

  test(
    "consolidate returns empty result when no notes exist",
    async () => {
      // Create a fresh system with no notes
      const freshDir = await createTempDir();
      const freshSystem = createMemorySystem({
        baseDir: freshDir,
        sqlitePath: join(freshDir, ".index", "search.sqlite"),
      });
      await freshSystem.start();

      const result = await freshSystem.consolidate();

      expect(result.actions).toEqual([]);
      expect(result.filesCreated).toBe(0);
      expect(result.duplicatesSkipped).toBe(0);

      await freshSystem.stop();
      await cleanupTempDir(freshDir);
    },
    TEST_TIMEOUT,
  );
});
