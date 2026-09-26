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
  // Whole words only: "variant A" must not reach "variant Alpha", "rat" must not reach "Rater".
  "The variant Alpha was dropped",
  "The Rater gave five stars",
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
    "only whole words count: a query word does not match a longer word",
    async () => {
      for (const query of ["rat", "variant A"]) {
        for (const scope of ["entry", "topic"] as const) {
          const result = await system.forget({ query, scope, confirm: true });
          expect(result.forgotten).toEqual([]);
        }
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
    "id-shaped queries: case, brackets and any separator are ignored; a retry or a near miss deletes nothing",
    async () => {
      const dec1 = await system.memoryStore({
        title: "Hosting decision",
        type: "decision",
        content: "We host the dashboard on the small VPS.",
      });
      const dec2 = await system.memoryStore({
        title: "Backup decision",
        type: "decision",
        content: "Backups run every night.",
      });
      const citing = await system.memoryStore({
        title: "Follow-up",
        type: "note",
        content:
          "See dec-001 and [[dec-001]] for hosting, dec 002 for backups, and dec-2 too.",
      });
      const dec3 = await system.memoryStore({
        title: "Logging decision",
        type: "decision",
        content: "Logs are kept for 30 days.",
      });
      expect([dec1.id, dec2.id, dec3.id]).toEqual(["dec-001", "dec-002", "dec-003"]);
      const exists = (p: string) => existsSync(join(tempDir, p));

      // Uppercase, wrapped in [[…]] with a trailing dot, a non-breaking hyphen (U+2011): dec-001.
      const first = await system.forget({
        query: " [[DEC‑001]]. ",
        scope: "entry",
        confirm: true,
      });
      expect(first.forgotten).toEqual([dec1.file_path]);

      // A space instead of the hyphen: dec-002.
      const second = await system.forget({
        query: "dec 002",
        scope: "entry",
        confirm: true,
      });
      expect(second.forgotten).toEqual([dec2.file_path]);

      // Any separator the phrase rule accepts is a separator here too: "#", ".", "/", "−" (U+2212).
      const third = await system.forget({
        query: "dec #003",
        scope: "entry",
        confirm: true,
      });
      expect(third.forgotten).toEqual([dec3.file_path]);

      // Retries and near misses: nothing, although the citing note contains "dec", "001", "002".
      for (const query of [
        "dec-001",
        "dec–002",
        "dec.001",
        "dec/002",
        "dec−001",
        "dec#003",
        "dec-1",
        "decision-001",
        "decision‑001", // no registered prefix: only the dash folding makes this an id
        "dec-2",
      ]) {
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

  // A query that contains an id but is not exactly one id — a list, or an id in a sentence — is
  // refused. As text it matched exactly the entries that cite the id, and those were deleted.
  test(
    "a query with ids in a list or a sentence is refused and deletes nothing",
    async () => {
      const note = await system.memoryStore({
        title: "Handover",
        type: "note",
        content: "Open items from note-001 and inc-007, inc-008; see note 130.",
      });
      for (const query of [
        "inc-007, inc-008",
        "note 130 handover",
        "items from note-001",
        "Handover note-002",
        "see note #130 first",
        "note.130 and inc/007",
      ]) {
        for (const scope of ["entry", "topic"] as const) {
          const result = await system.forget({ query, scope, confirm: true });
          expect(result.forgotten).toEqual([]);
          expect(result.message).toContain("one id at a time");
        }
      }
      expect(existsSync(join(tempDir, note.file_path))).toBe(true);
    },
    TEST_TIMEOUT,
  );

  test(
    "a phrase in the title alone is enough",
    async () => {
      const entry = await system.memoryStore({
        title: "Quarterly zeppelin review",
        type: "note",
        content: "Numbers look fine.",
      });
      const result = await system.forget({
        query: "quarterly zeppelin review",
        scope: "entry",
        confirm: true,
      });
      expect(result.forgotten).toEqual([entry.file_path]);
    },
    TEST_TIMEOUT,
  );

  // forget never picks from several matches. Two entries contain "hot dog": --scope entry deletes
  // neither and names both, --scope topic deletes both. (Before, the hybrid ranking picked one.)
  test(
    "--scope entry with several matches deletes nothing and names them; --scope topic deletes them",
    async () => {
      const dog = "Our dog was hot, a hot dog pants, so the dog stays in the shade";
      const snack = "Lunch from the street stand: a hot dog in a soft bun with mustard";
      const ids: string[] = [];
      for (const content of [dog, snack]) {
        const { noteId } = await system.note({
          content,
          type: "semantic",
          importance: "low",
        });
        ids.push(noteId);
      }
      const hotDogEntries = () =>
        entryContents(tempDir).filter((c) => c.includes(dog) || c.includes(snack));

      const entry = await system.forget({
        query: "hot dog",
        scope: "entry",
        confirm: true,
      });
      expect(entry.success).toBe(false);
      expect(entry.forgotten).toEqual([]);
      expect(entry.message).toStartWith('2 entries contain "hot dog": ');
      for (const id of ids) expect(entry.message).toContain(id);
      expect(entry.message).toEndWith(
        "Nothing was forgotten: forget one id, or use --scope topic.",
      );
      expect(hotDogEntries()).toHaveLength(2);

      const topic = await system.forget({
        query: "hot dog",
        scope: "topic",
        confirm: true,
      });
      expect(topic.forgotten).toHaveLength(2);
      expect(hotDogEntries()).toHaveLength(0);
    },
    TEST_TIMEOUT,
  );

  // --scope topic deletes at most ten. With more matches it used to delete ten of them, chosen by
  // rank; now it deletes nothing and gives the count and the first ten ids. --scope entry, too.
  test(
    "more than ten matches: nothing is deleted in either scope; the message gives the count and ten ids",
    async () => {
      const ids: string[] = [];
      for (let i = 1; i <= 12; i++) {
        const { noteId } = await system.note({
          content: `Paper kite number ${i} for the beach festival`,
          type: "semantic",
          importance: "low",
        });
        ids.push(noteId);
      }
      for (const scope of ["entry", "topic"] as const) {
        const result = await system.forget({
          query: "paper kite",
          scope,
          confirm: true,
        });
        expect(result.success).toBe(false);
        expect(result.forgotten).toEqual([]);
        expect(result.message).toStartWith('12 entries contain "paper kite": ');
        expect(result.message).toContain(" and 2 more. Nothing was forgotten: ");
        expect(result.message).toEndWith("narrow the query.");
        expect(ids.filter((id) => result.message.includes(id))).toHaveLength(10);
      }
      expect(
        entryContents(tempDir).filter((c) => c.includes("Paper kite number")),
      ).toHaveLength(12);
    },
    TEST_TIMEOUT,
  );

  // Full-text search cannot run every query: the sanitiser drops "A", FTS5 rejects a bare "OR" and
  // "bread AND butter". Nothing is deleted, and the message says why instead of claiming that no
  // entry contains the query — each of these entries does (#23).
  test(
    "a query full-text search cannot run deletes nothing and says so",
    async () => {
      const entries = [
        "Bread and butter pudding for Sunday",
        "Plan A failed, so we switched",
        "Keep this OR that",
      ];
      for (const content of entries) {
        await system.note({ content, type: "semantic", importance: "low" });
      }
      for (const query of ["bread AND butter", "A", "OR"]) {
        for (const scope of ["entry", "topic"] as const) {
          const result = await system.forget({ query, scope, confirm: true });
          expect(result.success).toBe(false);
          expect(result.forgotten).toEqual([]);
          expect(result.message).toBe(
            `Full-text search could not run "${query}", so nothing was forgotten. Try the entry id.`,
          );
        }
      }
      const left = entryContents(tempDir);
      for (const content of entries) {
        expect(left.some((c) => c.includes(content))).toBe(true);
      }
    },
    TEST_TIMEOUT,
  );
});
