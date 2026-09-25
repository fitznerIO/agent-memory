/**
 * What the CLI prints after a successful write (#12).
 *
 * An agent took a successful `store` for a failure: every call printed the transformers.js warning
 * `dtype not specified for "model"` to stderr, and `store` answered with a long JSON block of
 * suggested connections with 16-digit scores. This runs the real CLI in a throwaway project, so it
 * loads the embedding model (one process per call, sequentially).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const TEST_TIMEOUT = 120_000;

describe("CLI output after a write (#12)", () => {
  let project: string;

  const run = (args: string[]) => {
    const p = Bun.spawnSync(["bun", CLI, ...args, "--no-global"], {
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
    // First call creates the store (and says so on stderr); later calls run on an existing store.
    run(["note", "--content", "The dashboard is deployed with docker compose"]);
    run(["note", "--content", "Deploy the dashboard again after the config change"]);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await cleanupTempDir(project);
  });

  test(
    "no dtype warning on stderr",
    () => {
      const result = run(["note", "--content", "A third note about deploys"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("dtype");
      expect(result.stderr).toBe("");
    },
    TEST_TIMEOUT,
  );

  test(
    "store without --quiet: JSON, relevance rounded to three decimals",
    () => {
      const result = run([
        "store",
        "--title",
        "Deploy decision",
        "--type",
        "decision",
        "--content",
        "The dashboard is deployed with docker compose on the VPS",
      ]);
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.id).toBe("dec-001");
      expect(json.suggested_connections.length).toBeGreaterThan(0);
      for (const c of json.suggested_connections) {
        expect(Math.round(c.relevance * 1000) / 1000).toBe(c.relevance);
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "store --quiet: one line with id and path, nothing on stderr",
    () => {
      const result = run([
        "store",
        "--title",
        "Second deploy decision",
        "--type",
        "decision",
        "--content",
        "Deploys run from the main branch only",
        "--quiet",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(
        "stored dec-002 semantic/decisions/dec-002-second-deploy-decision.md\n",
      );
      expect(result.stderr).toBe("");
    },
    TEST_TIMEOUT,
  );

  test(
    "note --quiet: one line with the id",
    () => {
      const result = run(["note", "--content", "Quiet note", "--quiet"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^noted [0-9a-f-]{36}\n$/);
      expect(result.stderr).toBe("");
    },
    TEST_TIMEOUT,
  );
});
