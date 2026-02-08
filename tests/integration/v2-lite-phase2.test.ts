/**
 * Phase 2 v2-lite feature tests:
 *   1. getActiveConnectionCount (decay connection-awareness)
 *   2. memory_update with connection discovery (suggested_connections)
 *   3. splitAtHeadings / splitBulkFile (split-files migration)
 */

// -- SearchIndex tests require custom SQLite on macOS --------------------------
import { Database } from "bun:sqlite";
if (process.platform === "darwin") {
  Database.setCustomSQLite("/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib");
}

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createSearchIndex } from "../../src/search/index.ts";
import type { SearchIndex } from "../../src/search/types.ts";
import type { MemoryConfig } from "../../src/shared/config.ts";
import type { KnowledgeType } from "../../src/shared/types.ts";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import {
  splitAtHeadings,
  splitBulkFile,
} from "../../src/migration/split-files.ts";
import {
  cleanupTempDir,
  createTempDir,
} from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

// -- Helpers ------------------------------------------------------------------

function makeSearchConfig(sqlitePath: string): MemoryConfig {
  return {
    baseDir: "/tmp/agent-memory-test",
    sqlitePath,
    embeddingModel: "Xenova/all-MiniLM-L6-v2",
    embeddingDimensions: 384,
    hybridDefaults: {
      limit: 5,
      minScore: 0.0,
      weightFts: 0.3,
      weightVector: 0.5,
      weightRecency: 0.2,
      rrfK: 60,
    },
    maxCoreTokens: 4000,
  };
}

function makeKnowledgeEntry(
  id: string,
  type: KnowledgeType,
  overrides?: Partial<{
    title: string;
    filePath: string;
    createdAt: string;
    updatedAt: string;
    lastAccessed: string;
    accessCount: number;
    tags: string[];
  }>,
) {
  const now = new Date().toISOString();
  return {
    id,
    title: overrides?.title ?? `Entry ${id}`,
    type,
    filePath: overrides?.filePath ?? `/knowledge/${type}/${id}.md`,
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
    lastAccessed: overrides?.lastAccessed,
    accessCount: overrides?.accessCount ?? 0,
    tags: overrides?.tags ?? [],
  };
}

// =============================================================================
// 1. Decay Connection-Awareness (getActiveConnectionCount)
// =============================================================================

describe(
  "getActiveConnectionCount",
  () => {
    let tempDir: string;
    let idx: SearchIndex;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "phase2-active-conn-"));
      const config = makeSearchConfig(join(tempDir, "search.sqlite"));
      idx = createSearchIndex(config);
    });

    afterEach(() => {
      try {
        idx.close();
      } catch {
        // already closed
      }
      rmSync(tempDir, { recursive: true, force: true });
    });

    test("returns 0 for entries with no connections", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));

      const count = await idx.getActiveConnectionCount("dec-001");
      expect(count).toBe(0);
    });

    test("counts related, builds_on, contradicts, part_of connections", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("inc-001", "incident"));
      await idx.indexKnowledge(makeKnowledgeEntry("pat-001", "pattern"));

      await idx.insertConnection("dec-001", "dec-002", "related");
      await idx.insertConnection("dec-001", "dec-003", "builds_on");
      await idx.insertConnection("inc-001", "dec-001", "contradicts");
      await idx.insertConnection("pat-001", "dec-001", "part_of");

      const count = await idx.getActiveConnectionCount("dec-001");
      expect(count).toBe(4);
    });

    test("excludes supersedes connections from the count", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

      await idx.insertConnection("dec-001", "dec-002", "related");
      await idx.insertConnection("dec-001", "dec-003", "supersedes");

      const activeCount = await idx.getActiveConnectionCount("dec-001");
      // Only "related" should count; "supersedes" excluded
      expect(activeCount).toBe(1);

      // Verify getConnectionCount (total) includes supersedes
      const totalCount = await idx.getConnectionCount("dec-001");
      expect(totalCount).toBe(2);
    });

    test("excludes superseded_by connections from the count", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

      await idx.insertConnection("dec-001", "dec-002", "related");
      // Simulate an inverse superseded_by connection (stored as type string)
      await idx.insertConnection("dec-003", "dec-001", "supersedes");

      // dec-001 is the target of a supersedes connection
      const activeCount = await idx.getActiveConnectionCount("dec-001");
      // "related" outgoing counts, but "supersedes" incoming does NOT count
      expect(activeCount).toBe(1);
    });

    test("returns 0 for non-existent entry", async () => {
      const count = await idx.getActiveConnectionCount("non-existent");
      expect(count).toBe(0);
    });
  },
  { timeout: TEST_TIMEOUT },
);

// =============================================================================
// 2. memory_update with Connection Discovery
// =============================================================================

