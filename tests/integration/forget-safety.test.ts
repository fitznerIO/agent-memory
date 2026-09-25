/**
 * forget() deletes files, so it must only ever delete entries that contain the query (#8).
 *
 * It used to delete every hybrid search result above minScore 0.3. That is no safety net: the
 * hybrid score is min-max normalised per call, so the best candidate always scores exactly 1.0,
 * even for a query that matches nothing. A query matching no entry deleted six unrelated files.
 *
 * These tests call forget() itself on a real store with real embeddings. The tests share one
 * store and run in order: the first deletes nothing, the second one entry, the third three, the
 * fourth one entry by its id.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
});
