import type { MemoryConfig } from "../shared/config.ts";
import type { MemoryStore } from "./types.ts";

export function createMemoryStore(_config: MemoryConfig): MemoryStore {
  return {
    create: () => { throw new Error("Not implemented"); },
    read: () => { throw new Error("Not implemented"); },
    readByPath: () => { throw new Error("Not implemented"); },
    update: () => { throw new Error("Not implemented"); },
    delete: () => { throw new Error("Not implemented"); },
    list: () => { throw new Error("Not implemented"); },
    loadCore: () => { throw new Error("Not implemented"); },
  };
}
