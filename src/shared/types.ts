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
  tags: string[];
}

export type StoreSource = "project" | "global";

export interface SearchResult {
  memory: Memory;
  score: number;
  matchType: "fts" | "vector" | "hybrid";
  source: string;
  storeSource: StoreSource;
}

export interface HybridSearchOptions {
  limit: number;
  minScore: number;
  weightFts: number;
  weightVector: number;
  weightRecency: number;
  rrfK: number;
  /** Tags from the current context — results matching these tags get a boost */
  boostTags?: string[];
  /** Entry ID the user is currently looking at — connected entries get a boost */
  contextEntryId?: string;
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
  tags?: string[]; // v2-lite: namespace tags
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
  tags?: string[]; // v2-lite: namespace tag filter (hierarchical: "tech/" matches "tech/ai/...")
  connected_to?: string; // v2-lite: only entries connected to this ID
}

export interface MemorySearchOutput {
  results: Array<{
    content: string;
    source: string;
    score: number;
    type: string;
    lastAccessed: string;
    storeSource: StoreSource;
    id?: string; // v2-lite
    title?: string; // v2-lite
    tags?: string[]; // v2-lite
    connections?: Connection[]; // v2-lite
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
  suggested_connections?: Array<{
    id: string;
    title: string;
    relevance: number;
  }>; // v2-lite: returned on significant content change
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

// Rebuild index output
export interface RebuildIndexOutput {
  totalDocuments: number;
  totalEmbeddings: number;
  knowledgeEntries: number;
  elapsed: number;
}

// Consolidation types
export interface ConsolidationInput {
  dryRun?: boolean;
}

export type NoteCategory =
  | "decision"
  | "incident"
  | "workflow"
  | "fact"
  | "note";

export interface ConsolidationAction {
  type: "create_file" | "normalize_tags" | "skip_duplicate" | "subsume";
  noteId: string;
  category: NoteCategory;
  targetType?: KnowledgeType;
  title?: string;
  content?: string;
  tags?: string[];
  duplicateOfId?: string;
  supersedesId?: string;
}

export interface ConsolidationOutput {
  actions: ConsolidationAction[];
  filesCreated: number;
  tagsNormalized: number;
  duplicatesSkipped: number;
  subsumed: number;
}

// Decay / Lifecycle types
export interface ArchiveCandidate {
  id: string;
  title: string;
  type: string;
  lastAccessed: string | null;
  accessCount: number;
  daysSinceAccess: number;
  importance: "high" | "medium" | "low";
  activeConnections: number;
  status: "archive_candidate" | "connected_but_stale";
  reason: string;
}

export interface DecayOutput {
  candidates: ArchiveCandidate[];
  totalEvaluated: number;
  totalCandidates: number;
}

// ---------------------------------------------------------------------------
// v2-lite Types
// ---------------------------------------------------------------------------

export type KnowledgeType =
  | "decision"
  | "incident"
  | "entity"
  | "pattern"
  | "workflow"
  | "note"
  | "session";

export type ConnectionType =
  | "related"
  | "builds_on"
  | "contradicts"
  | "part_of"
  | "supersedes";

export type InverseConnectionType =
  | "related"
  | "extended_by"
  | "contradicts"
  | "contains"
  | "superseded_by";

export interface Connection {
  target: string;
  type: ConnectionType | InverseConnectionType;
  note?: string;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  type: KnowledgeType;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  lastAccessed?: string;
  accessCount: number;
  tags: string[];
  connections: Connection[];
}

// Tool I/O for memory_store (v2-lite)

export interface MemoryStoreInput {
  title: string;
  type: KnowledgeType;
  content: string;
  tags?: string[];
  connections?: Array<{
    target: string;
    type: ConnectionType;
    note?: string;
  }>;
}

export interface MemoryStoreOutput {
  id: string;
  file_path: string;
  suggested_connections: Array<{
    id: string;
    title: string;
    relevance: number;
  }>;
  existing_tags: string[];
}

// Tool I/O for memory_connect (v2-lite)

export interface MemoryConnectInput {
  source_id: string;
  target_id: string;
  type: ConnectionType;
  note?: string;
}

export interface MemoryConnectOutput {
  success: boolean;
  inverse_type: string;
}

// Tool I/O for memory_traverse (v2-lite)

export interface MemoryTraverseInput {
  start_id: string;
  direction: "outgoing" | "incoming" | "both";
  types?: ConnectionType[];
  depth?: number;
}

export interface MemoryTraverseOutput {
  results: Array<{
    id: string;
    title: string;
    type: string;
    connection_type: string;
    distance: number;
  }>;
}
