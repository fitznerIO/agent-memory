import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { HybridSearchOptions } from "./types.ts";

export interface MemoryConfig {
  baseDir: string;
  sqlitePath: string;
  globalDir?: string;
  globalSqlitePath?: string;
  embeddingModel: string;
  embeddingDimensions: number;
  hybridDefaults: HybridSearchOptions;
  maxCoreTokens: number;
}

/**
 * Walk up from `cwd` looking for `.git/` or `package.json`.
 * Returns `<projectRoot>/.agent-memory` or `<cwd>/.agent-memory` as fallback.
 */
export function findProjectRoot(cwd: string): string {
  let dir = resolve(cwd);

  while (true) {
    if (
      existsSync(join(dir, ".git")) ||
      existsSync(join(dir, "package.json"))
    ) {
      return join(dir, ".agent-memory");
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return join(resolve(cwd), ".agent-memory");
}

/**
 * The store folder that `storeDir` lies inside, or null.
 *
 * A store has its own `.git` (the Git Manager versions it), so findProjectRoot() called from
 * anywhere inside `<proj>/.agent-memory/…` stops at the store itself and returns
 * `<proj>/.agent-memory/.agent-memory` — a new, empty store inside the real one, which nothing
 * else ever reads.
 *
 * Symlinks are resolved first, so a path that reaches a store through a link is caught too.
 * Not recognised: a store at a custom `--base-dir`. `--base-dir` alone does not move the index —
 * it stays in the store of the project the command runs from — so the custom folder holds only its
 * `.git`, and a folder not named `.agent-memory` needs an index to count (see `isStore()`).
 */
export function findEnclosingStore(storeDir: string): string | null {
  let dir = dirname(realPath(storeDir));
  while (true) {
    if (isStore(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * A folder is a store if it is named `.agent-memory` and has the store's own `.git` or index, or,
 * under any other name, has an index next to a memory folder. A folder merely named
 * `.agent-memory`, or a stray `.index/search.sqlite` from some other tool, does not count.
 */
function isStore(dir: string): boolean {
  const hasIndex = existsSync(join(dir, ".index", "search.sqlite"));
  if (basename(dir) === ".agent-memory") {
    return hasIndex || existsSync(join(dir, ".git"));
  }
  return (
    hasIndex &&
    ["semantic", "episodic", "procedural"].some((t) => existsSync(join(dir, t)))
  );
}

/** `path` with symlinks resolved in the part that exists; the rest may not exist yet. */
function realPath(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(basename(existing));
    existing = parent;
  }
  return join(realpathSync(existing), ...rest);
}

export function createDefaultConfig(): MemoryConfig {
  const baseDir = findProjectRoot(process.cwd());
  return {
    baseDir,
    sqlitePath: join(baseDir, ".index", "search.sqlite"),
    embeddingModel: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    embeddingDimensions: 384,
    hybridDefaults: {
      limit: 5,
      minScore: 0.1,
      weightFts: 0.4,
      weightVector: 0.55,
      weightRecency: 0.05,
      rrfK: 60,
    },
    maxCoreTokens: 4000,
  };
}
