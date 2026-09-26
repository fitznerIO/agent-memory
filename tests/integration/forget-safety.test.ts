/**
 * forget() deletes files, so it must only ever delete entries that contain the query (#8).
 *
 * It used to delete every hybrid search result above minScore 0.3. That is no safety net: the
 * hybrid score is min-max normalised per call, so the best candidate always scores exactly 1.0,
 * even for a query that matches nothing. A query matching no entry deleted six unrelated files.
 *
 * These tests call forget() itself on a real store with real embeddings. The tests share one
 * store and run in order; the later ones add the entries they need. forget never picks: it deletes
 * one id, the one entry (scope entry) or up to ten entries (scope topic) containing the phrase, and
 * refuses anything more (#23).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
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

/** Path of every entry file still on disk. */
function entryFiles(baseDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue; // .index, .git
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".md")) out.push(path);
    }
  };
  walk(baseDir);
  return out;
}

/** Contents of every entry file still on disk. */
function entryContents(baseDir: string): string[] {
  return entryFiles(baseDir).map((path) => readFileSync(path, "utf8"));
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
      const dec4 = await system.memoryStore({
        title: "Alerting decision",
        type: "decision",
        content: "Alerts go to the phone.",
      });
      expect([dec1.id, dec2.id, dec3.id, dec4.id]).toEqual([
        "dec-001",
        "dec-002",
        "dec-003",
        "dec-004",
      ]);
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

      // Digits of any script count and are read as ASCII: fullwidth "００４" is dec-004.
      const fourth = await system.forget({
        query: "DEC-\uFF10\uFF10\uFF14",
        scope: "entry",
        confirm: true,
      });
      expect(fourth.forgotten).toEqual([dec4.file_path]);

      // Retries and near misses: nothing, although the citing note contains "dec", "001", "002".
      for (const query of [
        "dec-001",
        "dec–002",
        "dec.001",
        "dec/002",
        "dec−001",
        "dec#003",
        "dec #\u0660\u0660\u0664", // Arabic-Indic digits: dec-004 again
        "dec-1",
        "dec-2",
      ]) {
        for (const scope of ["entry", "topic"] as const) {
          const again = await system.forget({ query, scope, confirm: true });
          expect(again.forgotten).toEqual([]);
          expect(again.message).toContain("No entry in the project store has the id");
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

  // Only a registered prefix makes an id. "gpt-5" or "GLM-5" are text like any other words, so
  // "gpt-5" and "gpt−5" (U+2212) behave the same: they delete the one entry containing them.
  test(
    "letters, a dash and a number without a registered prefix are text",
    async () => {
      const gpt = "The new model gpt-5 is fast";
      const glm = "Old notes on glm-5 benchmarks";
      for (const content of [gpt, glm]) {
        await system.note({ content, type: "semantic", importance: "low" });
      }
      const has = (text: string) =>
        entryContents(tempDir).some((c) => c.includes(text));

      const first = await system.forget({
        query: "gpt\u22125",
        scope: "entry",
        confirm: true,
      });
      expect(first.forgotten).toHaveLength(1);
      expect(has(gpt)).toBe(false);

      const second = await system.forget({
        query: "GLM-5",
        scope: "entry",
        confirm: true,
      });
      expect(second.forgotten).toHaveLength(1);
      expect(has(glm)).toBe(false);
    },
    TEST_TIMEOUT,
  );

  // A UUID is an id with any separator between its groups, like a prefixed id. As text, its groups
  // would match every entry that cites the UUID with plain hyphens, and that entry would go.
  test(
    "a UUID with any separator between its groups is an id; the entry citing it stays",
    async () => {
      const { noteId: target } = await system.note({
        content: "Fennel seeds go into the sausage mix",
        type: "semantic",
        importance: "low",
      });
      const citing = `See ${target} for the sausage recipe`;
      await system.note({ content: citing, type: "semantic", importance: "low" });
      const has = (text: string) =>
        entryContents(tempDir).some((c) => c.includes(text));

      const first = await system.forget({
        query: target.replaceAll("-", "\u2011"),
        scope: "entry",
        confirm: true,
      });
      expect(first.forgotten).toHaveLength(1);
      expect(has("Fennel seeds go into the sausage mix")).toBe(false);

      for (const query of [target.replaceAll("-", " "), target.replaceAll("-", "")]) {
        const again = await system.forget({ query, scope: "topic", confirm: true });
        expect(again.forgotten).toEqual([]);
        expect(again.message).toBe(
          `No entry in the project store has the id "${target}". Nothing was forgotten.`,
        );
      }
      expect(has(citing)).toBe(true);

      // A UUID that starts like a prefixed id is still one UUID, not "dec-01234" and more.
      const lookalike = "dec01234-5678-4abc-8def-0123456789ab";
      const third = await system.forget({
        query: lookalike,
        scope: "entry",
        confirm: true,
      });
      expect(third.message).toBe(
        `No entry in the project store has the id "${lookalike}". Nothing was forgotten.`,
      );
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
        if (scope === "topic") {
          expect(result.message).toContain(
            "Nothing was forgotten: --scope topic forgets at most 10 entries.",
          );
        }
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

  // The index is derived from the files: one edited by hand keeps its old text in the index until
  // rebuild-index. forget checks the phrase against the file it would delete, so a file that no
  // longer contains the query stays. The other way round is a known limit: text the index does not
  // know yet is not found.
  test(
    "a stale index: a file that no longer contains the query stays; new text is not found until rebuild-index",
    async () => {
      const text = "The lighthouse keeper logs every ship";
      await system.note({ content: text, type: "semantic", importance: "low" });
      const path = entryFiles(tempDir).find((p) =>
        readFileSync(p, "utf8").includes(text),
      ) as string;
      writeFileSync(
        path,
        `${readFileSync(path, "utf8").replaceAll("lighthouse", "harbour")}\nA pelican crossing was added by hand.\n`,
      );

      const gone = await system.forget({
        query: "lighthouse keeper",
        scope: "entry",
        confirm: true,
      });
      expect(gone.forgotten).toEqual([]);
      expect(gone.message).toBe(
        'No entry in the project store contains "lighthouse keeper". Nothing was forgotten.',
      );
      expect(existsSync(path)).toBe(true);

      const added = await system.forget({
        query: "pelican crossing",
        scope: "entry",
        confirm: true,
      });
      expect(added.forgotten).toEqual([]);
      expect(added.message).toBe(
        'No entry in the project store contains "pelican crossing". Nothing was forgotten.',
      );
      expect(existsSync(path)).toBe(true);
    },
    TEST_TIMEOUT,
  );

  // Exactly ten is still clear enough for --scope topic; eleven is not.
  test(
    "--scope topic deletes exactly ten matches and refuses eleven",
    async () => {
      for (let i = 1; i <= 10; i++) {
        await system.note({
          content: `Glass marble number ${i} rolled away`,
          type: "semantic",
          importance: "low",
        });
      }
      for (let i = 1; i <= 11; i++) {
        await system.note({
          content: `Tin soldier number ${i} stands guard`,
          type: "semantic",
          importance: "low",
        });
      }
      const count = (text: string) =>
        entryContents(tempDir).filter((c) => c.includes(text)).length;

      const ten = await system.forget({
        query: "glass marble",
        scope: "topic",
        confirm: true,
      });
      expect(ten.forgotten).toHaveLength(10);
      expect(count("Glass marble number")).toBe(0);

      const eleven = await system.forget({
        query: "tin soldier",
        scope: "topic",
        confirm: true,
      });
      expect(eleven.success).toBe(false);
      expect(eleven.message).toStartWith('11 entries contain "tin soldier": ');
      expect(count("Tin soldier number")).toBe(11);
    },
    TEST_TIMEOUT,
  );

  // forget deletes exactly the file it checked. Here two files share an id and only one contains
  // the phrase; a lookup by id finds the other one first (it scans core/ before semantic/), and
  // forget used to delete that one.
  test(
    "two files share an id: the one with the phrase is deleted, not the one an id lookup finds first",
    async () => {
      const text = "The brass lantern hangs by the door";
      const { noteId } = await system.note({
        content: text,
        type: "semantic",
        importance: "low",
      });
      const path = entryFiles(tempDir).find((p) =>
        readFileSync(p, "utf8").includes(text),
      ) as string;
      mkdirSync(join(tempDir, "core"), { recursive: true });
      const twin = join(tempDir, "core", `${noteId}-twin.md`);
      writeFileSync(
        twin,
        readFileSync(path, "utf8").replaceAll(text, "Nothing to see here"),
      );

      const result = await system.forget({
        query: "brass lantern",
        scope: "entry",
        confirm: true,
      });
      expect(result.forgotten).toEqual([relative(tempDir, path)]);
      expect(existsSync(path)).toBe(false);
      expect(existsSync(twin)).toBe(true);
    },
    TEST_TIMEOUT,
  );

  // An id lookup used to pick one of two files with the same id. Picking is not forget's call.
  test(
    "forget by id refuses when several files have that id, and names them",
    async () => {
      const dec = await system.memoryStore({
        title: "Retention decision",
        type: "decision",
        content: "Keep logs for 90 days.",
      });
      const twin = dec.file_path.replace(/\.md$/, "-copy.md");
      writeFileSync(
        join(tempDir, twin),
        readFileSync(join(tempDir, dec.file_path), "utf8"),
      );

      const result = await system.forget({
        query: dec.id,
        scope: "entry",
        confirm: true,
      });
      expect(result.success).toBe(false);
      expect(result.forgotten).toEqual([]);
      expect(result.message).toStartWith(`2 files have the id "${dec.id}": `);
      expect(result.message).toContain(dec.file_path);
      expect(result.message).toContain(twin);
      expect(result.message).toEndWith(
        "Nothing was forgotten: fix the duplicate ids first.",
      );
      expect(existsSync(join(tempDir, dec.file_path))).toBe(true);
      expect(existsSync(join(tempDir, twin))).toBe(true);

      // A twin filed in another type directory counts too.
      const other = await system.memoryStore({
        title: "Backup window decision",
        type: "decision",
        content: "Backups run at two in the morning.",
      });
      const misfiled = `episodic/incidents/${other.id}-misfiled.md`;
      mkdirSync(join(tempDir, "episodic", "incidents"), { recursive: true });
      writeFileSync(
        join(tempDir, misfiled),
        readFileSync(join(tempDir, other.file_path), "utf8"),
      );
      const again = await system.forget({
        query: other.id,
        scope: "entry",
        confirm: true,
      });
      expect(again.forgotten).toEqual([]);
      expect(again.message).toStartWith(`2 files have the id "${other.id}": `);
      expect(again.message).toContain(misfiled);
      expect(existsSync(join(tempDir, other.file_path))).toBe(true);
      expect(existsSync(join(tempDir, misfiled))).toBe(true);
    },
    TEST_TIMEOUT,
  );

  // The index row says which id is in the file. When the file says otherwise (edited by hand), the
  // row is stale and forget leaves the file alone.
  test(
    "a file whose id was changed by hand is not deleted through its old index row",
    async () => {
      const text = "The copper kettle whistles at seven";
      const { noteId } = await system.note({
        content: text,
        type: "semantic",
        importance: "low",
      });
      const path = entryFiles(tempDir).find((p) =>
        readFileSync(p, "utf8").includes(text),
      ) as string;
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          `id: ${noteId}`,
          "id: 00000000-0000-4000-8000-000000000000",
        ),
      );

      const result = await system.forget({
        query: "copper kettle",
        scope: "entry",
        confirm: true,
      });
      expect(result.forgotten).toEqual([]);
      expect(existsSync(path)).toBe(true);
    },
    TEST_TIMEOUT,
  );

  // A title that is a number or missing must not break forget for every query that finds the file.
  test(
    "a title that is not text, or no title, does not break forget",
    async () => {
      const jug = "The pewter jug holds cider";
      const mug = "The tin mug holds tea";
      for (const content of [jug, mug]) {
        await system.note({ content, type: "semantic", importance: "low" });
      }
      const fileWith = (text: string) =>
        entryFiles(tempDir).find((p) =>
          readFileSync(p, "utf8").includes(text),
        ) as string;
      const jugPath = fileWith(jug);
      const mugPath = fileWith(mug);
      writeFileSync(
        jugPath,
        readFileSync(jugPath, "utf8").replace(`title: ${jug}`, "title: 2026"),
      );
      writeFileSync(
        mugPath,
        readFileSync(mugPath, "utf8").replace(`title: ${mug}\n`, ""),
      );

      for (const [query, path] of [
        ["pewter jug", jugPath],
        ["tin mug", mugPath],
      ] as const) {
        const result = await system.forget({ query, scope: "entry", confirm: true });
        expect(result.forgotten).toHaveLength(1);
        expect(existsSync(path)).toBe(false);
      }
    },
    TEST_TIMEOUT,
  );

  // If a delete fails half-way, forget stops and the answer lists exactly what is already gone.
  test(
    "when a delete fails, forget stops and says which files are already gone",
    async () => {
      await system.note({
        content: "A silver spoon lies in the drawer",
        type: "semantic",
        importance: "low",
      });
      const dec = await system.memoryStore({
        title: "Cutlery decision",
        type: "decision",
        content: "The silver spoon goes to the guest room.",
      });
      const decDir = dirname(join(tempDir, dec.file_path));
      chmodSync(decDir, 0o555);
      try {
        const result = await system.forget({
          query: "silver spoon",
          scope: "topic",
          confirm: true,
        });
        expect(result.success).toBe(false);
        expect(result.message).toContain(`could not delete ${dec.file_path}`);
        expect(result.message).toEndWith("Nothing else was deleted.");
        expect(existsSync(join(tempDir, dec.file_path))).toBe(true);
        for (const f of result.forgotten) {
          expect(existsSync(join(tempDir, f))).toBe(false);
        }
      } finally {
        chmodSync(decDir, 0o755);
      }
    },
    TEST_TIMEOUT,
  );
});
