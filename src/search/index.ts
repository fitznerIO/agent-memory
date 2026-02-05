import type { MemoryConfig } from "../shared/config.ts";
import type { SearchIndex } from "./types.ts";

export function createSearchIndex(_config: MemoryConfig): SearchIndex {
  return {
    index: () => { throw new Error("Not implemented"); },
    remove: () => { throw new Error("Not implemented"); },
    searchText: () => { throw new Error("Not implemented"); },
    searchVector: () => { throw new Error("Not implemented"); },
    searchHybrid: () => { throw new Error("Not implemented"); },
    rebuild: () => { throw new Error("Not implemented"); },
    close: () => { throw new Error("Not implemented"); },
  };
}
