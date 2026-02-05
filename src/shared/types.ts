export type MemoryType = "core" | "semantic" | "episodic" | "procedural";

export type Importance = "high" | "medium" | "low";

export type CommitType =
  | "semantic"
  | "episodic"
  | "procedural"
  | "consolidate"
  | "archive";

export interface MemoryMetadata {
  id: string;
  title: string;
  type: MemoryType;
  tags: string[];
  importance: Importance;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  source: string;
}

export interface Memory {
  metadata: MemoryMetadata;
  content: string;
  filePath: string;
}

export interface MemoryNote {
  noteId: string;
  content: string;
  type: MemoryType;
  importance: Importance;
  timestamp: number;
}

export interface SearchResult {
  memory: Memory;
  score: number;
  matchType: "fts" | "vector" | "hybrid";
  source: string;
}

export interface EmbeddingVector {
  memoryId: string;
  vector: Float32Array;
  dimensions: number;
}

export interface HybridSearchOptions {
  limit: number;
  minScore: number;
  weightFts: number;
  weightVector: number;
  weightRecency: number;
  rrfK: number;
}

export interface SessionState {
  sessionId: string;
  startedAt: number;
  notes: MemoryNote[];
}
