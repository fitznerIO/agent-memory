/**
 * Regression tests for the RRF fallback rank in `searchHybrid`.
 *
 * Bug: the fallback rank for "this document is missing from that result set"
 * was derived from the length of the result set (`results.length + 1`). The
 * vector search always returns a full pool, FTS only real matches -- so for a
 * rare word FTS returned a single row and "missing from FTS" scored as rank 2,
 * almost as good as an actual FTS rank 1. Every vector neighbour then outranked
 * the one exact match. In a real 433-entry store the only entry containing
 * "netcup" came back at position 93.
 *
 * Fix: both channels share one length-independent fallback, `poolSize + 1`.
 *
 * These tests use the PRODUCTION weights from `createDefaultConfig()`, not the
 * lighter ones the other search tests use -- the bug lives in the interplay of
 * weightFts, weightVector and the fallback, so testing other weights would test
 * a different system.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSearchIndex } from "../../src/search/index.ts";
import { createDefaultConfig } from "../../src/shared/config.ts";
import type { SearchIndex } from "../../src/search/types.ts";
import type { MemoryConfig } from "../../src/shared/config.ts";
import type { Memory } from "../../src/shared/types.ts";

const DIMS = 384;

/**
 * The real production hybrid weights, read from `createDefaultConfig()` rather
 * than copied -- if someone changes the shipped defaults, these tests move with
 * them instead of silently guarding a weighting nobody runs. Only `minScore` is
 * overridden, to 0, so nothing is filtered out before we can look at the order.
 *
 * The expected positions below are arithmetic consequences of these weights. If
 * a defaults change turns one of these tests red, that is the test doing its
 * job: re-derive the expectation, do not just bump the number.
 */
const PROD = createDefaultConfig().hybridDefaults;

function makeProdConfig(sqlitePath: string): MemoryConfig {
  return {
    baseDir: "/tmp/agent-memory-rrf-test",
    sqlitePath,
    embeddingModel: "Xenova/all-MiniLM-L6-v2",
    embeddingDimensions: DIMS,
    hybridDefaults: { ...PROD, minScore: 0.0 },
    maxCoreTokens: 4000,
  };
}

function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < DIMS; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < DIMS; i++) v[i] = v[i]! / norm;
  return v;
}

const QUERY_VEC = normalize(
  (() => {
    const v = new Float32Array(DIMS);
    for (let i = 0; i < DIMS; i++) v[i] = Math.sin(i * 0.37) + 0.1;
    return v;
  })(),
);

const NOISE = normalize(
  (() => {
    const v = new Float32Array(DIMS);
    for (let i = 0; i < DIMS; i++) v[i] = Math.cos(i * 1.13) - 0.05;
    return v;
  })(),
);

/**
 * Vector whose cosine similarity to QUERY_VEC decreases monotonically with
 * `distance`. distance 0 is the closest possible neighbour. This gives every
 * entry a deterministic, known vector rank.
 */
function vectorAtDistance(distance: number): Float32Array {
  const v = new Float32Array(DIMS);
  const t = distance * 0.12;
  for (let i = 0; i < DIMS; i++) v[i] = QUERY_VEC[i]! + t * NOISE[i]!;
  return normalize(v);
}

const FIXED_TIME = Date.UTC(2026, 0, 15);

/** All entries share type, tags and timestamps, so recency/type/tag boosts
 *  are identical for everyone and cannot flip the ordering. */
function makeMemory(
  id: string,
  content: string,
  embedding: Float32Array,
): Memory & { embedding: Float32Array } {
  return {
    metadata: {
      id,
      title: `Memory ${id}`,
      type: "semantic",
      tags: ["test"],
      importance: "medium",
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
      lastAccessedAt: FIXED_TIME,
      source: "test",
    },
    content,
    filePath: `/memories/semantic/${id}.md`,
    embedding,
  };
}

/** Filler text sharing no token with the rare-word entries. */
const FILLER = [
  "the kitchen renovation schedule and the tiling quote",
  "weekly grocery list with bread, olives and yoghurt",
  "notes about the bicycle chain and the rear derailleur",
  "minutes of the gardening club about hedge trimming",
  "instructions for brewing filter coffee with a scale",
  "observations on migratory birds near the old quarry",
  "a recipe for lentil soup with smoked paprika",
  "thoughts on the piano tuning and the sticky key",
  "travel notes from the ferry crossing to the island",
  "measurements for the bookshelf in the hallway",
  "a summary of the tenancy agreement renewal terms",
  "reflections on the marathon training block in spring",
  "an outline of the pottery glazing workshop",
  "packing list for the winter hiking weekend",
  "questions for the dentist about the crown fitting",
  "a log of the greenhouse temperature readings",
  "ideas for the birthday dinner seating plan",
  "the repair manual excerpt for the washing machine drum",
  "a list of board games for the rainy afternoon",
  "notes on the choir rehearsal and the new soprano part",
  "the inventory of camping gear stored in the attic",
  "a reminder about the annual chimney sweep visit",
];

