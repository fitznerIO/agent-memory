import { createDefaultConfig, type MemoryConfig } from "./shared/config.ts";
import { createMemoryStore } from "./memory/store.ts";
import { createSearchIndex } from "./search/index.ts";
import { createGitManager } from "./git/manager.ts";
import { createEmbeddingEngine } from "./embedding/engine.ts";
import type { MemoryStore } from "./memory/types.ts";
import type { SearchIndex } from "./search/types.ts";
import type { GitManager } from "./git/types.ts";
import type { EmbeddingEngine } from "./embedding/types.ts";

export interface MemorySystem {
  memory: MemoryStore;
  search: SearchIndex;
  git: GitManager;
  embedding: EmbeddingEngine;
  config: MemoryConfig;
}

export function createMemorySystem(
  overrides?: Partial<MemoryConfig>,
): MemorySystem {
  const config = { ...createDefaultConfig(), ...overrides };
  return {
    memory: createMemoryStore(config),
    search: createSearchIndex(config),
    git: createGitManager(config),
    embedding: createEmbeddingEngine(config),
    config,
  };
}
