/**
 * forget() looks at every full-text candidate, not just the first few hundred (#8).
 *
 * Full-text search finds every entry that contains the query's words in any order; only then
 * does forget() check for the phrase. When the candidate list was capped, the one entry with the
 * phrase could rank below the cap (a longer text scores lower) and was never checked, so forget
 * said "No entry contains" although one did. Here 510 entries have both words in the wrong order
 * and are shorter than the one entry with the phrase, so it ranks last.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 300_000;
const FILLERS = 510;
const TARGET =
  "Notes from the council meeting about the new zebra crossing outside the primary school, " +
  "the budget for the painting, the lights and the signs, and who will check it in spring";

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

describe("forget(): the phrase is found behind hundreds of candidates (#8)", () => {
  let tempDir: string;
  let system: MemorySystem;

  beforeAll(async () => {
    tempDir = await createTempDir();
    system = createMemorySystem({
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
    });
    await system.start();
    for (let i = 1; i <= FILLERS; i++) {
      await system.note({
        content: `The crossing by the zebra house, visit ${i}`,
        type: "semantic",
        importance: "low",
      });
    }
    await system.note({ content: TARGET, type: "semantic", importance: "low" });
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
    "the one entry with the phrase is deleted, none of the others",
    async () => {
      const result = await system.forget({
        query: "zebra crossing",
        scope: "entry",
        confirm: true,
      });

      expect(result.success).toBe(true);
      expect(result.forgotten).toHaveLength(1);
      const left = entryContents(tempDir);
      expect(left.some((c) => c.includes(TARGET))).toBe(false);
      expect(
        left.filter((c) => c.includes("The crossing by the zebra house")),
      ).toHaveLength(FILLERS);
    },
    TEST_TIMEOUT,
  );
});
