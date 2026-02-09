import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSearchIndex } from "../../src/search/index.ts";
import type { SearchIndex, ConnectionRow } from "../../src/search/types.ts";
import type { MemoryConfig } from "../../src/shared/config.ts";
import type { KnowledgeEntry, KnowledgeType } from "../../src/shared/types.ts";

// -- Helpers ------------------------------------------------------------------

function makeConfig(sqlitePath: string): MemoryConfig {
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
  overrides?: Partial<Omit<KnowledgeEntry, "connections">>,
): Omit<KnowledgeEntry, "connections"> {
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

// -- Test suite ---------------------------------------------------------------

describe("SearchIndex v2-lite", () => {
  let tempDir: string;
  let idx: SearchIndex;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "search-v2-lite-test-"));
    const config = makeConfig(join(tempDir, "search.sqlite"));
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

  // -- indexKnowledge ---------------------------------------------------------

  describe("indexKnowledge", () => {
    test("inserts a knowledge entry", async () => {
      const entry = makeKnowledgeEntry("dec-001", "decision", {
        title: "Use Bun for runtime",
        tags: ["runtime", "bun"],
      });

      await idx.indexKnowledge(entry);

      const result = await idx.getKnowledgeById("dec-001");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("dec-001");
      expect(result!.title).toBe("Use Bun for runtime");
      expect(result!.type).toBe("decision");
      expect(result!.filePath).toBe("/knowledge/decision/dec-001.md");
      expect(result!.accessCount).toBe(0);
    });

    test("replaces an existing entry on re-index (same id)", async () => {
      const entry1 = makeKnowledgeEntry("dec-001", "decision", {
        title: "Original title",
      });
      await idx.indexKnowledge(entry1);

      const entry2 = makeKnowledgeEntry("dec-001", "decision", {
        title: "Updated title",
        accessCount: 5,
      });
      await idx.indexKnowledge(entry2);

      const result = await idx.getKnowledgeById("dec-001");
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Updated title");
      expect(result!.accessCount).toBe(5);
    });

    test("stores lastAccessed as null when not provided", async () => {
      const entry = makeKnowledgeEntry("dec-001", "decision");
      // lastAccessed is undefined by default in makeKnowledgeEntry
      await idx.indexKnowledge(entry);

      const result = await idx.getKnowledgeById("dec-001");
      expect(result).not.toBeNull();
      expect(result!.lastAccessed).toBeUndefined();
    });

    test("stores lastAccessed when provided", async () => {
      const ts = "2025-06-01T12:00:00.000Z";
      const entry = makeKnowledgeEntry("dec-001", "decision", {
        lastAccessed: ts,
      });
      await idx.indexKnowledge(entry);

      const result = await idx.getKnowledgeById("dec-001");
      expect(result).not.toBeNull();
      expect(result!.lastAccessed).toBe(ts);
    });
  });

  // -- removeKnowledge --------------------------------------------------------

  describe("removeKnowledge", () => {
    test("removes a knowledge entry", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
      await idx.removeKnowledge("dec-001");

      const result = await idx.getKnowledgeById("dec-001");
      expect(result).toBeNull();
    });

    test("cascades removal to tags", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
      await idx.insertTags("dec-001", ["architecture", "database"]);

      // Verify tags exist before removal
      const tagsBefore = await idx.getTagsByEntryId("dec-001");
      expect(tagsBefore.length).toBe(2);

      await idx.removeKnowledge("dec-001");

      // Tags should be gone
      const tagsAfter = await idx.getTagsByEntryId("dec-001");
      expect(tagsAfter.length).toBe(0);
    });

    test("cascades removal to connections (both source and target)", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

      // dec-001 is source in one connection, target in another
      await idx.insertConnection("dec-001", "dec-002", "related");
      await idx.insertConnection("dec-003", "dec-001", "builds_on");

      // Verify connections exist
      const countBefore = await idx.getConnectionCount("dec-001");
      expect(countBefore).toBe(2);

      await idx.removeKnowledge("dec-001");

      // Both connections should be removed
      const countAfter = await idx.getConnectionCount("dec-001");
      expect(countAfter).toBe(0);

      // Also verify from the perspective of the other entries
      const dec002Conns = await idx.getConnections("dec-002", "both");
      expect(dec002Conns.length).toBe(0);

      const dec003Conns = await idx.getConnections("dec-003", "both");
      expect(dec003Conns.length).toBe(0);
    });

    test("no-ops when removing non-existent id", async () => {
      // Should not throw
      await idx.removeKnowledge("non-existent-id");
    });
  });

  // -- getKnowledgeById -------------------------------------------------------

  describe("getKnowledgeById", () => {
    test("returns null for non-existent id", async () => {
      const result = await idx.getKnowledgeById("non-existent");
      expect(result).toBeNull();
    });

    test("returns full entry with tags populated", async () => {
      await idx.indexKnowledge(
        makeKnowledgeEntry("dec-001", "decision", {
          title: "Choose PostgreSQL",
        }),
      );
      await idx.insertTags("dec-001", ["database", "postgres"]);

      const result = await idx.getKnowledgeById("dec-001");
      expect(result).not.toBeNull();
      expect(result!.tags).toEqual(["database", "postgres"]);
    });

    test("returns full entry with connections populated", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("inc-001", "incident"));

      // Forward + inverse rows (mimics memoryConnect behavior)
      await idx.insertConnection("dec-001", "dec-002", "related", "Same topic");
      await idx.insertConnection("dec-002", "dec-001", "related", "Same topic");
      await idx.insertConnection("inc-001", "dec-001", "builds_on");
      await idx.insertConnection("dec-001", "inc-001", "extended_by");

      const result = await idx.getKnowledgeById("dec-001");
      expect(result).not.toBeNull();
      expect(result!.connections.length).toBe(2);

      // One outgoing connection (dec-001 -> dec-002)
      const outgoing = result!.connections.find((c) => c.target === "dec-002");
      expect(outgoing).toBeDefined();
      expect(outgoing!.type).toBe("related");
      expect(outgoing!.note).toBe("Same topic");

      // Inverse of incoming connection (inc-001 builds_on dec-001 → dec-001 extended_by inc-001)
      const inverse = result!.connections.find((c) => c.target === "inc-001");
      expect(inverse).toBeDefined();
      expect(inverse!.type).toBe("extended_by");
    });

    test("returns entry with empty tags and connections when none exist", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));

      const result = await idx.getKnowledgeById("dec-001");
      expect(result).not.toBeNull();
      expect(result!.tags).toEqual([]);
      expect(result!.connections).toEqual([]);
    });
  });

  // -- getNextSequentialId ----------------------------------------------------

  describe("getNextSequentialId", () => {
    test("returns prefix-001 for first entry of a type", async () => {
      const id = await idx.getNextSequentialId("decision");
      expect(id).toBe("dec-001");
    });

    test("increments from existing entries", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));

      const id = await idx.getNextSequentialId("decision");
      expect(id).toBe("dec-003");
    });

    test("maintains independent sequences per type", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("inc-001", "incident"));

      const nextDecision = await idx.getNextSequentialId("decision");
      expect(nextDecision).toBe("dec-003");

      const nextIncident = await idx.getNextSequentialId("incident");
      expect(nextIncident).toBe("inc-002");

      // A type with no entries yet
      const nextEntity = await idx.getNextSequentialId("entity");
      expect(nextEntity).toBe("entity-001");
    });

    test("uses correct prefix for each type", async () => {
      const prefixMap: Array<[KnowledgeType, string]> = [
        ["decision", "dec-001"],
        ["incident", "inc-001"],
        ["entity", "entity-001"],
        ["pattern", "pat-001"],
        ["workflow", "wf-001"],
        ["note", "note-001"],
        ["session", "session-001"],
      ];

      for (const [type, expectedId] of prefixMap) {
        const id = await idx.getNextSequentialId(type);
        expect(id).toBe(expectedId);
      }
    });

    test("pads sequential numbers with leading zeros", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));

      const next = await idx.getNextSequentialId("decision");
      expect(next).toBe("dec-002");
      // Verify it has 3-digit zero-padded format
      expect(next).toMatch(/^dec-\d{3}$/);
    });

    test("handles gaps in sequence (uses MAX not count)", async () => {
      // Insert dec-001 and dec-005 (skipping 002-004)
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-005", "decision"));

      const next = await idx.getNextSequentialId("decision");
      // Should be dec-006 based on MAX(id), not dec-003 based on COUNT
      expect(next).toBe("dec-006");
    });
  });

  // -- insertTags / removeTags / getExistingTags / getTagsByEntryId -----------

  describe("Tag operations", () => {
    describe("insertTags", () => {
      test("inserts tags for an entry", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.insertTags("dec-001", ["architecture", "database"]);

        const tags = await idx.getTagsByEntryId("dec-001");
        expect(tags).toContain("architecture");
        expect(tags).toContain("database");
        expect(tags.length).toBe(2);
      });

      test("stores tags as lowercase (case-insensitive)", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.insertTags("dec-001", ["Architecture", "DATABASE", "TypeScript"]);

        const tags = await idx.getTagsByEntryId("dec-001");
        expect(tags).toContain("architecture");
        expect(tags).toContain("database");
        expect(tags).toContain("typescript");
        // Original casing should not be stored
        expect(tags).not.toContain("Architecture");
        expect(tags).not.toContain("DATABASE");
      });

      test("ignores duplicate tags (INSERT OR IGNORE)", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.insertTags("dec-001", ["bun", "bun", "typescript"]);

        const tags = await idx.getTagsByEntryId("dec-001");
        expect(tags.length).toBe(2);
        expect(tags).toContain("bun");
        expect(tags).toContain("typescript");
      });

      test("handles empty tags array without error", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.insertTags("dec-001", []);

        const tags = await idx.getTagsByEntryId("dec-001");
        expect(tags.length).toBe(0);
      });

      test("can add tags incrementally", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.insertTags("dec-001", ["tag-a"]);
        await idx.insertTags("dec-001", ["tag-b", "tag-c"]);

        const tags = await idx.getTagsByEntryId("dec-001");
        expect(tags.length).toBe(3);
        expect(tags).toContain("tag-a");
        expect(tags).toContain("tag-b");
        expect(tags).toContain("tag-c");
      });
    });

    describe("removeTags", () => {
      test("removes all tags for an entry", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.insertTags("dec-001", ["tag-a", "tag-b", "tag-c"]);

        await idx.removeTags("dec-001");

        const tags = await idx.getTagsByEntryId("dec-001");
        expect(tags.length).toBe(0);
      });

      test("does not affect tags of other entries", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.insertTags("dec-001", ["shared-tag", "only-001"]);
        await idx.insertTags("dec-002", ["shared-tag", "only-002"]);

        await idx.removeTags("dec-001");

        const tags001 = await idx.getTagsByEntryId("dec-001");
        expect(tags001.length).toBe(0);

        const tags002 = await idx.getTagsByEntryId("dec-002");
        expect(tags002.length).toBe(2);
        expect(tags002).toContain("shared-tag");
        expect(tags002).toContain("only-002");
      });

      test("no-ops when entry has no tags", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        // Should not throw
        await idx.removeTags("dec-001");
      });
    });

    describe("getExistingTags", () => {
      test("returns all distinct tags sorted alphabetically", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.insertTags("dec-001", ["database", "architecture"]);
        await idx.insertTags("dec-002", ["database", "performance"]);

        const tags = await idx.getExistingTags();
        expect(tags).toEqual(["architecture", "database", "performance"]);
      });

      test("returns empty array when no tags exist", async () => {
        const tags = await idx.getExistingTags();
        expect(tags).toEqual([]);
      });

      test("deduplicates tags across entries", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("inc-001", "incident"));

        await idx.insertTags("dec-001", ["bun", "typescript"]);
        await idx.insertTags("dec-002", ["bun", "sqlite"]);
        await idx.insertTags("inc-001", ["bun", "production"]);

        const tags = await idx.getExistingTags();
        // "bun" appears 3 times but should only be listed once
        expect(tags.filter((t) => t === "bun").length).toBe(1);
        expect(tags).toEqual(["bun", "production", "sqlite", "typescript"]);
      });
    });

    describe("getTagsByEntryId", () => {
      test("returns tags sorted alphabetically", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.insertTags("dec-001", ["zebra", "apple", "mango"]);

        const tags = await idx.getTagsByEntryId("dec-001");
        expect(tags).toEqual(["apple", "mango", "zebra"]);
      });

      test("returns empty array for non-existent entry", async () => {
        const tags = await idx.getTagsByEntryId("non-existent");
        expect(tags).toEqual([]);
      });
    });
  });

  // -- Connection operations --------------------------------------------------

  describe("Connection operations", () => {
    describe("insertConnection", () => {
      test("inserts a connection between two entries", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related");

        const conns = await idx.getConnections("dec-001", "outgoing");
        expect(conns.length).toBe(1);
        expect(conns[0]!.source_id).toBe("dec-001");
        expect(conns[0]!.target_id).toBe("dec-002");
        expect(conns[0]!.type).toBe("related");
        expect(conns[0]!.note).toBeNull();
        expect(conns[0]!.created_at).toBeTruthy();
      });

      test("inserts a connection with a note", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("inc-001", "incident"));

        await idx.insertConnection(
          "dec-001",
          "inc-001",
          "builds_on",
          "Decision made after this incident",
        );

        const conns = await idx.getConnections("dec-001", "outgoing");
        expect(conns.length).toBe(1);
        expect(conns[0]!.note).toBe("Decision made after this incident");
      });

      test("replaces connection on re-insert (same source, target, type)", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related", "Original note");
        await idx.insertConnection("dec-001", "dec-002", "related", "Updated note");

        const conns = await idx.getConnections("dec-001", "outgoing");
        expect(conns.length).toBe(1);
        expect(conns[0]!.note).toBe("Updated note");
      });

      test("allows multiple connection types between same entries", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related");
        await idx.insertConnection("dec-001", "dec-002", "builds_on");

        const conns = await idx.getConnections("dec-001", "outgoing");
        expect(conns.length).toBe(2);
        const types = conns.map((c) => c.type);
        expect(types).toContain("related");
        expect(types).toContain("builds_on");
      });

      test("stores created_at as ISO timestamp", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related");

        const conns = await idx.getConnections("dec-001", "outgoing");
        expect(conns.length).toBe(1);
        // Validate ISO 8601 format
        const date = new Date(conns[0]!.created_at);
        expect(date.toISOString()).toBe(conns[0]!.created_at);
      });
    });

    describe("removeConnections", () => {
      test("removes all connections where entry is source", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related");
        await idx.insertConnection("dec-001", "dec-003", "builds_on");

        await idx.removeConnections("dec-001");

        const conns = await idx.getConnections("dec-001", "outgoing");
        expect(conns.length).toBe(0);
      });

      test("removes all connections where entry is target", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

        await idx.insertConnection("dec-002", "dec-001", "related");
        await idx.insertConnection("dec-003", "dec-001", "builds_on");

        await idx.removeConnections("dec-001");

        const conns = await idx.getConnections("dec-001", "incoming");
        expect(conns.length).toBe(0);
      });

      test("removes connections in both directions", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related"); // outgoing
        await idx.insertConnection("dec-003", "dec-001", "builds_on"); // incoming

        await idx.removeConnections("dec-001");

        const count = await idx.getConnectionCount("dec-001");
        expect(count).toBe(0);
      });

      test("does not affect connections between other entries", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related");
        await idx.insertConnection("dec-002", "dec-003", "builds_on");

        await idx.removeConnections("dec-001");

        // Connection between dec-002 and dec-003 should survive
        const conns = await idx.getConnections("dec-002", "outgoing");
        expect(conns.length).toBe(1);
        expect(conns[0]!.target_id).toBe("dec-003");
      });

      test("no-ops when entry has no connections", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        // Should not throw
        await idx.removeConnections("dec-001");
      });
    });

    describe("getConnections", () => {
      test("returns outgoing connections only", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related");
        await idx.insertConnection("dec-003", "dec-001", "builds_on"); // incoming

        const outgoing = await idx.getConnections("dec-001", "outgoing");
        expect(outgoing.length).toBe(1);
        expect(outgoing[0]!.source_id).toBe("dec-001");
        expect(outgoing[0]!.target_id).toBe("dec-002");
      });

      test("returns incoming connections only", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related"); // outgoing from dec-001
        await idx.insertConnection("dec-003", "dec-001", "builds_on"); // incoming to dec-001

        const incoming = await idx.getConnections("dec-001", "incoming");
        expect(incoming.length).toBe(1);
        expect(incoming[0]!.source_id).toBe("dec-003");
        expect(incoming[0]!.target_id).toBe("dec-001");
      });

      test("returns both directions", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related");
        await idx.insertConnection("dec-003", "dec-001", "builds_on");

        const both = await idx.getConnections("dec-001", "both");
        expect(both.length).toBe(2);

        const sourceIds = both.map((c) => c.source_id);
        expect(sourceIds).toContain("dec-001");
        expect(sourceIds).toContain("dec-003");
      });

      test("filters by connection type", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-004", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related");
        await idx.insertConnection("dec-001", "dec-003", "builds_on");
        await idx.insertConnection("dec-001", "dec-004", "contradicts");

        const relatedOnly = await idx.getConnections("dec-001", "outgoing", [
          "related",
        ]);
        expect(relatedOnly.length).toBe(1);
        expect(relatedOnly[0]!.target_id).toBe("dec-002");
      });

      test("filters by multiple connection types", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-004", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related");
        await idx.insertConnection("dec-001", "dec-003", "builds_on");
        await idx.insertConnection("dec-001", "dec-004", "contradicts");

        const filtered = await idx.getConnections("dec-001", "outgoing", [
          "related",
          "contradicts",
        ]);
        expect(filtered.length).toBe(2);
        const targets = filtered.map((c) => c.target_id);
        expect(targets).toContain("dec-002");
        expect(targets).toContain("dec-004");
      });

      test("returns all types when type filter is omitted", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related");
        await idx.insertConnection("dec-001", "dec-003", "builds_on");

        const all = await idx.getConnections("dec-001", "outgoing");
        expect(all.length).toBe(2);
      });

      test("returns all types when type filter is empty array", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related");
        await idx.insertConnection("dec-001", "dec-003", "supersedes");

        const all = await idx.getConnections("dec-001", "outgoing", []);
        // Empty array means no filter (returns all)
        expect(all.length).toBe(2);
      });

      test("returns empty array when no connections match", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));

        const conns = await idx.getConnections("dec-001", "outgoing");
        expect(conns).toEqual([]);
      });

      test("type filter applies to both directions", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related"); // outgoing
        await idx.insertConnection("dec-003", "dec-001", "builds_on"); // incoming

        const filtered = await idx.getConnections("dec-001", "both", ["related"]);
        expect(filtered.length).toBe(1);
        expect(filtered[0]!.type).toBe("related");
        expect(filtered[0]!.source_id).toBe("dec-001");
        expect(filtered[0]!.target_id).toBe("dec-002");
      });
    });

    describe("getConnectionCount", () => {
      test("returns 0 for entry with no connections", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));

        const count = await idx.getConnectionCount("dec-001");
        expect(count).toBe(0);
      });

      test("counts outgoing connections", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related");
        await idx.insertConnection("dec-001", "dec-003", "builds_on");

        const count = await idx.getConnectionCount("dec-001");
        expect(count).toBe(2);
      });

      test("counts incoming connections", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

        await idx.insertConnection("dec-002", "dec-001", "related");
        await idx.insertConnection("dec-003", "dec-001", "builds_on");

        const count = await idx.getConnectionCount("dec-001");
        expect(count).toBe(2);
      });

      test("counts both directions together", async () => {
        await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
        await idx.indexKnowledge(makeKnowledgeEntry("dec-003", "decision"));

        await idx.insertConnection("dec-001", "dec-002", "related"); // outgoing
        await idx.insertConnection("dec-003", "dec-001", "builds_on"); // incoming

        const count = await idx.getConnectionCount("dec-001");
        expect(count).toBe(2);
      });

      test("returns 0 for non-existent entry", async () => {
        const count = await idx.getConnectionCount("non-existent");
        expect(count).toBe(0);
      });
    });
  });

  // -- Cross-cutting concerns -------------------------------------------------

  describe("Cross-cutting", () => {
    test("multiple knowledge types coexist independently", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("inc-001", "incident"));
      await idx.indexKnowledge(makeKnowledgeEntry("pat-001", "pattern"));

      await idx.insertTags("dec-001", ["architecture"]);
      await idx.insertTags("inc-001", ["production"]);
      await idx.insertTags("pat-001", ["architecture"]);

      // Forward + inverse rows (mimics memoryConnect behavior)
      await idx.insertConnection("dec-001", "inc-001", "related");
      await idx.insertConnection("inc-001", "dec-001", "related");
      await idx.insertConnection("pat-001", "dec-001", "builds_on");
      await idx.insertConnection("dec-001", "pat-001", "extended_by");

      // Each entry should be independently retrievable
      const dec = await idx.getKnowledgeById("dec-001");
      expect(dec).not.toBeNull();
      expect(dec!.type).toBe("decision");
      expect(dec!.tags).toEqual(["architecture"]);
      expect(dec!.connections.length).toBe(2);

      const inc = await idx.getKnowledgeById("inc-001");
      expect(inc).not.toBeNull();
      expect(inc!.type).toBe("incident");
      expect(inc!.tags).toEqual(["production"]);
      expect(inc!.connections.length).toBe(1);

      const pat = await idx.getKnowledgeById("pat-001");
      expect(pat).not.toBeNull();
      expect(pat!.type).toBe("pattern");
      expect(pat!.tags).toEqual(["architecture"]);
      expect(pat!.connections.length).toBe(1);
    });

    test("removing one entry does not affect unrelated entries", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));
      await idx.insertTags("dec-001", ["tag-a"]);
      await idx.insertTags("dec-002", ["tag-b"]);

      await idx.removeKnowledge("dec-001");

      const dec002 = await idx.getKnowledgeById("dec-002");
      expect(dec002).not.toBeNull();
      expect(dec002!.tags).toEqual(["tag-b"]);
    });

    test("re-indexing knowledge preserves tags added separately", async () => {
      await idx.indexKnowledge(
        makeKnowledgeEntry("dec-001", "decision", { title: "V1" }),
      );
      await idx.insertTags("dec-001", ["stable-tag"]);

      // Re-index with updated title
      await idx.indexKnowledge(
        makeKnowledgeEntry("dec-001", "decision", { title: "V2" }),
      );

      // Tags should still be there (indexKnowledge uses INSERT OR REPLACE on knowledge table only)
      const tags = await idx.getTagsByEntryId("dec-001");
      expect(tags).toEqual(["stable-tag"]);

      const entry = await idx.getKnowledgeById("dec-001");
      expect(entry!.title).toBe("V2");
    });

    test("connection rows have expected shape", async () => {
      await idx.indexKnowledge(makeKnowledgeEntry("dec-001", "decision"));
      await idx.indexKnowledge(makeKnowledgeEntry("dec-002", "decision"));

      await idx.insertConnection("dec-001", "dec-002", "part_of", "Component");

      const conns = await idx.getConnections("dec-001", "outgoing");
      expect(conns.length).toBe(1);

      const conn: ConnectionRow = conns[0]!;
      expect(typeof conn.source_id).toBe("string");
      expect(typeof conn.target_id).toBe("string");
      expect(typeof conn.type).toBe("string");
      expect(typeof conn.created_at).toBe("string");
      // note can be string or null
      expect(conn.note === null || typeof conn.note === "string").toBe(true);
      expect(conn.note).toBe("Component");
    });
  });
});
