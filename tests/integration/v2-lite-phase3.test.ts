/**
 * Phase 3 v2-lite feature tests:
 *   1. Hierarchical tag search in memory_search
 *   2. SearchIndex.getEntriesByTags (hierarchical prefix matching)
 *   3. SearchIndex.getConnectedEntryIds (bidirectional)
 *   4. Namespace tag migration (mapTag, migrateFileTags)
 */

// -- SearchIndex tests require custom SQLite on macOS --------------------------
import { Database } from "bun:sqlite";
if (process.platform === "darwin") {
  try {
    Database.setCustomSQLite("/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib");
  } catch {
    // Already configured by another test file
  }
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
import { mapTag, migrateFileTags } from "../../src/migration/namespace-tags.ts";
import { serializeMarkdown } from "../../src/memory/parser.ts";
import {
  cleanupTempDir,
  createTempDir,
} from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

// -- Helpers ------------------------------------------------------------------

function makeSearchConfig(sqlitePath: string): MemoryConfig {
  return {
    baseDir: "/tmp/claude/agent-memory-phase3-test",
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
// 1. Hierarchical Tag Search in memory_search
// =============================================================================

describe("Hierarchical Tag Search via system.search()", () => {
  let tempDir: string;
  let system: MemorySystem;

  beforeAll(async () => {
    tempDir = await createTempDir();
    system = createMemorySystem({
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
    });
    await system.start();

    // Create entries with hierarchical tags
    await system.memoryStore({
      title: "Claude SDK Integration",
      type: "decision",
      content:
        "We decided to use the Claude SDK for all AI interactions in the project.",
      tags: ["tech/ai/claude-sdk"],
    });

    await system.memoryStore({
      title: "OpenAI Fallback Strategy",
      type: "decision",
      content:
        "OpenAI is used as a fallback when the primary AI provider is unavailable.",
      tags: ["tech/ai/openai"],
    });

    await system.memoryStore({
      title: "SQLite Storage Decision",
      type: "decision",
      content:
        "SQLite was selected for local persistent storage with WAL mode.",
      tags: ["tech/data/sqlite"],
    });
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
    "search with exact tag filter returns matching entries",
    async () => {
      const result = await system.search({
        query: "AI integration",
        tags: ["tech/ai/claude-sdk"],
        minScore: 0.0,
        limit: 10,
      });

      expect(result.results.length).toBeGreaterThanOrEqual(1);
      const titles = result.results.map((r) => r.title);
      expect(titles).toContain("Claude SDK Integration");
      // Should NOT include SQLite entry
      expect(titles).not.toContain("SQLite Storage Decision");
    },
    TEST_TIMEOUT,
  );

  test(
    "search with prefix tag returns all entries under that namespace",
    async () => {
      const result = await system.search({
        query: "AI provider decision",
        tags: ["tech/ai"],
        minScore: 0.0,
        limit: 10,
      });

      expect(result.results.length).toBeGreaterThanOrEqual(2);
      const titles = result.results.map((r) => r.title);
      expect(titles).toContain("Claude SDK Integration");
      expect(titles).toContain("OpenAI Fallback Strategy");
      // SQLite is under tech/data, not tech/ai
      expect(titles).not.toContain("SQLite Storage Decision");
    },
    TEST_TIMEOUT,
  );

  test(
    "search with connected_to filter returns only connected entries",
    async () => {
      // Create two connected entries
      const source = await system.memoryStore({
        title: "Microservice Architecture",
        type: "pattern",
        content: "We use a microservice architecture for deployment isolation.",
        tags: ["architecture"],
      });

      const target = await system.memoryStore({
        title: "Docker Deployment",
        type: "workflow",
        content: "Docker containers are used for each microservice deployment.",
        tags: ["infrastructure"],
      });

      // Connect them
      await system.memoryConnect({
        source_id: source.id,
        target_id: target.id,
        type: "related",
      });

      // Search with connected_to filter
      const result = await system.search({
        query: "microservice deployment",
        connected_to: source.id,
        minScore: 0.0,
        limit: 10,
      });

      // Should include target (connected to source)
      const ids = result.results.map((r) => r.id);
      expect(ids).toContain(target.id);
      // Should NOT include source itself or unrelated entries
      expect(ids).not.toContain(source.id);
    },
    TEST_TIMEOUT,
  );

  test(
    "search results include v2-lite fields: id, title, tags, connections",
    async () => {
      const result = await system.search({
        query: "Claude SDK AI",
        tags: ["tech/ai/claude-sdk"],
        minScore: 0.0,
        limit: 5,
      });

      expect(result.results.length).toBeGreaterThanOrEqual(1);
      const entry = result.results.find(
        (r) => r.title === "Claude SDK Integration",
      );
      expect(entry).toBeDefined();
      expect(typeof entry!.id).toBe("string");
      expect((entry!.id ?? "").length).toBeGreaterThan(0);
      expect(entry!.title).toBe("Claude SDK Integration");
      expect(Array.isArray(entry!.tags)).toBe(true);
      expect(entry!.tags).toContain("tech/ai/claude-sdk");
      // connections should be an array (possibly empty)
      expect(Array.isArray(entry!.connections)).toBe(true);
    },
    TEST_TIMEOUT,
  );
});

// =============================================================================
// 2. SearchIndex.getEntriesByTags
// =============================================================================

describe("SearchIndex.getEntriesByTags", () => {
  let tempDir: string;
  let idx: SearchIndex;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "phase3-tags-"));
    const config = makeSearchConfig(join(tempDir, "search.sqlite"));
    idx = createSearchIndex(config);

    // Set up entries with hierarchical tags
    await idx.indexKnowledge(
      makeKnowledgeEntry("dec-001", "decision", { title: "AI Decision" }),
    );
    await idx.insertTags("dec-001", ["tech/ai/claude"]);

    await idx.indexKnowledge(
      makeKnowledgeEntry("dec-002", "decision", { title: "AI OpenAI" }),
    );
    await idx.insertTags("dec-002", ["tech/ai/openai"]);

    await idx.indexKnowledge(
      makeKnowledgeEntry("dec-003", "decision", { title: "DB Choice" }),
    );
    await idx.insertTags("dec-003", ["tech/data/sqlite"]);

    await idx.indexKnowledge(
      makeKnowledgeEntry("pat-001", "pattern", { title: "Pattern" }),
    );
    await idx.insertTags("pat-001", ["tech/ai/claude", "tech/data/sqlite"]);
  });

  afterEach(() => {
    try {
      idx.close();
    } catch {
      // already closed
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns entry IDs matching exact tags", async () => {
    const ids = await idx.getEntriesByTags(["tech/ai/claude"]);
    expect(ids).toContain("dec-001");
    expect(ids).toContain("pat-001");
    expect(ids).not.toContain("dec-002");
    expect(ids).not.toContain("dec-003");
  });

  test("returns entry IDs matching hierarchical prefix", async () => {
    // "tech/ai" should match tech/ai/claude and tech/ai/openai
    const ids = await idx.getEntriesByTags(["tech/ai"]);
    expect(ids).toContain("dec-001");
    expect(ids).toContain("dec-002");
    expect(ids).toContain("pat-001");
    expect(ids).not.toContain("dec-003");
  });

  test("returns empty array for non-matching tags", async () => {
    const ids = await idx.getEntriesByTags(["nonexistent/tag"]);
    expect(ids).toEqual([]);
  });

  test("handles multiple tags with OR logic (returns union)", async () => {
    // tech/ai/claude OR tech/data/sqlite
    const ids = await idx.getEntriesByTags([
      "tech/ai/claude",
      "tech/data/sqlite",
    ]);
    // dec-001 (claude), dec-003 (sqlite), pat-001 (both)
    expect(ids).toContain("dec-001");
    expect(ids).toContain("dec-003");
    expect(ids).toContain("pat-001");
    // dec-002 has openai, not in the filter
    expect(ids).not.toContain("dec-002");
  });
});

// =============================================================================
// 3. SearchIndex.getConnectedEntryIds
// =============================================================================

describe("SearchIndex.getConnectedEntryIds", () => {
  let tempDir: string;
  let idx: SearchIndex;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "phase3-conn-"));
    const config = makeSearchConfig(join(tempDir, "search.sqlite"));
    idx = createSearchIndex(config);

    await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
    await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
    await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));
    await idx.indexKnowledge(makeKnowledgeEntry("pat-001", "pattern"));
  });

  afterEach(() => {
    try {
      idx.close();
    } catch {
      // already closed
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns connected entry IDs in both directions", async () => {
    // dec-001 -> dec-002 (outgoing)
    await idx.insertConnection("dec-001", "dec-002", "related");
    // dec-003 -> dec-001 (dec-001 is the target, i.e. incoming)
    await idx.insertConnection("dec-003", "dec-001", "builds_on");

    const ids = await idx.getConnectedEntryIds("dec-001");
    expect(ids).toContain("dec-002");
    expect(ids).toContain("dec-003");
    expect(ids).not.toContain("dec-001"); // should not contain self
  });

  test("returns empty array for entries with no connections", async () => {
    const ids = await idx.getConnectedEntryIds("pat-001");
    expect(ids).toEqual([]);
  });

  test("returns empty array for non-existent entries", async () => {
    const ids = await idx.getConnectedEntryIds("does-not-exist");
    expect(ids).toEqual([]);
  });
});

