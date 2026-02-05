import { join } from "node:path";
import { homedir } from "node:os";
import type { HybridSearchOptions } from "./types.ts";

export interface MemoryConfig {
  baseDir: string;
  sqlitePath: string;
  embeddingModel: string;
  embeddingDimensions: number;
  hybridDefaults: HybridSearchOptions;
  maxCoreTokens: number;
}

export function createDefaultConfig(): MemoryConfig {
  const baseDir = join(homedir(), ".agent-memory");
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
