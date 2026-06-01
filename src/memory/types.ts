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
  list(filter?: MemoryFilter): Promise<Memory[]>;
  loadCore(): Promise<Memory[]>;
}