// =============================================================================
// 4. Namespace Tag Migration
// =============================================================================

describe("Namespace Tag Migration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "phase3-migration-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // -- mapTag -----------------------------------------------------------------

  describe("mapTag", () => {
    test("maps known flat tags to namespaces", () => {
      expect(mapTag("claude-sdk")).toBe("tech/ai/claude-sdk");
      expect(mapTag("typescript")).toBe("tech/lang/typescript");
      expect(mapTag("sqlite")).toBe("tech/data/sqlite");
      expect(mapTag("docker")).toBe("tech/infrastructure/docker");
      expect(mapTag("react")).toBe("tech/web/react");
    });

    test("preserves tags that already have namespaces", () => {
      expect(mapTag("tech/ai/foo")).toBe("tech/ai/foo");
      expect(mapTag("custom/namespace/tag")).toBe("custom/namespace/tag");
    });

    test("prefixes unknown tags with _untagged/", () => {
      expect(mapTag("my-random-tag")).toBe("_untagged/my-random-tag");
      expect(mapTag("foobar")).toBe("_untagged/foobar");
    });
  });

  // -- migrateFileTags --------------------------------------------------------

  describe("migrateFileTags", () => {
    test("updates frontmatter in markdown files with flat tags", () => {
      const filePath = join(tempDir, "test-migrate.md");
      const content = serializeMarkdown({
        frontmatter: {
          id: "dec-001",
          title: "Test Decision",
          type: "decision",
          tags: ["typescript", "sqlite", "claude-sdk"],
        },
        body: "Some decision content.",
      });
      writeFileSync(filePath, content);

      const result = migrateFileTags(filePath);

      expect(result.unchanged).toBe(false);
      expect(result.originalTags).toEqual([
        "typescript",
        "sqlite",
        "claude-sdk",
      ]);
      expect(result.migratedTags).toEqual([
        "tech/lang/typescript",
        "tech/data/sqlite",
        "tech/ai/claude-sdk",
      ]);

      // Verify the file was actually updated on disk
      const updatedRaw = readFileSync(filePath, "utf-8");
      expect(updatedRaw).toContain("tech/lang/typescript");
      expect(updatedRaw).toContain("tech/data/sqlite");
      expect(updatedRaw).toContain("tech/ai/claude-sdk");
    });

    test("skips files with no tags and returns unchanged:true", () => {
      const filePath = join(tempDir, "no-tags.md");
      const content = serializeMarkdown({
        frontmatter: {
          id: "dec-002",
          title: "No Tags",
          type: "decision",
        },
        body: "Content without tags.",
      });
      writeFileSync(filePath, content);

      const result = migrateFileTags(filePath);

      expect(result.unchanged).toBe(true);
      expect(result.originalTags).toEqual([]);
      expect(result.migratedTags).toEqual([]);
    });

    test("returns unchanged:true when tags are already namespaced", () => {
      const filePath = join(tempDir, "already-namespaced.md");
      const content = serializeMarkdown({
        frontmatter: {
          id: "dec-003",
          title: "Already Namespaced",
          type: "decision",
          tags: ["tech/ai/claude", "tech/data/sqlite"],
        },
        body: "Already migrated content.",
      });
      writeFileSync(filePath, content);

      const result = migrateFileTags(filePath);

      expect(result.unchanged).toBe(true);
      expect(result.originalTags).toEqual([
        "tech/ai/claude",
        "tech/data/sqlite",
      ]);
      expect(result.migratedTags).toEqual([
        "tech/ai/claude",
        "tech/data/sqlite",
      ]);
    });
  });
});
