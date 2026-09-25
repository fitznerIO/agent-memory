/**
 * The CLI must refuse to work on a store that lies inside another store (#10).
 *
 * A store has its own `.git` (the Git Manager versions it). findProjectRoot() walks up to the first
 * folder with `.git` or `package.json`, so from anywhere inside `<proj>/.agent-memory/…` it stops at
 * the store itself and picks `<proj>/.agent-memory/.agent-memory`: a new, empty store inside the
 * real one. `note` and `store` then reported success and the entry was invisible from the project.
 *
 * The check runs before the memory system starts, so these tests never load the embedding model.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findEnclosingStore } from "../../src/shared/config.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

function runCli(cwd: string, args: string[]) {
  const p = Bun.spawnSync(["bun", CLI, ...args, "--no-global"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: p.exitCode,
    stdout: p.stdout.toString(),
    stderr: p.stderr.toString(),
  };
}

describe("nested stores (#10)", () => {
  let tempDir: string;
  let project: string;
  let store: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    project = join(tempDir, "proj");
    store = join(project, ".agent-memory");
    // A project with an existing store: package.json at the root, and the store's own .git.
    mkdirSync(join(store, ".git"), { recursive: true });
    mkdirSync(join(store, "semantic", "notes"), { recursive: true });
    writeFileSync(join(project, "package.json"), '{"name":"x"}');
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test("findEnclosingStore finds the store a path lies inside", () => {
    expect(findEnclosingStore(join(store, ".agent-memory"))).toBe(store);
    expect(
      findEnclosingStore(join(store, "semantic", "notes", ".agent-memory")),
    ).toBe(store);
  });

  test("findEnclosingStore recognises a store by its index, whatever its name", () => {
    const custom = join(tempDir, "custom-store");
    mkdirSync(join(custom, ".index"), { recursive: true });
    writeFileSync(join(custom, ".index", "search.sqlite"), "");
    expect(findEnclosingStore(join(custom, "sub", ".agent-memory"))).toBe(
      custom,
    );
  });

  test("findEnclosingStore returns null for a normal project store", () => {
    expect(findEnclosingStore(store)).toBeNull();
  });

  test("the CLI refuses to run from inside a store and creates nothing", () => {
    const result = runCli(join(store, "semantic", "notes"), [
      "note",
      "--content",
      "should not be written",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("inside the store");
    expect(result.stderr).toContain(store);
    expect(result.stdout).toBe("");
    expect(existsSync(join(store, ".agent-memory"))).toBe(false);
  });

  test("the CLI refuses --project-dir pointing into a store", () => {
    const result = runCli(project, [
      "store",
      "--title",
      "t",
      "--content",
      "c",
      "--project-dir",
      join(store, "semantic"),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("inside the store");
    expect(existsSync(join(store, "semantic", ".agent-memory"))).toBe(false);
  });
});
