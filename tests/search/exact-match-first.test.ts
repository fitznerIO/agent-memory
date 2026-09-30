/**
 * Exact matches first in `searchHybrid`.
 *
 * Bug: with the vector weight above the full-text weight, an entry that never mentions a rare
 * name could come back first — normalised score 1.0 — while the entries that do mention it sat
 * on positions 3, 5 and 8 in a real store (the first test rebuilds the case with a synthetic
 * name; there they land on 4, 6 and 8). Fix: an entry whose
 * title or text contains every query word literally comes before every entry that does not; within
 * both groups the hybrid order stays.
 *
 * Like rrf-fallback-rank.test.ts, these tests use the PRODUCTION weights and give every entry a
 * synthetic vector at a known distance from the query, so the vector ranks are fixed and no
 * embedding model is loaded. All words are made up or generic; the tests must not depend on what
 * a real store contains.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSearchIndex } from "../../src/search/index.ts";
import type { SearchIndex } from "../../src/search/types.ts";
import type { MemoryConfig } from "../../src/shared/config.ts";
import { createDefaultConfig } from "../../src/shared/config.ts";
import type { Memory, SearchResult } from "../../src/shared/types.ts";

const DIMS = 384;
const PROD = createDefaultConfig().hybridDefaults;

function makeProdConfig(sqlitePath: string): MemoryConfig {
  return {
    baseDir: "/tmp/agent-memory-exact-test",
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

/** Vector whose similarity to QUERY_VEC falls as `distance` grows; 0 is the closest neighbour. */
function vectorAtDistance(distance: number): Float32Array {
  const v = new Float32Array(DIMS);
  const t = distance * 0.12;
  for (let i = 0; i < DIMS; i++) v[i] = QUERY_VEC[i]! + t * NOISE[i]!;
  return normalize(v);
}

const FIXED_TIME = Date.UTC(2026, 0, 15);

