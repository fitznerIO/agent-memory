/**
 * Regression tests for the RRF fallback rank in `searchHybrid`.
 *
 * Bug: the fallback rank for "this document is missing from that result set"
 * was derived from the length of the result set (`results.length + 1`). The
 * vector search fills the pool whenever enough vectors are indexed, FTS returns
 * only matching entries -- so for a rare word FTS returned a single row and
 * "missing from FTS" scored as rank 2, almost as good as an actual FTS rank 1.
 * Most vector neighbours then outranked the one exact match; in a real store it
 * came back far down the list (see #7 for the measurement).
 *
 * Fix: both channels share one length-independent fallback, `poolSize + 1`.
 *
 * These tests use the PRODUCTION weights from `createDefaultConfig()`, not the
 * lighter ones the other search tests use -- the bug lives in the interplay of
 * weightFts, weightVector and the fallback, so testing other weights would test
 * a different system. The one exception is the symmetry test, which uses equal
 * weights on purpose (its comment says why).
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
  embedding?: Float32Array,
): Memory & { embedding?: Float32Array } {
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
  // "position 3, not position 1" test below pins why that guarantee does not hold.
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

    const topTwo = results
      .slice(0, 2)
      .map((r) => r.memory.metadata.id)
      .sort();
    expect(topTwo).toEqual(["target-a", "target-b"]);
  });

  /**
   * Symmetry check that does not depend on the weights: with weightFts ==
   * weightVector, an entry found only by full-text and an entry found only by
   * the vector search, each at rank 1 of its own channel, must score the same.
   *
   * The corpus matters more than it looks. An earlier version of this test used
   * 23 embedded entries, which fills the vector pool -- and when the pool is
   * full, `vecResults.length + 1` and `poolSize + 1` are the SAME NUMBER, so the
   * test passed even with the vector side reverted to the old length-based
   * fallback. It asserted a property it could not observe.
   *
   * So: six embedded fillers and one entry with no embedding at all. The vector
   * pool is 15 deep and only six entries can fill it. A partly-embedded store is
   * a real state: `rebuildIndex()` indexes an entry without a vector when
   * embedding it fails (src/index.ts, "Best-effort: skip files that fail to
   * embed"). Now the two fallbacks are different numbers and the assertion can
   * see them.
   *
   * With k = 3 and missingRank = 16:
   *   fts-only  (full-text rank 1, no vector row) = 0.5/4  + 0.5/19 = 0.151316
   *   filler-0  (vector rank 1, no word match)    = 0.5/19 + 0.5/4  = 0.151316
   *   filler-1  (vector rank 2)                   = 0.5/19 + 0.5/5  = 0.126316
   * The first two tie and normalise to 1.0 together; filler-1 is lower, so the
   * tie is a real observation and not an artefact of both being the maximum.
   *
   * Revert the vector side alone and fts-only becomes 0.5/4 + 0.5/10 = 0.175,
   * which breaks the tie. That mutation is what this test exists to catch.
   *
   * Equal weights cannot see a fallback that is symmetric but still depends on
   * the list lengths, e.g. `max(ftsResults.length, vecResults.length) + 1` = 7
   * here: both sides move together and the tie survives. So the same corpus is
   * searched once more at the production weights, where the fallback's size
   * decides fts-only's position:
   *   fallback 16 (fix):   fts-only 0.4/4 + 0.55/19 = 0.1289, behind
   *                        filler-0 0.4/19 + 0.55/4 = 0.1586 and
   *                        filler-1 0.4/19 + 0.55/5 = 0.1311  -> position 3
   *   fallback 7 (max+1):  fts-only 0.4/4 + 0.55/10 = 0.1550, ahead of
   *                        filler-1 0.4/10 + 0.55/5 = 0.1500  -> position 2
   */
  test("both channels use the same fallback rank, even when the vector pool is not full", async () => {
    for (let i = 0; i < 6; i++) {
      await idx.index(
        makeMemory(`filler-${i}`, FILLER[i]!, vectorAtDistance(i)),
      );
    }
    // No embedding: this entry cannot appear in the vector results at all.
    await idx.index(
      makeMemory(
        "fts-only",
        "the hosting invoice from netcup arrived this morning",
      ),
    );

    // Guard the premise. If a later change grows this corpus past the pool, the
    // two fallback formulas collapse into the same number and this test goes
    // back to proving nothing -- fail loudly instead.
    const vecResults = await idx.searchVector(QUERY_VEC, 15);
    expect(vecResults.length).toBe(6);
    expect(vecResults.length).toBeLessThan(15); // poolSize at limit 5

    const results = await idx.searchHybrid("netcup", QUERY_VEC, {
      limit: 5,
      weightFts: 0.5,
      weightVector: 0.5,
      weightRecency: 0,
      minScore: 0,
    });

    const ftsOnly = results.find((r) => r.memory.metadata.id === "fts-only");
    const vecOnly = results.find((r) => r.memory.metadata.id === "filler-0");
    expect(ftsOnly).toBeDefined();
    expect(vecOnly).toBeDefined();
    // Both are "rank 1 in one channel, missing from the other".
    expect(ftsOnly!.score).toBeCloseTo(vecOnly!.score, 6);
    // And they really are the top two, i.e. something below them anchors the
    // normalisation -- otherwise the equality above would be trivially true.
    expect(results[2]!.score).toBeLessThan(results[0]!.score);

    // Same corpus at the production weights: the fallback's size shows.
    const prod = await idx.searchHybrid("netcup", QUERY_VEC, { limit: 5 });
    expect(prod.findIndex((r) => r.memory.metadata.id === "fts-only")).toBe(2);
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
   * two closest vector neighbours score 0.15855 and 0.13105. So it lands at
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

    const position = results.findIndex(
      (r) => r.memory.metadata.id === "target",
    );
    expect(position).toBe(2); // 0-indexed -> position 3
  });

  /**
   * The fallback is `poolSize + 1`, and `poolSize` is `limit * 3` -- so how much
   * this fix helps depends on the limit and on where the entry sits in the vector
   * ranking. This test pins one setup: the entry with the word at vector rank 4.
   * At limit 1 the pool is 3 deep, k = 1 and the fallback is 4:
   *
   *   target (FTS rank 1, outside a 3-deep pool) = 0.4/2 + 0.55/5  = 0.31000
   *   filler at vector rank 1, no word match     = 0.4/5 + 0.55/2  = 0.35500
   *
   * so it is not returned. That is not a general "limit 1 does not help": an
   * entry at vector rank 2 is not returned by the old code at limit 1 and comes
   * first with the fix. (`forget --scope entry` used to search at limit 1, which
   * is one reason it could delete the wrong entry -- #8.)
   *
   * A second thing this pins: every other test in this file runs at limit 5, so a
   * fallback accidentally hard-coded to a constant would pass them all. Here the
   * expected positions differ per limit, which rules out most constants -- 16, the
   * value that is correct at limit 5, fails here. It does not rule out every
   * constant on its own (9 also satisfies these positions); the position-3 test
   * above catches that one. The two together close the gap.
   */
  test("how much the fix helps depends on the limit: an entry at vector rank 4 is not rescued at limit 1", async () => {
    await indexFillers(23, [3]);
    await idx.index(
      makeMemory(
        "target",
        "the hosting invoice from netcup arrived this morning",
        vectorAtDistance(3), // vector rank 4
      ),
    );

    const positionAt = async (limit: number) => {
      const res = await idx.searchHybrid("netcup", QUERY_VEC, { limit });
      return res.findIndex((r) => r.memory.metadata.id === "target");
    };

    // limit 1 -> poolSize 3, k 1, fallback 4. Target is outside a 3-deep pool
    // and loses to the nearest vector neighbour: not returned at all.
    expect(await positionAt(1)).toBe(-1);

    // limit 2 -> poolSize 6, k 1, fallback 7. Target is inside the pool now but
    // still behind the nearest neighbour.
    expect(await positionAt(2)).toBe(1);

    // limit 3 -> poolSize 9, k 2, fallback 10. From here the exact hit wins.
    expect(await positionAt(3)).toBe(0);
    expect(await positionAt(5)).toBe(0);
    expect(await positionAt(10)).toBe(0);
  });

  /**
   * SILENT FAILURE, pinned deliberately (#9, item 2): minScore drops real
   * matches after min-max normalisation. If this is fixed, this test SHOULD go
   * red -- flip the expectations, do not delete the test.
   *
   * searchHybrid normalises scores min-max across the whole candidate pool. Once
   * there are at least two candidates with different scores, the worst one ends
   * up at exactly 0.0 -- whatever its actual relevance was. Any minScore above 0
   * then deletes it. (With a single candidate, or with every score equal, the
   * implementation assigns 1.0 instead, so the hole needs a real spread.)
   *
   * That is invisible from outside: the caller asked for up to 10 results, got 5,
   * and nothing says one was dropped. Here every single entry in the corpus
   * contains the search word, so a caller would reasonably expect all of them
   * back. One is missing.
   *
   * Note the production default is worse than it looks: the config ships
   * minScore 0.1, but `search()` in src/index.ts passes `input.minScore ?? 0.3`
   * -- so the real cut is at 0.3, not 0.1.
   */
  test("minScore drops a real word match, because min-max normalisation puts the worst candidate at exactly 0", async () => {
    // Six entries, every one of them containing "alpha".
    for (let i = 0; i < 6; i++) {
      await idx.index(
        makeMemory(
          `hit-${i}`,
          `alpha appears here, ${FILLER[i]}`,
          vectorAtDistance(i),
        ),
      );
    }

    const fts = await idx.searchText("alpha", 30);
    expect(fts.length).toBe(6); // all six really do match

    // Limit 10 > 6 entries, so nothing is cut by the limit.
    const unfiltered = await idx.searchHybrid("alpha", QUERY_VEC, {
      limit: 10,
      minScore: 0,
    });
    expect(unfiltered.length).toBe(6);
    // The worst candidate sits at exactly 0 after normalisation.
    expect(unfiltered[5]!.score).toBe(0);

    const atPointOne = await idx.searchHybrid("alpha", QUERY_VEC, {
      limit: 10,
      minScore: 0.1,
    });
    expect(atPointOne.length).toBe(5); // one real match silently gone

    const lost = unfiltered[5]!.memory.metadata.id;
    expect(atPointOne.map((r) => r.memory.metadata.id)).not.toContain(lost);

    // At the value the CLI actually passes, two of the six are gone.
    const atProductionDefault = await idx.searchHybrid("alpha", QUERY_VEC, {
      limit: 10,
      minScore: 0.3,
    });
    expect(atProductionDefault.length).toBe(4);
  });
});