describe("searchHybrid: RRF fallback rank", () => {
  let tempDir: string;
  let idx: SearchIndex;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "rrf-fallback-"));
    idx = createSearchIndex(makeProdConfig(join(tempDir, "search.sqlite")));
  });

  afterEach(() => {
    try {
      idx.close();
    } catch {
      // already closed
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Index `count` filler entries, skipping the vector distances in `reserved`
   * so the caller can place target entries at exact vector ranks.
   */
  async function indexFillers(count: number, reserved: number[]) {
    let distance = 0;
    for (let i = 0; i < count; i++) {
      while (reserved.includes(distance)) distance++;
      await idx.index(
        makeMemory(
          `filler-${i}`,
          FILLER[i % FILLER.length]!,
          vectorAtDistance(distance),
        ),
      );
      distance++;
    }
  }

  // Deliberately narrow name: this shows the fix for the case the bug report
  // was about -- a unique word in an entry that is also a reasonable vector
  // neighbour. It is NOT a general "unique word always wins" guarantee; the
  // last test in this file pins why that guarantee does not hold.
  test("a unique word ranks its entry first when that entry is also a near vector neighbour", async () => {
    // 23 filler entries + 1 target = 24 entries. limit 5 -> poolSize 15, so the
    // vector pool is truncated and the old length-based fallback misfired.
    await indexFillers(23, [3]);
    await idx.index(
      makeMemory(
        "target",
        "the hosting invoice from netcup arrived this morning",
        vectorAtDistance(3), // 4th-closest vector -> vector rank 4
      ),
    );

    // Sanity: the word really is unique in the corpus.
    const fts = await idx.searchText("netcup", 15);
    expect(fts.length).toBe(1);
    expect(fts[0]!.memory.metadata.id).toBe("target");

    const results = await idx.searchHybrid("netcup", QUERY_VEC, { limit: 5 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.memory.metadata.id).toBe("target");
  });

  test("a word occurring in two entries puts both in the top 2", async () => {
    await indexFillers(22, [1, 2]);
    await idx.index(
      makeMemory(
        "target-a",
        "the Empfaengerseite of the transfer was misconfigured",
        vectorAtDistance(1), // vector rank 2
      ),
    );
    await idx.index(
      makeMemory(
        "target-b",
        "a second note on the Empfaengerseite and its timeout",
        vectorAtDistance(2), // vector rank 3
      ),
    );

    const fts = await idx.searchText("Empfaengerseite", 15);
    expect(fts.length).toBe(2);

    const results = await idx.searchHybrid("Empfaengerseite", QUERY_VEC, {
      limit: 5,
    });

    const topTwo = results.slice(0, 2).map((r) => r.memory.metadata.id).sort();
    expect(topTwo).toEqual(["target-a", "target-b"]);
  });

  test("both channels use the same fallback rank, so a lone hit in either channel scores the same", async () => {
    // Symmetry check that does not depend on the weights: with weightFts ==
    // weightVector, an entry found only by FTS and an entry found only by the
    // vector search at the same rank must end up with the same score.
    await indexFillers(22, [0]);
    await idx.index(
      makeMemory(
        "fts-only",
        "the hosting invoice from netcup arrived this morning",
        vectorAtDistance(40), // far outside the pool of 15
      ),
    );
    // The closest vector neighbour (distance 0) is a filler with no "netcup".
    const results = await idx.searchHybrid("netcup", QUERY_VEC, {
      limit: 5,
      weightFts: 0.5,
      weightVector: 0.5,
      weightRecency: 0,
      minScore: 0,
    });

    const ftsOnly = results.find((r) => r.memory.metadata.id === "fts-only");
    const vecOnly = results.find((r) => r.memory.metadata.id !== "fts-only");
    expect(ftsOnly).toBeDefined();
    expect(vecOnly).toBeDefined();
    // Both are "rank 1 in one channel, missing from the other".
    expect(ftsOnly!.score).toBeCloseTo(vecOnly!.score, 6);
  });

  /**
   * SILENT FAILURE, pinned deliberately.
   *
   * The fix makes the fallback symmetric. It does NOT make an exact lexical
   * match win outright, because weightVector (0.55) > weightFts (0.4):
   *
   *   V(rank 1) - F  =  (wV - wF) * (1/(k+1) - 1/(k+M))  >  0
   *
   * With limit 5 (poolSize 15, k = 3, fallback M = 16) an exact hit that is
   * missing from the vector pool scores 0.4/4 + 0.55/19 = 0.12895, while the
   * two closest vector neighbours score 0.15855 and 0.13855. So it lands at
   * position 3 -- inside the result window, but not first.
   *
   * Before the fix it scored 0.4/4 + 0.55/19 too, but the neighbours got
   * 0.08 + 0.55/(3+r), which put eight of them ahead: position 9, outside a
   * limit of 5. The entry was simply gone.
   *
   * If this test ever reports position 1, someone changed the weights and this
   * comment is stale -- that would be an improvement, not a regression.
   */
  test("an exact hit outside the vector pool reaches position 3, not position 1", async () => {
    await indexFillers(23, []);
    await idx.index(
      makeMemory(
        "target",
        "the hosting invoice from netcup arrived this morning",
        vectorAtDistance(40), // far outside the pool of 15
      ),
    );

    const results = await idx.searchHybrid("netcup", QUERY_VEC, { limit: 5 });

    const position = results.findIndex((r) => r.memory.metadata.id === "target");
    expect(position).toBe(2); // 0-indexed -> position 3
  });
});
