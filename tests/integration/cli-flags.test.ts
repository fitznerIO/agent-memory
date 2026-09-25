/**
 * Numeric CLI flags are validated before they reach the search (#9, item 7).
 *
 * `--limit -1` used to fail deep in SQLite with "k value in knn queries must be >= 0", and
 * `--limit abc` with "datatype mismatch". Now the CLI names the flag and what it expects.
 * The rejection happens before any search runs; these calls use a throwaway project.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const TEST_TIMEOUT = 120_000;

describe("numeric CLI flags (#9)", () => {
  let project: string;

  const run = (args: string[]) => {
    const p = Bun.spawnSync(["bun", CLI, ...args, "--no-global"], {
      cwd: project,
      stdout: "pipe",
      stderr: "pipe",
    });
    return { exitCode: p.exitCode, stderr: p.stderr.toString() };
  };

  beforeAll(async () => {
    project = await createTempDir();
    writeFileSync(join(project, "package.json"), '{"name":"x"}');
  });

  afterAll(async () => {
    await cleanupTempDir(project);
  });

  test(
    "traverse --depth 0 is rejected",
    () => {
      const result = run(["traverse", "--start", "dec-001", "--depth", "0"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "Invalid --depth: 0 (expected a whole number above 0)",
      );
    },
    TEST_TIMEOUT,
  );

  test(
    "a flag given without a value is rejected too",
    () => {
      // parseArgs turns a trailing flag without a value into the string "true".
      const result = run(["search", "--query", "anything", "--limit"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid --limit: true");
    },
    TEST_TIMEOUT,
  );

  test(
    "valid values still work (limit 1 to 200, min-score 0 and 1)",
    () => {
      for (const args of [
        ["--limit", "3", "--min-score", "0"],
        ["--limit", "5.0", "--min-score", "1"],
        ["--limit", "200"],
      ]) {
        const result = run(["search", "--query", "anything", ...args]);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).not.toContain("Invalid");
      }
    },
    TEST_TIMEOUT,
  );

  for (const [flag, value, expected] of [
    ["--limit", "-1", "Invalid --limit: -1 (expected a whole number from 1 to 200)"],
    ["--limit", "abc", "Invalid --limit: abc"],
    ["--limit", "0", "Invalid --limit: 0"],
    ["--limit", "2.5", "Invalid --limit: 2.5"],
    // Above the cap of 200. From 274 on, a tag filter would make the vector search ask
    // sqlite-vec for more than its 4096 neighbours ("k value in knn query too large").
    ["--limit", "201", "Invalid --limit: 201"],
    ["--limit", "274", "Invalid --limit: 274"],
    ["--min-score", "1.5", "Invalid --min-score: 1.5"],
    ["--min-score", "x", "Invalid --min-score: x"],
    ["--min-score", "", "Invalid --min-score: "],
  ] as const) {
    test(
      `search ${flag} ${value} is rejected with a readable message`,
      () => {
        const result = run(["search", "--query", "anything", flag, value]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(expected);
        expect(result.stderr).not.toContain("knn");
        expect(result.stderr).not.toContain("datatype mismatch");
      },
      TEST_TIMEOUT,
    );
  }
});
