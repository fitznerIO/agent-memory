import type {
  Importance,
  Memory,
  MemoryMetadata,
  MemoryType,
} from "../shared/types.ts";

export interface MemoryFilter {
  type?: MemoryType;
  tags?: string[];
  since?: number;
  limit?: number;
  importance?: Importance;
}

// MarkdownDocument now lives in src/shared/markdown.ts (single source of truth).
export type { MarkdownDocument } from "../shared/markdown.ts";

export interface MemoryStore {
  create(
    memory: Omit<Memory, "metadata"> & {
      metadata: Omit<
        MemoryMetadata,
        "id" | "createdAt" | "updatedAt" | "lastAccessedAt"
      >;
    },
  ): Promise<Memory>;
  read(id: string): Promise<Memory>;
  readByPath(filePath: string): Promise<Memory>;
  update(id: string, content: string): Promise<Memory>;
  delete(id: string): Promise<void>;
  /** Delete exactly this file (relative to the store, or absolute inside it). */
  deleteByPath(filePath: string): Promise<void>;
  /** Paths (relative to the store) of every file whose frontmatter has this id. */
  findPathsById(id: string): Promise<string[]>;
  list(filter?: MemoryFilter): Promise<Memory[]>;
  loadCore(): Promise<Memory[]>;
}
