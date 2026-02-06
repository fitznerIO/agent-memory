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

export type StoreSource = "project" | "global";

export interface SearchResult {
  memory: Memory;
  score: number;
  matchType: "fts" | "vector" | "hybrid";
  source: string;
  storeSource: StoreSource;
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

// Tool input/output types (PRD F-01 through F-06)

export interface MemoryNoteInput {
  content: string;
  type: "semantic" | "episodic" | "procedural";
  importance: Importance;
}

export interface MemoryNoteOutput {
  success: boolean;
  noteId: string;
  message: string;
}

export interface MemorySearchInput {
  query: string;
  type?: MemoryType | "all";
  limit?: number;
  minScore?: number;
}

export interface MemorySearchOutput {
  results: Array<{
    content: string;
    source: string;
    score: number;
    type: string;
    lastAccessed: string;
    storeSource: StoreSource;
  }>;
  totalFound: number;
}

export interface MemoryReadInput {
  path: string;
}

export interface MemoryReadOutput {
  content: string;
  lastModified: string;
  wordCount: number;
}

export interface MemoryUpdateInput {
  path: string;
  content: string;
  reason: string;
}

export interface MemoryUpdateOutput {
  success: boolean;
  diff: string;
  indexed: boolean;
}

export interface MemoryForgetInput {
  query: string;
  scope: "entry" | "topic";
  confirm: boolean;
}

export interface MemoryForgetOutput {
  success: boolean;
  forgotten: string[];
  message: string;
}

export interface MemoryCommitInput {
  message: string;
  type: CommitType;
}

export interface MemoryCommitOutput {
  success: boolean;
  commitHash: string;
  filesChanged: number;
}
