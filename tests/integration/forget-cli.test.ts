/**
 * The CLI rejects forget calls it would otherwise misread (#8).
 *
 * forget() treats every scope other than exactly "entry" as "topic", so `--scope Entry` or a bare
 * `--scope` deleted up to ten entries instead of one. A bare `--query` (an empty shell variable)
 * became the query "true". Nothing is deleted in any of these calls. A later `--query` with a value
 * still counts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const TEST_TIMEOUT = 120_000;

describe("forget: CLI input checks (#8)", () => {
  let project: string;

  const run = (args: string[]) => {
    const p = Bun.spawnSync(["bun", CLI, "forget", ...args, "--no-global"], {
      cwd: project,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: p.exitCode,
      stdout: p.stdout.toString(),
      stderr: p.stderr.toString(),
    };
  };

  beforeAll(async () => {
    project = await createTempDir();
    writeFileSync(join(project, "package.json"), '{"name":"x"}');
  });

  afterAll(async () => {
    await cleanupTempDir(project);
  });

  for (const [label, args, expected] of [
    ["a scope in the wrong case", ["--query", "x", "--scope", "Entry", "--confirm"], 'Invalid --scope: Entry (expected "entry" or "topic")'],
    ["a scope without a value", ["--query", "x", "--scope", "--confirm"], "Invalid --scope: true"],
    ["a query without a value", ["--query", "--confirm"], "Missing value for --query"],
  ] as const) {
    test(
      `${label} is rejected`,
      () => {
        const result = run([...args]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(expected);
        expect(result.stdout).toBe("");
      },
      TEST_TIMEOUT,
    );
  }

  test(
    "a later --query with a value wins over an earlier bare one",
    () => {
      const result = run(["--query", "--query", "soup", "--confirm"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("Missing value");
      expect(JSON.parse(result.stdout).message).toBe(
        'No entry contains "soup". Nothing was forgotten.',
      );
    },
    TEST_TIMEOUT,
  );
});
