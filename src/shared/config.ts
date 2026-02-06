import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

export function createDefaultConfig(): MemoryConfig {
  const baseDir = findProjectRoot(process.cwd());
  return {
    baseDir,
    sqlitePath: join(baseDir, ".index", "search.sqlite"),
    embeddingModel: "Xenova/all-MiniLM-L6-v2",
    embeddingDimensions: 384,
    hybridDefaults: {
      limit: 5,
      minScore: 0.3,
      weightFts: 0.3,
      weightVector: 0.5,
      weightRecency: 0.2,
      rrfK: 60,
    },
    maxCoreTokens: 4000,
  };
}