/** Same type, tags and timestamps for everyone, so no boost can flip the order. */
function makeMemory(
  id: string,
  content: string,
  distance: number,
  title = `Memory ${id}`,
): Memory & { embedding: Float32Array } {
  return {
    metadata: {
      id,
      title,
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
    embedding: vectorAtDistance(distance),
  };
}

/** Filler text sharing no word with any query below. */
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

const ids = (results: SearchResult[]) =>
  results.map((r) => r.memory.metadata.id);

/** Scores never rise within a run of results — the hybrid order. */
function expectFallingScores(results: SearchResult[]) {
  for (let i = 1; i < results.length; i++) {
    expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
  }
}

describe("searchHybrid: exact matches first", () => {
  let tempDir: string;
  let idx: SearchIndex;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "exact-first-"));
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
   * `count` fillers at vector distances 0, 1, 2, … — `filler-0` is the query's closest neighbour.
   * With limit 10 the vector pool holds 30, so anything at distance 40 or more is outside it and
   * reaches the candidates only through full-text search.
   */
  async function indexFillers(count: number) {
    for (let i = 0; i < count; i++) {
      await idx.index(makeMemory(`filler-${i}`, FILLER[i % FILLER.length]!, i));
    }
  }

  // The reported case: three entries name something rare, a closer vector neighbour does not.
  // By score alone they land on positions 4, 6 and 8 behind `filler-0`, which scores 1.0.
  test("entries that contain a rare name come first, ahead of a closer neighbour scoring 1.0", async () => {
    await indexFillers(35);
    await idx.index(
      makeMemory("name-a", "Call with Quillfeather about the offer", 40),
    );
    await idx.index(
      makeMemory("name-b", "Quillfeather sent the signed contract", 41),
    );
    await idx.index(
      makeMemory("name-c", "Reminder: invoice for Quillfeather", 42),
    );

    const results = await idx.searchHybrid("Quillfeather", QUERY_VEC, {
      limit: 10,
    });

    expect(ids(results).slice(0, 3).sort()).toEqual([
      "name-a",
      "name-b",
      "name-c",
    ]);
    expect(results.slice(0, 3).every((r) => r.exactMatch === true)).toBe(true);
    expect(results.slice(3).every((r) => r.exactMatch === false)).toBe(true);

    // The scenario really is the bug: the best score belongs to an entry without the name. It
    // keeps its score and now comes right after the exact matches.
    expect(results[3]!.memory.metadata.id).toBe("filler-0");
    expect(results[3]!.score).toBe(1);
    expect(results[0]!.score).toBeLessThan(1);

    // Within both groups the hybrid order is unchanged.
    expectFallingScores(results.slice(0, 3));
    expectFallingScores(results.slice(3));
  });

  test("case does not matter, and a name in the title alone counts", async () => {
    await indexFillers(35);
    await idx.index(
      makeMemory("in-text", "we booked QUILLFEATHER for march", 40),
    );
    await idx.index(
      makeMemory(
        "in-title",
        "the booking is confirmed for march",
        41,
        "Quillfeather booking",
      ),
    );

    const results = await idx.searchHybrid("quillfeather", QUERY_VEC, {
      limit: 10,
    });

    expect(ids(results).slice(0, 2).sort()).toEqual(["in-text", "in-title"]);
    expect(results[2]!.exactMatch).toBe(false);
  });

  test("every query word must be there, in any order and any distance apart", async () => {
    await indexFillers(35);
    // Only `both` is a full-text match (FTS combines the words with AND). The two single-word
    // entries are close vector neighbours, so they are candidates too — and must not count.
    await idx.index(
      makeMemory(
        "both",
        `Marrowby wrote first. ${FILLER[0]} ${FILLER[1]} Later Quillfeather answered.`,
        40,
      ),
    );
    await idx.index(
      makeMemory("only-first", "Quillfeather is on holiday", 0.5),
    );
    await idx.index(makeMemory("only-second", "Marrowby called twice", 1.5));

    const results = await idx.searchHybrid("quillfeather marrowby", QUERY_VEC, {
      limit: 10,
    });

    expect(results[0]!.memory.metadata.id).toBe("both");
    expect(results[0]!.exactMatch).toBe(true);
    const partial = results.filter((r) =>
      ["only-first", "only-second"].includes(r.memory.metadata.id),
    );
    expect(partial).toHaveLength(2);
    expect(partial.every((r) => r.exactMatch === false)).toBe(true);
    expect(results.filter((r) => r.exactMatch)).toHaveLength(1);
  });

  // Both spellings of an umlaut are the same word, whichever one the query uses — and the entry is
  // found at all, not only ranked: both targets are outside the vector pool, so only full-text
  // search can bring them in. The query adds the other spellings: "Rückmeldung" also searches
  // "rueckmeldung", "Rueckmeldung" also searches "rückmeldung". The index is not changed.
  describe("umlauts and their spelled-out form", () => {
    beforeEach(async () => {
      await indexFillers(35);
      await idx.index(
        makeMemory("umlaut", "Die Rückmeldung zur Größe kam gestern", 40),
      );
      await idx.index(
        makeMemory("spelled", "Die Rueckmeldung zur Groesse kam heute", 41),
      );
    });

    for (const query of [
      "Rueckmeldung",
      "Rückmeldung",
      "RÜCKMELDUNG",
      "Rückmeldung".normalize("NFD"), // u + combining diaeresis
      "Größe",
      "Groesse",
      "Rückmeldung Groesse",
    ]) {
      const label = query.normalize("NFC") === query ? query : `${query} (NFD)`;
      test(`"${label}" finds both spellings and puts them first`, async () => {
        const results = await idx.searchHybrid(query, QUERY_VEC, {
          limit: 10,
        });

        expect(ids(results).slice(0, 2).sort()).toEqual(["spelled", "umlaut"]);
        expect(results.slice(0, 2).every((r) => r.exactMatch)).toBe(true);
        expect(results[2]!.exactMatch).toBe(false);
      });
    }
  });

  test("one word may mix both spellings", async () => {
    await indexFillers(35);
    await idx.index(makeMemory("mixed", "Das Steuerbüro hat angerufen", 40));

    const results = await idx.searchHybrid("Steuerbuero", QUERY_VEC, {
      limit: 10,
    });

    expect(results[0]!.memory.metadata.id).toBe("mixed");
    expect(results[0]!.exactMatch).toBe(true);
  });

  test("capital ẞ is ß, in the query and in the text", async () => {
    await indexFillers(35);
    await idx.index(makeMemory("capital", "GROẞE STRAẞE GESPERRT", 40));
    await idx.index(makeMemory("spelled", "Die Strasse ist gesperrt", 41));

    for (const query of ["Strasse", "STRAẞE", "Straße"]) {
      const results = await idx.searchHybrid(query, QUERY_VEC, { limit: 10 });
      expect(ids(results).slice(0, 2).sort()).toEqual(["capital", "spelled"]);
      expect(results.slice(0, 2).every((r) => r.exactMatch)).toBe(true);
    }
  });

  test("a word of up to three letters counts only as a whole word", async () => {
    await indexFillers(35);
    await idx.index(makeMemory("whole", "Der KI-Agent schreibt Berichte", 40));
    // Contains "ki" only inside a word. A near vector neighbour, so it is a candidate.
    await idx.index(makeMemory("inside", "Kinder spielen im Garten", 0.5));

    const results = await idx.searchHybrid("KI", QUERY_VEC, { limit: 10 });

    expect(results[0]!.memory.metadata.id).toBe("whole");
    expect(results[0]!.exactMatch).toBe(true);
    const inside = results.find((r) => r.memory.metadata.id === "inside");
    expect(inside?.exactMatch).toBe(false);
  });

  test("the three-letter rule counts letters as typed, not spelled out", async () => {
    await indexFillers(35);
    // "Tür" and "Maß" are three letters; spelled out ("tuer", "mass") they would be four and
    // match inside other words. Both decoys are near vector neighbours, so they are candidates.
    await idx.index(makeMemory("door", "Die Tür klemmt wieder", 40));
    await idx.index(makeMemory("country", "Die Türkei-Reise ist gebucht", 0.5));
    await idx.index(makeMemory("measure", "Das Maß ist voll", 41));
    await idx.index(makeMemory("massage", "Die Massage war gut", 1.5));

    const door = await idx.searchHybrid("Tür", QUERY_VEC, { limit: 10 });
    expect(door[0]!.memory.metadata.id).toBe("door");
    expect(
      door.filter((r) => r.exactMatch).map((r) => r.memory.metadata.id),
    ).toEqual(["door"]);
    expect(
      door.find((r) => r.memory.metadata.id === "country")?.exactMatch,
    ).toBe(false);

    const measure = await idx.searchHybrid("Maß", QUERY_VEC, { limit: 10 });
    expect(measure[0]!.memory.metadata.id).toBe("measure");
    expect(
      measure.find((r) => r.memory.metadata.id === "massage")?.exactMatch,
    ).toBe(false);
  });

  test("a date or an id counts only with its parts in order, not scattered", async () => {
    await indexFillers(35);
    await idx.index(
      makeMemory("date", "Kick-off on 2026-09-15 in the small room", 40),
    );
    // Has 2026, 09 and 15 — apart. A full-text match too (the parts are separate words there).
    await idx.index(
      makeMemory("scattered", "In 2026 we plan 09 workshops for 15 people", 41),
    );
    await idx.index(makeMemory("id", "Superseded by dec-012 last week", 42));
    // "dec" and "012" only as parts of longer words. A near vector neighbour, so a candidate.
    await idx.index(
      makeMemory("id-longer", "See dec-0120 and the dec 012b draft", 0.5),
    );

    const byDate = await idx.searchHybrid("2026-09-15", QUERY_VEC, {
      limit: 10,
    });
    expect(byDate[0]!.memory.metadata.id).toBe("date");
    expect(
      byDate.filter((r) => r.exactMatch).map((r) => r.memory.metadata.id),
    ).toEqual(["date"]);
    expect(
      byDate.find((r) => r.memory.metadata.id === "scattered")?.exactMatch,
    ).toBe(false);

    const byId = await idx.searchHybrid("dec-012", QUERY_VEC, { limit: 10 });
    expect(byId[0]!.memory.metadata.id).toBe("id");
    expect(
      byId.filter((r) => r.exactMatch).map((r) => r.memory.metadata.id),
    ).toEqual(["id"]);
    expect(
      byId.find((r) => r.memory.metadata.id === "id-longer")?.exactMatch,
    ).toBe(false);
  });

  test("a longer word counts inside a compound", async () => {
    await indexFillers(35);
    // Full-text search matches whole words, so the compound is a candidate only as a near vector
    // neighbour — the exact-match check itself looks for the word anywhere.
    await idx.index(
      makeMemory("compound", "Das Wochenkontingent ist fast aufgebraucht", 0.5),
    );

    const results = await idx.searchHybrid("Kontingent", QUERY_VEC, {
      limit: 10,
    });

    expect(results[0]!.memory.metadata.id).toBe("compound");
    expect(results[0]!.exactMatch).toBe(true);
  });

  test("minScore never drops an exact match, and still filters the rest", async () => {
    await indexFillers(35);
    await idx.index(makeMemory("name", "Quillfeather confirmed", 40));

    const unfiltered = await idx.searchHybrid("Quillfeather", QUERY_VEC, {
      limit: 10,
    });
    const nameScore = unfiltered.find(
      (r) => r.memory.metadata.id === "name",
    )!.score;
    expect(nameScore).toBeLessThan(0.9); // below the threshold used next

    const results = await idx.searchHybrid("Quillfeather", QUERY_VEC, {
      limit: 10,
      minScore: 0.9,
    });

    expect(results[0]!.memory.metadata.id).toBe("name");
    expect(results.slice(1).every((r) => r.score >= 0.9)).toBe(true);
    expect(results.length).toBeLessThan(unfiltered.length);
  });

  test("without any exact match the order is the plain hybrid order", async () => {
    await indexFillers(35);
    await idx.index(makeMemory("name", "Quillfeather confirmed", 40));

    for (const query of ["Zeppelinhangar", "a", "–"]) {
      const results = await idx.searchHybrid(query, QUERY_VEC, { limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.exactMatch === false)).toBe(true);
      expectFallingScores(results);
    }
  });
});
