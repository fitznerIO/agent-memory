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

export interface MarkdownDocument {
  frontmatter: Record<string, unknown>;
  body: string;
}

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
