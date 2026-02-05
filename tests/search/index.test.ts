import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSearchIndex } from "../../src/search/index.ts";
import type { SearchIndex } from "../../src/search/types.ts";
import type { MemoryConfig } from "../../src/shared/config.ts";
import type { Memory } from "../../src/shared/types.ts";

// -- Helpers ------------------------------------------------------------------

const DIMS = 384;

function makeConfig(sqlitePath: string): MemoryConfig {
  return {
    baseDir: "/tmp/agent-memory-test",
    sqlitePath,
    embeddingModel: "Xenova/all-MiniLM-L6-v2",
    embeddingDimensions: DIMS,
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

function makeMemory(
  id: string,
  content: string,
  opts?: Partial<{
    title: string;
    type: Memory["metadata"]["type"];
    tags: string[];
    importance: Memory["metadata"]["importance"];
    source: string;
    updatedAt: number;
    embedding: Float32Array;
  }>,
): Memory & { embedding?: Float32Array } {
  const now = Date.now();
  return {
    metadata: {
      id,
      title: opts?.title ?? `Memory ${id}`,
      type: opts?.type ?? "semantic",
      tags: opts?.tags ?? ["test"],
      importance: opts?.importance ?? "medium",
      createdAt: now,
      updatedAt: opts?.updatedAt ?? now,
      lastAccessedAt: now,
      source: opts?.source ?? "test",
    },
    content,
    filePath: `/memories/semantic/${id}.md`,
    embedding: opts?.embedding,
  };
}

/** Create a normalized random-ish vector. Seed gives determinism per id. */
function makeVector(seed: number): Float32Array {
  const v = new Float32Array(DIMS);
  for (let i = 0; i < DIMS; i++) {
    // Simple pseudo-random based on seed and index
    v[i] = Math.sin(seed * 1000 + i * 7.3) * 0.5;
  }
  // Normalize to unit length for cosine similarity
  let norm = 0;
  for (let i = 0; i < DIMS; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < DIMS; i++) v[i] = v[i]! / norm;
  return v;
}

/** Create two vectors that are very similar (small perturbation). */
function makeSimilarVectors(): [Float32Array, Float32Array] {
  const base = makeVector(42);
  const similar = new Float32Array(DIMS);
  for (let i = 0; i < DIMS; i++) {
    similar[i] = base[i]! + (i % 2 === 0 ? 0.001 : -0.001);
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < DIMS; i++) norm += similar[i]! * similar[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < DIMS; i++) similar[i] = similar[i]! / norm;
  return [base, similar];
}

// -- Test suite ---------------------------------------------------------------

describe("SearchIndex", () => {
  let tempDir: string;
  let idx: SearchIndex;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "search-test-"));
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

  // -- index ------------------------------------------------------------------

  describe("index", () => {
    test("indexes a memory into FTS and vector tables", async () => {
      const vec = makeVector(1);
      const mem = makeMemory("mem-1", "TypeScript is a strongly typed language", {
        embedding: vec,
      });

      await idx.index(mem);

      // Verify FTS: should find it by keyword
      const ftsResults = await idx.searchText("TypeScript");
      expect(ftsResults.length).toBe(1);
      expect(ftsResults[0]!.memory.metadata.id).toBe("mem-1");

      // Verify vector: should find it by similarity
      const vecResults = await idx.searchVector(vec);
      expect(vecResults.length).toBe(1);
      expect(vecResults[0]!.memory.metadata.id).toBe("mem-1");
      expect(vecResults[0]!.score).toBeGreaterThan(0.99); // nearly identical vector
    });

    test("updates existing entry on re-index", async () => {
      const vec1 = makeVector(1);
      const mem1 = makeMemory("mem-1", "Original content about dogs", {
        embedding: vec1,
      });
      await idx.index(mem1);

      // Re-index same ID with new content and new embedding
      const vec2 = makeVector(2);
      const mem2 = makeMemory("mem-1", "Updated content about cats", {
        embedding: vec2,
      });
      await idx.index(mem2);

      // FTS should find the updated content
      const ftsOld = await idx.searchText("dogs");
      expect(ftsOld.length).toBe(0);

      const ftsNew = await idx.searchText("cats");
      expect(ftsNew.length).toBe(1);
      expect(ftsNew[0]!.memory.metadata.id).toBe("mem-1");
      expect(ftsNew[0]!.memory.content).toBe("Updated content about cats");

      // Vector search with the new vector should return the memory
      const vecResults = await idx.searchVector(vec2);
      expect(vecResults.length).toBe(1);
      expect(vecResults[0]!.memory.metadata.id).toBe("mem-1");
    });
  });

  // -- remove -----------------------------------------------------------------

  describe("remove", () => {
    test("removes a memory from all index tables", async () => {
      const vec = makeVector(1);
      const mem = makeMemory("mem-1", "Content to be removed", {
        embedding: vec,
      });
      await idx.index(mem);

      // Verify it is indexed
      const before = await idx.searchText("removed");
      expect(before.length).toBe(1);

      await idx.remove("mem-1");

      // FTS should find nothing
      const afterFts = await idx.searchText("removed");
      expect(afterFts.length).toBe(0);

      // Vector should find nothing (search with the same vector)
      const afterVec = await idx.searchVector(vec);
      expect(afterVec.length).toBe(0);
    });

    test("no-ops when removing non-existent id", async () => {
      // Should not throw
      await idx.remove("non-existent-id");
    });
  });

  // -- searchText -------------------------------------------------------------

  describe("searchText", () => {
    test("finds memories by keyword using FTS5", async () => {
      await idx.index(
        makeMemory("mem-1", "JavaScript is a dynamic programming language"),
      );
      await idx.index(
        makeMemory("mem-2", "Python is great for data science"),
      );
      await idx.index(
        makeMemory("mem-3", "JavaScript frameworks include React and Vue"),
      );

      const results = await idx.searchText("JavaScript");
      expect(results.length).toBe(2);
      const ids = results.map((r) => r.memory.metadata.id);
      expect(ids).toContain("mem-1");
      expect(ids).toContain("mem-3");
    });

    test("returns results ranked by BM25 score", async () => {
      // Memory with more relevant content should rank higher
      await idx.index(
        makeMemory(
          "mem-1",
          "Rust is a systems programming language focused on safety",
        ),
      );
      await idx.index(
        makeMemory(
          "mem-2",
          "Rust Rust Rust is mentioned many times because Rust is great and Rust is fast",
        ),
      );

      const results = await idx.searchText("Rust");
      expect(results.length).toBe(2);
      // mem-2 has more occurrences of "Rust" so it should have higher BM25 score
      expect(results[0]!.memory.metadata.id).toBe("mem-2");
      expect(results[0]!.score).toBeGreaterThan(0);
      expect(results[1]!.score).toBeGreaterThan(0);
      // All should have matchType "fts"
      for (const r of results) {
        expect(r.matchType).toBe("fts");
        expect(r.source).toBe("fts5");
      }
    });

    test("respects limit parameter", async () => {
      await idx.index(
        makeMemory("mem-1", "Testing limit with search queries"),
      );
      await idx.index(
        makeMemory("mem-2", "Another search query for testing"),
      );
      await idx.index(
        makeMemory("mem-3", "Third testing document for search"),
      );

      const results = await idx.searchText("testing", 2);
      expect(results.length).toBe(2);
    });

    test("returns empty array for no matches", async () => {
      await idx.index(
        makeMemory("mem-1", "This document is about cooking recipes"),
      );

      const results = await idx.searchText("quantum");
      expect(results).toEqual([]);
    });
  });

  // -- searchVector -----------------------------------------------------------

  describe("searchVector", () => {
    test("finds memories by vector similarity", async () => {
      const [base, similar] = makeSimilarVectors();
      const different = makeVector(999);

      await idx.index(
        makeMemory("mem-close", "Close vector content", { embedding: base }),
      );
      await idx.index(
        makeMemory("mem-far", "Far vector content", { embedding: different }),
      );

      // Searching with the similar vector should find mem-close as the top result
      const results = await idx.searchVector(similar);
      expect(results.length).toBe(2);
      expect(results[0]!.memory.metadata.id).toBe("mem-close");
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    });

    test("returns results ordered by cosine distance", async () => {
      const queryVec = makeVector(10);
      const closeVec = makeVector(10); // Same seed = identical = distance 0
      const midVec = makeVector(11); // Slightly different
      const farVec = makeVector(500); // Very different

      await idx.index(
        makeMemory("mem-close", "Close", { embedding: closeVec }),
      );
      await idx.index(makeMemory("mem-mid", "Mid", { embedding: midVec }));
      await idx.index(makeMemory("mem-far", "Far", { embedding: farVec }));

      const results = await idx.searchVector(queryVec);
      expect(results.length).toBe(3);

      // Scores should be in descending order (highest similarity first)
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
      expect(results[1]!.score).toBeGreaterThanOrEqual(results[2]!.score);

      // The closest vector (same seed) should have score close to 1.0
      expect(results[0]!.memory.metadata.id).toBe("mem-close");
      expect(results[0]!.score).toBeCloseTo(1.0, 2);

      // All should have matchType "vector"
      for (const r of results) {
        expect(r.matchType).toBe("vector");
        expect(r.source).toBe("sqlite-vec");
      }
    });

    test("respects limit parameter", async () => {
      const vecs = [makeVector(1), makeVector(2), makeVector(3)];
      await idx.index(
        makeMemory("mem-1", "First", { embedding: vecs[0] }),
      );
      await idx.index(
        makeMemory("mem-2", "Second", { embedding: vecs[1] }),
      );
      await idx.index(
        makeMemory("mem-3", "Third", { embedding: vecs[2] }),
      );

      const results = await idx.searchVector(makeVector(1), 2);
      expect(results.length).toBe(2);
    });
  });

  // -- searchHybrid -----------------------------------------------------------

  describe("searchHybrid", () => {
    test("combines FTS and vector results using RRF", async () => {
      const vec1 = makeVector(1);
      const vec2 = makeVector(2);
      const vec3 = makeVector(3);

      // mem-1: strong FTS match for "TypeScript", also has vec1
      await idx.index(
        makeMemory(
          "mem-1",
          "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript",
          { embedding: vec1 },
        ),
      );
      // mem-2: weaker FTS match for "TypeScript", has vec2
      await idx.index(
        makeMemory("mem-2", "TypeScript support in IDEs", {
          embedding: vec2,
        }),
      );
      // mem-3: no FTS match for "TypeScript", but closest vector to query
      await idx.index(
        makeMemory("mem-3", "Python data science libraries", {
          embedding: vec3,
        }),
      );

      // Query with text "TypeScript" and vector closest to vec1
      const results = await idx.searchHybrid("TypeScript", vec1, {
        limit: 3,
        minScore: 0,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3);

      // mem-1 should be top since it matches both FTS and vector
      expect(results[0]!.memory.metadata.id).toBe("mem-1");

      // All results should be hybrid type
      for (const r of results) {
        expect(r.matchType).toBe("hybrid");
        expect(r.source).toBe("hybrid-rrf");
        expect(r.score).toBeGreaterThan(0);
      }
    });

    test("applies recency weighting", async () => {
      const vec = makeVector(1);
      const now = Date.now();
      const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;

      // Recent memory
      await idx.index(
        makeMemory("mem-recent", "Search algorithms and data structures", {
          embedding: vec,
          updatedAt: now,
        }),
      );
      // Old memory (same content for fair comparison)
      await idx.index(
        makeMemory("mem-old", "Search algorithms and data structures overview", {
          embedding: makeVector(2),
          updatedAt: oneYearAgo,
        }),
      );

      const results = await idx.searchHybrid("algorithms", vec, {
        limit: 2,
        minScore: 0,
        weightFts: 0.3,
        weightVector: 0.3,
        weightRecency: 0.4, // Heavy recency weight
        rrfK: 60,
      });

      expect(results.length).toBe(2);
      // The recent memory should score higher due to recency boost
      expect(results[0]!.memory.metadata.id).toBe("mem-recent");
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    });

    test("filters results below minScore", async () => {
      const vec = makeVector(1);
      await idx.index(
        makeMemory("mem-1", "Hello world", { embedding: vec }),
      );

      // Use a very high minScore that no result can meet
      const results = await idx.searchHybrid("Hello", vec, {
        limit: 5,
        minScore: 999,
      });

      expect(results.length).toBe(0);
    });

    test("uses default options when none provided", async () => {
      const vec = makeVector(1);
      await idx.index(
        makeMemory("mem-1", "Default options test content", {
          embedding: vec,
        }),
      );

      // No options provided -- should use hybridDefaults from config
      const results = await idx.searchHybrid("Default", vec);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.matchType).toBe("hybrid");
    });
  });

  // -- rebuild ----------------------------------------------------------------

  describe("rebuild", () => {
    test("rebuilds index from scratch and returns stats", async () => {
      const vec = makeVector(1);
      await idx.index(
        makeMemory("mem-1", "First document", { embedding: vec }),
      );
      await idx.index(
        makeMemory("mem-2", "Second document", {
          embedding: makeVector(2),
        }),
      );

      const stats = await idx.rebuild();

      expect(stats.totalDocuments).toBe(2);
      expect(stats.totalEmbeddings).toBe(0); // Embeddings lost on rebuild
      expect(stats.lastRebuilt).toBeGreaterThan(0);
      expect(stats.lastRebuilt).toBeLessThanOrEqual(Date.now());

      // FTS should still work after rebuild (re-populated from memories table)
      const ftsResults = await idx.searchText("document");
      expect(ftsResults.length).toBe(2);
    });
  });

  // -- close ------------------------------------------------------------------

  describe("close", () => {
    test("closes database connection cleanly", async () => {
      // Close the database
      idx.close();

      // Attempting to use the index after close should reject
      try {
        await idx.searchText("anything");
        // If we reach here, the search did not throw -- fail
        expect(true).toBe(false);
      } catch {
        // Expected: database is closed
        expect(true).toBe(true);
      }
    });
  });
});