describe(
  "memory_update with Connection Discovery",
  () => {
    let tempDir: string;
    let system: MemorySystem;

    // Helper to create a v1 memory via store.create and index it for search
    async function createAndIndex(
      title: string,
      content: string,
      type: "semantic" | "episodic" | "procedural" = "semantic",
    ) {
      const memory = await system.store.create({
        metadata: {
          title,
          type,
          tags: [],
          importance: "medium",
          source: "integration-test",
        },
        content,
        filePath: "",
      });
      const embed = await system.embedding.embed(memory.content);
      await system.searchIndex.index(
        Object.assign({}, memory, { embedding: embed.vector }),
      );
      return memory;
    }

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
      "returns no suggested_connections when change is small (<20% length diff)",
      async () => {
        const originalContent =
          "This is a note about software architecture that should remain relatively stable over time and not trigger suggestions.";
        const memory = await createAndIndex(
          "Stable Entry",
          originalContent,
        );

        // Update with a very small change (swap a word, keep similar length)
        const tweaked =
          "This is a note about software architecture that should remain quite stable over time and not trigger any suggestions.";

        const result = await system.update({
          path: memory.filePath,
          content: tweaked,
          reason: "Minor wording tweak",
        });

        expect(result.success).toBe(true);
        // The change is well under 20%, so no suggested connections
        expect(
          result.suggested_connections === undefined ||
            result.suggested_connections === null ||
            (Array.isArray(result.suggested_connections) &&
              result.suggested_connections.length === 0),
        ).toBe(true);
      },
      TEST_TIMEOUT,
    );

    test(
      "returns suggested_connections array when change is significant (>20% length diff)",
      async () => {
        // Create some entries that could be related
        await createAndIndex(
          "TypeScript Best Practices",
          "Use strict mode, enable all compiler checks, prefer interfaces over types for object shapes. TypeScript patterns help maintain code quality.",
          "procedural",
        );

        await createAndIndex(
          "Code Quality Standards",
          "We decided to enforce strict TypeScript configurations and use Biome for linting. Code quality standards apply to all repositories.",
        );

        // Create a short entry we will expand significantly
        const target = await createAndIndex(
          "Linting Setup",
          "Use Biome.",
        );

        // Update with much more content (>20% length change)
        const expandedContent =
          "Use Biome for linting and formatting. Configure strict TypeScript compiler checks. " +
          "Enable all recommended rules. Run lint checks in CI pipeline. " +
          "Ensure code quality standards are met before merging. " +
          "TypeScript best practices should be followed across all modules.";

        const result = await system.update({
          path: target.filePath,
          content: expandedContent,
          reason: "Expanded linting guidelines significantly",
        });

        expect(result.success).toBe(true);
        expect(result.indexed).toBe(true);
        // Should have suggested_connections since content changed significantly
        expect(Array.isArray(result.suggested_connections)).toBe(true);
        expect(result.suggested_connections!.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUT,
    );

    test(
      "suggested_connections entries have correct shape: { id, title, relevance }",
      async () => {
        // Create related entries
        await createAndIndex(
          "Database Migration Strategy",
          "We use SQLite for local data storage with WAL mode enabled and foreign keys enforced.",
        );

        // Create a short entry we will expand
        const target = await createAndIndex(
          "Database Notes",
          "DB.",
        );

        // Expand significantly
        const result = await system.update({
          path: target.filePath,
          content:
            "SQLite database with WAL mode. Use foreign keys. " +
            "Database migration strategy involves careful schema changes. " +
            "All local data storage uses SQLite as the persistence layer.",
          reason: "Added database details",
        });

        expect(result.success).toBe(true);

        if (
          result.suggested_connections &&
          result.suggested_connections.length > 0
        ) {
          for (const suggestion of result.suggested_connections) {
            expect(typeof suggestion.id).toBe("string");
            expect(suggestion.id.length).toBeGreaterThan(0);
            expect(typeof suggestion.title).toBe("string");
            expect(suggestion.title.length).toBeGreaterThan(0);
            expect(typeof suggestion.relevance).toBe("number");
            expect(Number.isFinite(suggestion.relevance)).toBe(true);
          }
        }
      },
      TEST_TIMEOUT,
    );
  },
  { timeout: TEST_TIMEOUT },
);

// =============================================================================
// 3. split-files Migration
// =============================================================================

describe(
  "split-files migration",
  () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "phase2-split-"));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    // -- splitAtHeadings --------------------------------------------------------

    describe("splitAtHeadings", () => {
      test("correctly splits markdown at ## headings", () => {
        const raw = [
          "# Top Level Heading",
          "",
          "Some intro text.",
          "",
          "## Decision One",
          "",
          "We decided to use Bun.",
          "",
          "## Decision Two",
          "",
          "We decided to use SQLite.",
          "",
        ].join("\n");

        const sections = splitAtHeadings(raw);

        expect(sections.length).toBe(2);
        expect(sections[0]!.title).toBe("Decision One");
        expect(sections[0]!.content).toBe("We decided to use Bun.");
        expect(sections[1]!.title).toBe("Decision Two");
        expect(sections[1]!.content).toBe("We decided to use SQLite.");
      });

      test("handles frontmatter (skips --- blocks)", () => {
        const raw = [
          "---",
          "title: Bulk Decisions",
          "type: decision",
          "---",
          "",
          "## First Entry",
          "",
          "Content of first entry.",
          "",
          "## Second Entry",
          "",
          "Content of second entry.",
        ].join("\n");

        const sections = splitAtHeadings(raw);

        expect(sections.length).toBe(2);
        expect(sections[0]!.title).toBe("First Entry");
        expect(sections[0]!.content).toBe("Content of first entry.");
        expect(sections[1]!.title).toBe("Second Entry");
        expect(sections[1]!.content).toBe("Content of second entry.");
      });

      test("returns empty array for content without ## headings", () => {
        const raw = [
          "# Only a top-level heading",
          "",
          "Some paragraph text without any second-level headings.",
          "",
          "More text here.",
        ].join("\n");

        const sections = splitAtHeadings(raw);
        expect(sections).toEqual([]);
      });

      test("returns empty array for empty string", () => {
        const sections = splitAtHeadings("");
        expect(sections).toEqual([]);
      });
    });

    // -- splitBulkFile ----------------------------------------------------------

    describe("splitBulkFile", () => {
      test("creates individual files with frontmatter", () => {
        // Create a bulk file
        const bulkDir = join(tempDir, "semantic");
        mkdirSync(bulkDir, { recursive: true });

        const bulkContent = [
          "# Decisions",
          "",
          "## Use Repository Pattern",
          "",
          "We decided to use the repository pattern.",
          "",
          "## Choose SQLite",
          "",
          "SQLite was selected for local storage.",
        ].join("\n");

        writeFileSync(join(tempDir, "semantic", "decisions.md"), bulkContent);

        const result = splitBulkFile(
          tempDir,
          "semantic/decisions.md",
          "decision",
          "semantic/decisions",
        );

        expect(result.skipped).toBe(false);
        expect(result.createdFiles.length).toBe(2);

        // Verify individual files exist and have frontmatter
        for (const relPath of result.createdFiles) {
          const absPath = join(tempDir, relPath);
          expect(existsSync(absPath)).toBe(true);

          const content = readFileSync(absPath, "utf-8");
          // Should contain frontmatter delimiters
          expect(content.startsWith("---\n")).toBe(true);
          expect(content).toContain("type: decision");
          expect(content).toContain("id: dec-");
        }

        // Verify first file has correct title
        const firstFile = readFileSync(
          join(tempDir, result.createdFiles[0]!),
          "utf-8",
        );
        expect(firstFile).toContain("title: Use Repository Pattern");

        // Verify second file has correct title
        const secondFile = readFileSync(
          join(tempDir, result.createdFiles[1]!),
          "utf-8",
        );
        expect(secondFile).toContain("title: Choose SQLite");
      });

      test("removes the original bulk file", () => {
        const bulkDir = join(tempDir, "semantic");
        mkdirSync(bulkDir, { recursive: true });

        const bulkContent = [
          "## Single Entry",
          "",
          "Just one section.",
        ].join("\n");

        const bulkPath = join(tempDir, "semantic", "decisions.md");
        writeFileSync(bulkPath, bulkContent);

        expect(existsSync(bulkPath)).toBe(true);

        splitBulkFile(
          tempDir,
          "semantic/decisions.md",
          "decision",
          "semantic/decisions",
        );

        expect(existsSync(bulkPath)).toBe(false);
      });

      test("returns skipped:true for non-existent files", () => {
        const result = splitBulkFile(
          tempDir,
          "nonexistent/file.md",
          "decision",
          "semantic/decisions",
        );

        expect(result.skipped).toBe(true);
        expect(result.reason).toBe("File not found");
        expect(result.createdFiles).toEqual([]);
      });

      test("returns skipped:true when file has no ## sections", () => {
        const bulkDir = join(tempDir, "semantic");
        mkdirSync(bulkDir, { recursive: true });

        writeFileSync(
          join(tempDir, "semantic", "empty.md"),
          "# Title\n\nJust prose, no sections.\n",
        );

        const result = splitBulkFile(
          tempDir,
          "semantic/empty.md",
          "decision",
          "semantic/decisions",
        );

        expect(result.skipped).toBe(true);
        expect(result.reason).toBe("No ## sections found");
      });

      test("respects startCounter parameter", () => {
        const bulkDir = join(tempDir, "procedural");
        mkdirSync(bulkDir, { recursive: true });

        const bulkContent = [
          "## Pattern Alpha",
          "",
          "Alpha content.",
          "",
          "## Pattern Beta",
          "",
          "Beta content.",
        ].join("\n");

        writeFileSync(join(tempDir, "procedural", "patterns.md"), bulkContent);

        const result = splitBulkFile(
          tempDir,
          "procedural/patterns.md",
          "pattern",
          "procedural/patterns",
          10,
        );

        expect(result.skipped).toBe(false);
        expect(result.createdFiles.length).toBe(2);

        // First file should be pat-010, second pat-011
        const firstFile = readFileSync(
          join(tempDir, result.createdFiles[0]!),
          "utf-8",
        );
        expect(firstFile).toContain("id: pat-010");

        const secondFile = readFileSync(
          join(tempDir, result.createdFiles[1]!),
          "utf-8",
        );
        expect(secondFile).toContain("id: pat-011");
      });
    });
  },
  { timeout: TEST_TIMEOUT },
);
