import { existsSync } from "node:fs";
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
 * else ever reads. A folder counts as a store if it is named `.agent-memory` or holds a search
 * index, so a store at a custom `--base-dir` is recognised too.
 */
export function findEnclosingStore(storeDir: string): string | null {
  let dir = dirname(resolve(storeDir));
  while (true) {
    if (
      basename(dir) === ".agent-memory" ||
      existsSync(join(dir, ".index", "search.sqlite"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
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
