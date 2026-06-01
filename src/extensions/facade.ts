import type { MemorySystem } from "../index.ts";
import type { ConnectionType, MemoryStoreInput } from "../shared/types.ts";
import type { MemoryAPI, SearchFilters } from "./types.ts";

/**
 * Build the narrow MemoryAPI facade extensions use (§4.1), backed by the core
 * orchestrator. This is the sanctioned integration point: extensions never touch
 * core modules directly, only this facade + their own ExtensionDB.
 */
export function createMemoryApi(system: MemorySystem): MemoryAPI {
  return {
    async store(input: MemoryStoreInput): Promise<string> {
      const out = await system.memoryStore(input);
      return out.id;
    },

    async search(query: string, filters?: SearchFilters) {
      const out = await system.search({
        query,
        limit: filters?.limit,
        tags: filters?.tags,
        type: filters?.type as never,
      });
      // Surface only the fields the core search output genuinely carries — no
      // fabricated timestamps/importance. Extensions needing full metadata call
      // read(id) for the real KnowledgeEntry.
      return out.results.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        content: r.content,
        tags: r.tags,
        score: r.score,
        source: r.source,
        lastAccessed: r.lastAccessed,
        storeSource: r.storeSource,
      }));
    },

    async read(id: string) {
      return system.searchIndex.getKnowledgeById(id);
    },

    async update(id: string, content: string, reason?: string): Promise<void> {
      const entry = await system.searchIndex.getKnowledgeById(id);
      if (!entry) throw new Error(`Cannot update unknown entry: ${id}`);
      await system.update({
        path: entry.filePath,
        content,
        reason: reason ?? `extension update of ${id}`,
      });
    },

    async connect(
      sourceId: string,
      targetId: string,
      type: ConnectionType,
      note?: string,
    ): Promise<void> {
      await system.memoryConnect({
        source_id: sourceId,
        target_id: targetId,
        type,
        note,
      });
    },

    async commit(message: string, scope?: string): Promise<void> {
      await system.commit({
        message,
        type: (scope as never) ?? "semantic",
      });
    },

    setExtensionData(id, name, data) {
      return system.setExtensionData(id, name, data);
    },

    getExtensionData<T = unknown>(id: string, name: string) {
      return system.getExtensionData<T>(id, name);
    },
  };
}
