/**
 * forget() deletes files, so it must only ever delete entries that contain the query (#8).
 *
 * It used to delete every hybrid search result above minScore 0.3. That is no safety net: the
 * hybrid score is min-max normalised per call, so the best candidate always scores exactly 1.0,
 * even for a query that matches nothing. A query matching no entry deleted six unrelated files.
 *
 * These tests call forget() itself on a real store with real embeddings. The tests share one
 * store and run in order: the first two delete nothing, then one entry, three entries, and one
 * entry by its id.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

// Twelve entries on three topics. "derailleur" occurs in exactly one, "soup" in exactly three.
const ENTRIES = [
  "The tomatoes in the greenhouse need water every morning",
  "Pruning the apple tree is best done in late winter",
  "Compost needs a mix of green and brown material",
  "The raised bed by the fence gets the most sun",
  "My bicycle chain skips on the smallest sprocket",
  "The rear brake pads are worn and need replacing",
  "Tyre pressure for the road bike is six bar",
  "The derailleur hanger was bent after the fall",
  "Lentil soup with smoked paprika and cumin",
  "Leek and potato soup freezes well in portions",
  "Tomato soup tastes better with roasted garlic",
  "Minestrone uses whatever vegetables are left over",
  // Full-text search expands German words by stripping prefixes: "Betrages" and "Vertrages" both
  // index the stem "trag". A search may find this entry for "Vertrages"; forget must not delete it.
  "Die Hoehe des Betrages auf der Stromrechnung",
  // Full-text search drops one-letter words, so "variant A" searches for "variant" alone. The
  // freestanding "a" matters: a rule that only asks for the letter somewhere would accept it.
  "We tested variant B of a landing page",
  // All words of "Stufe 3" are here, but not as that phrase.
  "Stufe 1 ist fertig, danach kommen 3 Tests",
  // Prefix stripping turns "unsicher" (unsafe) into "sich", which "sicher" (safe) also indexes.
  "Das Deployment ist sicher",
];

/** Contents of every entry file still on disk. */
function entryContents(baseDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue; // .index, .git
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".md")) out.push(readFileSync(path, "utf8"));
    }
  };
  walk(baseDir);
  return out;
}

const remaining = (baseDir: string) =>
  ENTRIES.filter((e) => entryContents(baseDir).some((c) => c.includes(e)));

