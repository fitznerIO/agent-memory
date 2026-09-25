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
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findEnclosingStore } from "../../src/shared/config.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

function runCli(cwd: string, args: string[]) {
  const p = Bun.spawnSync(["bun", CLI, ...args], {
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
    mkdirSync(join(custom, "semantic"), { recursive: true });
    writeFileSync(join(custom, ".index", "search.sqlite"), "");
    expect(findEnclosingStore(join(custom, "sub", ".agent-memory"))).toBe(
      custom,
    );
  });

  test("findEnclosingStore returns null for a normal project store", () => {
    expect(findEnclosingStore(store)).toBeNull();
  });

  test("findEnclosingStore does not mistake look-alikes for a store", () => {
    // A folder merely named .agent-memory (no .git, no index) is not a store.
    const named = join(tempDir, ".agent-memory", "work", "repo");
    mkdirSync(named, { recursive: true });
    expect(findEnclosingStore(join(named, ".agent-memory"))).toBeNull();

    // A stray .index/search.sqlite from some other tool, without memory folders, is not one either.
    const stray = join(tempDir, "tool-output");
    mkdirSync(join(stray, ".index"), { recursive: true });
    writeFileSync(join(stray, ".index", "search.sqlite"), "");
    mkdirSync(join(stray, "repo"), { recursive: true });
    expect(findEnclosingStore(join(stray, "repo", ".agent-memory"))).toBeNull();
  });

  test("findEnclosingStore sees through a symlink into a store", () => {
    const alias = join(tempDir, "alias");
    symlinkSync(join(store, "semantic"), alias);
    expect(findEnclosingStore(join(alias, ".agent-memory"))).toBe(store);
  });

  test("the CLI refuses to run from inside a store and creates nothing", () => {
    const result = runCli(join(store, "semantic", "notes"), [
      "note",
      "--content",
      "should not be written",
      "--no-global",
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
      "--no-global",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("inside the store");
    expect(result.stdout).toBe("");
    expect(existsSync(join(store, "semantic", ".agent-memory"))).toBe(false);
  });

  // --base-dir moves only the store, not its index (that stays derived from the working
  // directory), so this is the one case where the store check alone has to catch it.
  test("the CLI refuses --base-dir pointing into a store", () => {
    const inner = join(store, "semantic", "inner");
    const result = runCli(project, [
      "note",
      "--content",
      "x",
      "--base-dir",
      inner,
      "--no-global",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`the store would be ${inner}`);
    expect(result.stdout).toBe("");
    expect(existsSync(inner)).toBe(false);
  });

  // migrate resolves its store path itself and never goes through initSystem, so it has its own
  // check; this is the only thing guarding that path.
  test("migrate refuses --project-dir pointing into a store", () => {
    const result = runCli(project, [
      "migrate",
      "--step",
      "split-files",
      "--project-dir",
      join(store, "semantic"),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("inside the store");
    expect(result.stdout).toBe("");
    expect(existsSync(join(store, "semantic", ".agent-memory"))).toBe(false);
  });

  // Every place the CLI would write is checked, not only the project store.
  describe("from a normal project, pointing another write path into a store", () => {
    let other: string;

    beforeEach(() => {
      other = join(tempDir, "other");
      mkdirSync(other, { recursive: true });
      writeFileSync(join(other, "package.json"), '{"name":"other"}');
    });

    test("--global-dir inside a store", () => {
      const result = runCli(other, [
        "note",
        "--content",
        "x",
        "--global-dir",
        join(store, "child"),
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("inside the store");
      expect(result.stdout).toBe("");
      expect(existsSync(join(store, "child"))).toBe(false);
    });

    test("--sqlite-path inside a store", () => {
      const result = runCli(other, [
        "note",
        "--content",
        "x",
        "--no-global",
        "--sqlite-path",
        join(store, "child", ".index", "search.sqlite"),
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("inside the store");
      expect(result.stdout).toBe("");
      expect(existsSync(join(store, "child"))).toBe(false);
    });
  });
});
