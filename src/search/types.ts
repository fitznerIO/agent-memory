import type {
  ConnectionType,
  HybridSearchOptions,
  InverseConnectionType,
  KnowledgeEntry,
  KnowledgeType,
  Memory,
  SearchResult,
} from "../shared/types.ts";

export interface IndexStats {
  totalDocuments: number;
  totalEmbeddings: number;
  lastRebuilt: number;
}

export interface ConnectionRow {
  source_id: string;
  target_id: string;
  type: string;
  note: string | null;
  created_at: string;
}

export interface SearchIndex {
  // v1 methods (unchanged)
  index(memory: Memory): Promise<void>;
  remove(id: string): Promise<void>;
  searchText(query: string, limit?: number): Promise<SearchResult[]>;
  searchVector(vector: Float32Array, limit?: number): Promise<SearchResult[]>;
  searchHybrid(
    query: string,
    vector: Float32Array,
    options?: Partial<HybridSearchOptions>,
  ): Promise<SearchResult[]>;
  rebuild(): Promise<IndexStats>;
  close(): void;

  // v2-lite: Knowledge operations
  indexKnowledge(entry: Omit<KnowledgeEntry, "connections">): Promise<void>;
  removeKnowledge(id: string): Promise<void>;
  getKnowledgeById(id: string): Promise<KnowledgeEntry | null>;
  getNextSequentialId(type: KnowledgeType): Promise<string>;

  // v2-lite: Tag operations
  insertTags(entryId: string, tags: string[]): Promise<void>;
  removeTags(entryId: string): Promise<void>;
  getExistingTags(): Promise<string[]>;
  getTagsByEntryId(entryId: string): Promise<string[]>;

  // v2-lite: Connection operations
  insertConnection(
    sourceId: string,
    targetId: string,
    type: ConnectionType | InverseConnectionType,
    note?: string,
  ): Promise<void>;
  removeConnections(entryId: string): Promise<void>;
  getConnections(
    id: string,
    direction: "outgoing" | "incoming" | "both",
    types?: ConnectionType[],
  ): Promise<ConnectionRow[]>;
  getConnectionCount(id: string): Promise<number>;

  // v2-lite: Decay connection-awareness (PRD 10.2)
  getActiveConnectionCount(id: string): Promise<number>;

  // v2-lite: Tag-based filtering (hierarchical namespace tags)
  getEntriesByTags(tags: string[]): Promise<string[]>;

  // v2-lite: Connected-to filtering
  getConnectedEntryIds(id: string): Promise<string[]>;
}
