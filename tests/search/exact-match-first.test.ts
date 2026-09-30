/**
 * Exact matches first in `searchHybrid`.
 *
 * Bug: with the vector weight above the full-text weight, an entry that never mentions a rare
 * name could come back first — normalised score 1.0 — while the entries that do mention it sat
 * on positions 3, 5 and 8 in a real store (the first test rebuilds the case with a synthetic
 * name; there they land on 4, 6 and 8). Fix: an entry whose title or text contains every query
 * word literally comes before every entry that does not; within both groups the hybrid order
 * stays. Entries that contain the query but are in neither candidate pool are fetched by a
 * separate full-text query and added; a search without an exact match ranks as before.
 *
 * Like rrf-fallback-rank.test.ts, these tests use the PRODUCTION weights and synthetic vectors at
 * known distances. All words are made up or generic.
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
import {
  DIMS,
  FIXED_TIME,
  QUERY_VEC,
  vectorAtDistance,
} from "../helpers/synthetic-vectors.ts";

function makeProdConfig(sqlitePath: string): MemoryConfig {
  return {
    baseDir: "/tmp/agent-memory-exact-test",
    sqlitePath,
    embeddingModel: "Xenova/all-MiniLM-L6-v2",
    embeddingDimensions: DIMS,
    hybridDefaults: { ...createDefaultConfig().hybridDefaults, minScore: 0.0 },
    maxCoreTokens: 4000,
  };
}

/** Same type, tags and timestamps for everyone, so no boost can flip the order. */
/** `distance` null: no vector at all, so the entry can only come in through full-text search. */
function makeMemory(
  id: string,
  content: string,
  distance: number | null,
  title = `Memory ${id}`,
): Memory & { embedding?: Float32Array } {
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
    embedding: distance === null ? undefined : vectorAtDistance(distance),
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
const exactIds = (results: SearchResult[]) =>
  ids(results.filter((r) => r.exactMatch));
const find = (results: SearchResult[], id: string) =>
  results.find((r) => r.memory.metadata.id === id);

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
   * reaches the candidates only through full-text search. Distances 0.5 and 1.5 sit inside it.
   */
  async function indexFillers(count: number) {
    for (let i = 0; i < count; i++) {
      await idx.index(makeMemory(`filler-${i}`, FILLER[i % FILLER.length]!, i));
    }
  }

  const search = (query: string, options = {}) =>
    idx.searchHybrid(query, QUERY_VEC, { limit: 10, ...options });

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

    const results = await search("Quillfeather");

    expect(ids(results).slice(0, 3).sort()).toEqual([
      "name-a",
      "name-b",
      "name-c",
    ]);
    expect(exactIds(results)).toHaveLength(3);

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

    const results = await search("quillfeather");

    expect(ids(results).slice(0, 2).sort()).toEqual(["in-text", "in-title"]);
    expect(results[2]!.exactMatch).toBe(false);
  });

  test("every query word must be there, in any order and any distance apart", async () => {
    await indexFillers(35);
    // The single-word entries are close vector neighbours, so they are candidates — and must
    // not count.
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

    const results = await search("quillfeather marrowby");

    expect(exactIds(results)).toEqual(["both"]);
    expect(find(results, "only-first")?.exactMatch).toBe(false);
    expect(find(results, "only-second")?.exactMatch).toBe(false);
  });

  // Both spellings of an umlaut are the same word, whichever one the query uses — and the entry is
  // found at all, not only ranked: both targets are outside the vector pool, and the regular
  // full-text query cannot connect the spellings. The candidate query can.
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
      "Rückmeldung".normalize("NFD"), // u + combining diaeresis
      "Größe",
      "Groesse",
      "Rückmeldung Groesse",
    ]) {
      const label = query.normalize("NFC") === query ? query : `${query} (NFD)`;
      test(`"${label}" finds both spellings and puts them first`, async () => {
        const results = await search(query);

        expect(ids(results).slice(0, 2).sort()).toEqual(["spelled", "umlaut"]);
        expect(exactIds(results)).toHaveLength(2);
      });
    }
  });

  test("a word may mix both spellings, in any number of places", async () => {
    await indexFillers(35);
    await idx.index(makeMemory("office", "Das Steuerbüro hat angerufen", 40));
    await idx.index(makeMemory("walker", "Ein Fussgänger wartet", 41));
    await idx.index(
      makeMemory("crossing", "Die Fußgängerstraßenübergänge sind gesperrt", 42),
    );

    expect(exactIds(await search("Steuerbuero"))).toEqual(["office"]);
    // The long compound contains "Fussgänger" too.
    expect(exactIds(await search("Fußgaenger")).sort()).toEqual([
      "crossing",
      "walker",
    ]);
    // Five pairs, all written the other way.
    expect(exactIds(await search("Fussgaengerstrassenuebergaenge"))).toEqual([
      "crossing",
    ]);
  });

  test("capital ẞ is ß, other accents are dropped, decomposed text is found", async () => {
    await indexFillers(35);
    await idx.index(makeMemory("capital", "GROẞE STRAẞE GESPERRT", 40));
    await idx.index(makeMemory("street", "Die Strasse ist gesperrt", 41));
    await idx.index(makeMemory("accent", "Treffen im Cafe am Markt", 42));
    await idx.index(
      makeMemory("nfd", "Die Nachfrage kam spät".normalize("NFD"), 43),
    );

    for (const query of ["Strasse", "STRAẞE"]) {
      expect(exactIds(await search(query)).sort()).toEqual([
        "capital",
        "street",
      ]);
    }
    expect(exactIds(await search("Café"))).toEqual(["accent"]);
    expect(exactIds(await search("spät"))).toEqual(["nfd"]);
  });

  test("a word of up to three letters counts only as a whole word", async () => {
    await indexFillers(35);
    await idx.index(makeMemory("whole", "Der KI-Agent schreibt Berichte", 40));
    // "ki" at the start and at the end of a longer word. Near vector neighbours: candidates.
    await idx.index(makeMemory("start", "Kinder spielen im Garten", 0.5));
    await idx.index(makeMemory("end", "Das Wiki ist veraltet", 1.5));

    const results = await search("KI");

    expect(exactIds(results)).toEqual(["whole"]);
    expect(find(results, "start")?.exactMatch).toBe(false);
    expect(find(results, "end")?.exactMatch).toBe(false);
  });

  test("the three-letter rule counts letters as typed, not spelled out", async () => {
    await indexFillers(35);
    // "Tür" and "Maß" are three letters; spelled out ("tuer", "mass") they would be four and
    // match inside other words. Both decoys are near vector neighbours, so they are candidates.
    await idx.index(makeMemory("door", "Die Tür klemmt wieder", 40));
    await idx.index(makeMemory("country", "Die Türkei-Reise ist gebucht", 0.5));
    await idx.index(makeMemory("measure", "Das Maß ist voll", 41));
    await idx.index(makeMemory("massage", "Die Massage war gut", 1.5));

    const door = await search("Tür");
    expect(exactIds(door)).toEqual(["door"]);
    expect(find(door, "country")?.exactMatch).toBe(false);

    const measure = await search("Maß");
    expect(exactIds(measure)).toEqual(["measure"]);
    expect(find(measure, "massage")?.exactMatch).toBe(false);
  });

  test("a longer word counts inside other words, at the start and at the end", async () => {
    await indexFillers(35);
    // At the start: found by the candidate query ("kontingent"*), outside the vector pool.
    await idx.index(
      makeMemory("start", "Die Kontingentgrenze ist erreicht", 40),
    );
    // At the end: no full-text query finds it, so it counts only as a near vector neighbour.
    await idx.index(
      makeMemory("end", "Das Wochenkontingent ist fast aufgebraucht", 0.5),
    );
    // Four letters are no longer "short".
    await idx.index(makeMemory("beat", "Der Wochentakt steht", 1.5));

    expect(exactIds(await search("Kontingent")).sort()).toEqual([
      "end",
      "start",
    ]);
    expect(exactIds(await search("Takt"))).toEqual(["beat"]);
  });

  test("a date or an id counts only with its parts in order, not scattered", async () => {
    await indexFillers(35);
    await idx.index(
      makeMemory("date", "Kick-off on 2026-09-15 in the small room", 40),
    );
    // Has 2026, 09 and 15 — apart.
    await idx.index(
      makeMemory("scattered", "In 2026 we plan 09 workshops for 15 people", 41),
    );
    await idx.index(makeMemory("id", "Superseded by dec-012 last week", 42));
    // "dec" and "012" without a separator or as parts of longer words. A candidate.
    await idx.index(
      makeMemory(
        "id-other",
        "See dec012, dec-0120 and the dec 012b draft",
        0.5,
      ),
    );

    const byDate = await search("2026-09-15");
    expect(exactIds(byDate)).toEqual(["date"]);
    expect(find(byDate, "scattered")?.exactMatch).toBe(false);

    const byId = await search("dec-012");
    expect(exactIds(byId)).toEqual(["id"]);
    expect(find(byId, "id-other")?.exactMatch).toBe(false);
  });

  test("a date is found even when many entries have its numbers apart", async () => {
    // 40 entries with 2026, 09 and 15 apart fill both pools. The two with the date are long, so
    // BM25 ranks them last among the 42 full-text matches — outside the top 30. The candidate
    // query looks for the date as a phrase.
    for (let i = 0; i < 40; i++) {
      await idx.index(
        makeMemory(
          `apart-${i}`,
          `In 2026 we plan 09 talks for 15 people (${i})`,
          i,
        ),
      );
    }
    const long = FILLER.slice(0, 6).join(". ");
    await idx.index(makeMemory("date-a", `${long}. Due 2026-09-15.`, 50));
    await idx.index(makeMemory("date-b", `${long}. Held on 2026/09/15.`, 51));

    const results = await search("2026-09-15");

    expect(ids(results).slice(0, 2).sort()).toEqual(["date-a", "date-b"]);
    expect(exactIds(results)).toHaveLength(2);
  });

  test("an entry only the candidate query finds does not move the other entries' scores", async () => {
    await indexFillers(35);
    const before = await search("Kontingent");

    // Outside both pools: no vector neighbour, no match for the regular full-text query.
    await idx.index(
      makeMemory("start", "Die Kontingentgrenze ist erreicht", 60),
    );
    const after = await search("Kontingent");

    expect(exactIds(after)).toEqual(["start"]);
    const scoreOf = new Map(before.map((r) => [r.memory.metadata.id, r.score]));
    for (const r of after.slice(1)) {
      // Not toBe: recency is computed from Date.now(), which moves between the two searches.
      expect(r.score).toBeCloseTo(scoreOf.get(r.memory.metadata.id)!, 10);
    }
  });

  test("query words that are FTS5 operators still find their entry", async () => {
    await indexFillers(35);
    await idx.index(makeMemory("pudding", "bread and butter pudding", 40));

    // The regular full-text query rejects "bread AND AND AND …" and falls back to vectors; the
    // candidate query quotes every word.
    const results = await search("bread AND butter");

    expect(exactIds(results)).toEqual(["pudding"]);
  });

  test("rows the check rejects do not crowd out the exact match", async () => {
    await indexFillers(35);
    // The tokenizer folds ü to u: the candidate query for "Buerger" / "Gruen" also matches every
    // "Burger…" / "Grund…". Short decoys rank first by BM25; the real entries are long and have
    // no vector.
    for (let i = 0; i < 40; i++) {
      await idx.index(makeMemory(`burger-${i}`, `Burger ${i}`, null));
      await idx.index(
        makeMemory(`grund-${i}`, `Aus diesem Grund die Grundlage ${i}`, null),
      );
    }
    const long = FILLER.slice(0, 8).join(". ");
    await idx.index(makeMemory("citizen", `${long}. Ein Bürger fragt.`, null));
    await idx.index(makeMemory("green", `${long}. Die Wiese ist grün.`, null));

    expect(exactIds(await search("Buerger"))).toEqual(["citizen"]);
    expect(exactIds(await search("Gruen", { limit: 5 }))).toEqual(["green"]);
  });

  test("a word with punctuation inside is found in either spelling", async () => {
    await indexFillers(35);
    await idx.index(makeMemory("umlaut", "Die KI-Übersicht ist fertig", 40));
    await idx.index(makeMemory("spelled", "Die KI-Uebersicht ist alt", 41));

    for (const query of ["KI-Übersicht", "KI-Uebersicht"]) {
      expect(exactIds(await search(query)).sort()).toEqual([
        "spelled",
        "umlaut",
      ]);
    }
  });

  test("marks inside words of other scripts are kept", async () => {
    await indexFillers(35);
    // काम (work) and कम (less) differ only by a vowel sign. Both are near vector neighbours.
    await idx.index(makeMemory("work", "काम पूरा हुआ", 0.5));
    await idx.index(makeMemory("less", "कम समय बचा", 1.5));

    expect(exactIds(await search("काम"))).toEqual(["work"]);
    expect(exactIds(await search("कम"))).toEqual(["less"]);
  });

  test("minScore never drops an exact match, and still filters the rest", async () => {
    await indexFillers(35);
    await idx.index(makeMemory("name", "Quillfeather confirmed", 40));

    const unfiltered = await search("Quillfeather");
    expect(find(unfiltered, "name")!.score).toBeLessThan(0.9);

    const results = await search("Quillfeather", { minScore: 0.9 });

    expect(results[0]!.memory.metadata.id).toBe("name");
    expect(results.slice(1).every((r) => r.score >= 0.9)).toBe(true);
    expect(results.length).toBeLessThan(unfiltered.length);
  });

  // A search without an exact match must rank exactly as before: the candidates are the regular
  // full-text pool and the vector pool, nothing else. The decoys contain what the candidate query
  // finds for these words through the tokenizer's folding ("bürger" is searched as "burger",
  // "dü" as "du") without containing the words themselves. They have no vector and the store is
  // small, so a decoy that slipped in would show up in the list.
  test("without an exact match the candidates and their order are the plain hybrid ones", async () => {
    await indexFillers(5);
    await idx.index(makeMemory("burger", "Der Burger war kalt", null));
    await idx.index(makeMemory("du", "du bist dran", null));

    for (const query of ["Buerger", "due", "Zeppelinhangar", "a", "–"]) {
      const results = await search(query);
      const pools = new Set([
        ...ids(await idx.searchText(query, 30)),
        ...ids(await idx.searchVector(QUERY_VEC, 30)),
      ]);
      expect(results.length).toBeGreaterThan(0);
      expect(exactIds(results)).toEqual([]);
      expect(ids(results).every((id) => pools.has(id))).toBe(true);
      expectFallingScores(results);
    }
  });
});
