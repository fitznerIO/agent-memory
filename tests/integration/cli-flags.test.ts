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

  for (const [flag, value, expected] of [
    ["--limit", "-1", "Invalid --limit: -1"],
    ["--limit", "abc", "Invalid --limit: abc"],
    ["--limit", "0", "Invalid --limit: 0"],
    ["--limit", "2.5", "Invalid --limit: 2.5"],
    ["--min-score", "1.5", "Invalid --min-score: 1.5"],
    ["--min-score", "x", "Invalid --min-score: x"],
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