describe("forget(): deletes only entries that contain the query (#8)", () => {
  let tempDir: string;
  let system: MemorySystem;
  const noteIds = new Map<string, string>();

  beforeAll(async () => {
    tempDir = await createTempDir();
    system = createMemorySystem({
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
    });
    await system.start();
    for (const content of ENTRIES) {
      const { noteId } = await system.note({
        content,
        type: "semantic",
        importance: "low",
      });
      noteIds.set(content, noteId);
    }
    expect(remaining(tempDir)).toEqual(ENTRIES);
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
    "a query that matches nothing deletes nothing, in either scope",
    async () => {
      for (const scope of ["entry", "topic"] as const) {
        const result = await system.forget({
          query: "zzzunicornzzz",
          scope,
          confirm: true,
        });
        expect(result.forgotten).toEqual([]);
      }
      expect(remaining(tempDir)).toEqual(ENTRIES);
    },
    TEST_TIMEOUT,
  );

  test(
    "a word that matches only through stemming or a stripped prefix deletes nothing",
    async () => {
      // Sanity: full-text search does see these entries, so the protection is in forget itself.
      for (const [query, entry] of [
        ["Vertrages", "Die Hoehe des Betrages auf der Stromrechnung"],
        ["unsicher", "Das Deployment ist sicher"],
      ] as const) {
        const fts = await system.searchIndex.searchText(query, 10);
        expect(fts.map((r) => r.memory.content)).toContain(entry);

        const result = await system.forget({ query, scope: "topic", confirm: true });
        expect(result.forgotten).toEqual([]);
      }
      expect(remaining(tempDir)).toEqual(ENTRIES);
    },
    TEST_TIMEOUT,
  );

  test(
    "an uppercase OR in the query does not loosen the rule",
    async () => {
      // FTS5 reads a bare OR as an operator, so full-text search finds entries with either word.
      // (Only for words without stems — with a stem group the query becomes a syntax error and
      // finds nothing, which would make this test pass for the wrong reason.)
      const fts = await system.searchIndex.searchText("cumin OR garlic", 10);
      expect(fts.length).toBe(2);

      const result = await system.forget({
        query: "cumin OR garlic",
        scope: "topic",
        confirm: true,
      });
      expect(result.forgotten).toEqual([]);
      expect(remaining(tempDir)).toEqual(ENTRIES);
    },
    TEST_TIMEOUT,
  );

  test(
    "a one-letter word in the query still has to be in the entry",
    async () => {
      for (const scope of ["entry", "topic"] as const) {
        const result = await system.forget({
          query: "variant A",
          scope,
          confirm: true,
        });
        expect(result.forgotten).toEqual([]);
      }
      expect(remaining(tempDir)).toEqual(ENTRIES);
    },
    TEST_TIMEOUT,
  );

  test(
    "the words have to stand together, in the order of the query",
    async () => {
      // "Stufe 1 ist fertig, danach kommen 3 Tests" has both words, not the phrase "Stufe 3".
      for (const scope of ["entry", "topic"] as const) {
        const result = await system.forget({
          query: "Stufe 3",
          scope,
          confirm: true,
        });
        expect(result.forgotten).toEqual([]);
      }
      expect(remaining(tempDir)).toEqual(ENTRIES);
    },
    TEST_TIMEOUT,
  );

  test(
    "scope entry deletes the one entry containing the word, and nothing else",
    async () => {
      const result = await system.forget({
        query: "derailleur",
        scope: "entry",
        confirm: true,
      });

      expect(result.forgotten.length).toBe(1);
      expect(remaining(tempDir)).toEqual(
        ENTRIES.filter((e) => !e.includes("derailleur")),
      );
    },
    TEST_TIMEOUT,
  );

  test(
    "scope topic deletes every entry containing the word, and nothing else",
    async () => {
      const result = await system.forget({
        query: "soup",
        scope: "topic",
        confirm: true,
      });

      expect(result.forgotten.length).toBe(3);
      expect(remaining(tempDir)).toEqual(
        ENTRIES.filter((e) => !e.includes("derailleur") && !e.includes("soup")),
      );
    },
    TEST_TIMEOUT,
  );

  test(
    "an exact entry id deletes that entry, even though its text does not contain the id",
    async () => {
      const target = "Minestrone uses whatever vegetables are left over";
      const result = await system.forget({
        query: noteIds.get(target) as string,
        scope: "entry",
        confirm: true,
      });

      expect(result.forgotten.length).toBe(1);
      expect(remaining(tempDir)).toEqual(
        ENTRIES.filter(
          (e) =>
            !e.includes("derailleur") && !e.includes("soup") && e !== target,
        ),
      );
    },
    TEST_TIMEOUT,
  );

  // An id-shaped query is only ever an id. If it names no entry, nothing is deleted. Falling
  // through to the word rule turned "dec-001" into "dec" + "001", so a retry after the entry was
  // gone deleted every entry that merely cited it.
  test(
    "id-shaped queries: case and brackets are ignored, a retry or a near miss deletes nothing",
    async () => {
      const dec = await system.memoryStore({
        title: "Hosting decision",
        type: "decision",
        content: "We host the dashboard on the small VPS.",
      });
      const citing = await system.memoryStore({
        title: "Follow-up",
        type: "note",
        content: "See dec-001 and [[dec-001]] for the hosting choice, and dec-2 too.",
      });
      expect(dec.id).toBe("dec-001");
      const exists = (p: string) => existsSync(join(tempDir, p));

      // Uppercase, wrapped in [[…]] with a trailing dot: still the id dec-001.
      const first = await system.forget({
        query: " [[DEC-001]]. ",
        scope: "entry",
        confirm: true,
      });
      expect(first.forgotten).toEqual([dec.file_path]);

      // Retry, and near misses: nothing, although the citing note contains "dec" and "001".
      for (const query of ["dec-001", "dec-1", "decision-001", "dec-2"]) {
        for (const scope of ["entry", "topic"] as const) {
          const again = await system.forget({ query, scope, confirm: true });
          expect(again.forgotten).toEqual([]);
          expect(again.message).toContain("No entry has the id");
        }
      }
      expect(exists(citing.file_path)).toBe(true);
    },
    TEST_TIMEOUT,
  );
});
