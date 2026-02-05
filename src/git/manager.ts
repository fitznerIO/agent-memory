import type { MemoryConfig } from "../shared/config.ts";
import type { GitManager } from "./types.ts";

export function createGitManager(_config: MemoryConfig): GitManager {
  return {
    init: () => { throw new Error("Not implemented"); },
    commit: () => { throw new Error("Not implemented"); },
    log: () => { throw new Error("Not implemented"); },
    diff: () => { throw new Error("Not implemented"); },
    getFileAtCommit: () => { throw new Error("Not implemented"); },
    status: () => { throw new Error("Not implemented"); },
    isInitialized: () => { throw new Error("Not implemented"); },
  };
}
