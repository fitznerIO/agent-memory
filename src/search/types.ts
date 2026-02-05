import type {
  HybridSearchOptions,
  Memory,
  SearchResult,
} from "../shared/types.ts";

export interface IndexStats {
  totalDocuments: number;
  totalEmbeddings: number;
  lastRebuilt: number;
}

export interface SearchIndex {
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
}
