import type { MemoryConfig } from "../shared/config.ts";
import type { EmbeddingEngine } from "./types.ts";

export function createEmbeddingEngine(_config: MemoryConfig): EmbeddingEngine {
  return {
    initialize: () => { throw new Error("Not implemented"); },
    embed: () => { throw new Error("Not implemented"); },
    embedBatch: () => { throw new Error("Not implemented"); },
    isReady: () => { throw new Error("Not implemented"); },
    dimensions: () => { throw new Error("Not implemented"); },
  };
}
