import { randomUUID } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { MemoryConfig } from "../shared/config.ts";
import {
  InvalidMemoryTypeError,
  MemoryNotFoundError,
  PathTraversalError,
} from "../shared/errors.ts";
import type { Memory, MemoryMetadata, MemoryType } from "../shared/types.ts";
import { parseMarkdown, serializeMarkdown } from "./parser.ts";
import type { MemoryFilter, MemoryStore } from "./types.ts";

const VALID_TYPES: Set<MemoryType> = new Set([
  "core",
  "semantic",
  "episodic",
  "procedural",
]);

function validatePath(filePath: string, baseDir: string): void {
  const resolvedPath = resolve(filePath);
  const resolvedBase = resolve(baseDir);

  if (!resolvedPath.startsWith(resolvedBase)) {
    throw new PathTraversalError(filePath);
  }
}

function getTypeDir(type: MemoryType): string {
  return type;
}

async function readMemoryFile(filePath: string): Promise<Memory> {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    throw new MemoryNotFoundError(filePath);
  }

  const raw = await file.text();
  const doc = parseMarkdown(raw);

  const metadata = doc.frontmatter as unknown as MemoryMetadata;

  return {
    metadata,
    content: doc.body,
    filePath,
  };
}

async function findMemoryById(
  baseDir: string,
  id: string,
): Promise<string | null> {
  // Search all type directories for the file matching id
  for (const type of VALID_TYPES) {
    const typeDir = join(baseDir, getTypeDir(type));
    try {
      const files = await readdir(typeDir);
      for (const file of files) {
        if (file.endsWith(".md")) {
          const filePath = join(typeDir, file);
          const memory = await readMemoryFile(filePath);
          if (memory.metadata.id === id) {
            return filePath;
          }
        }
      }
    } catch {
      // Directory might not exist
    }
  }
  return null;
}

export function createMemoryStore(config: MemoryConfig): MemoryStore {
  return {
    async create(input) {
      const { metadata: inputMetadata, content } = input;
      const type = inputMetadata.type;

      if (!VALID_TYPES.has(type)) {
        throw new InvalidMemoryTypeError(type);
      }

      // Generate unique ID
      const id = randomUUID();
      const now = Date.now();

      // Create full metadata
      const metadata: MemoryMetadata = {
        ...inputMetadata,
        id,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      };

      // Determine file path
      const typeDir = getTypeDir(type);
      const fileName = `${id}.md`;
      const filePath = join(config.baseDir, typeDir, fileName);
      const relFilePath = relative(config.baseDir, filePath);

      // Ensure directory exists
      await mkdir(join(config.baseDir, typeDir), { recursive: true });

      // Serialize and write
      const doc = {
        frontmatter: metadata as unknown as Record<string, unknown>,
        body: content,
      };
      const serialized = serializeMarkdown(doc);
      await Bun.write(filePath, serialized);

      return {
        metadata,
        content,
        filePath: relFilePath,
      };
    },

    async read(id) {
      const filePath = await findMemoryById(config.baseDir, id);
      if (!filePath) {
        throw new MemoryNotFoundError(id);
      }
      const memory = await readMemoryFile(filePath);
      return {
        ...memory,
        filePath: relative(config.baseDir, filePath),
      };
    },

    async readByPath(filePath) {
      const resolvedPath = resolve(config.baseDir, filePath);
      validatePath(resolvedPath, config.baseDir);

      const memory = await readMemoryFile(resolvedPath);
      return {
        ...memory,
        filePath: relative(config.baseDir, resolvedPath),
      };
    },

    async update(id, newContent) {
      const filePath = await findMemoryById(config.baseDir, id);
      if (!filePath) {
        throw new MemoryNotFoundError(id);
      }

      const memory = await readMemoryFile(filePath);
      const updatedMetadata: MemoryMetadata = {
        ...memory.metadata,
        updatedAt: Date.now(),
      };

      const doc = {
        frontmatter: updatedMetadata as unknown as Record<string, unknown>,
        body: newContent,
      };
      const serialized = serializeMarkdown(doc);
      await Bun.write(filePath, serialized);

      return {
        metadata: updatedMetadata,
        content: newContent,
        filePath: relative(config.baseDir, filePath),
      };
    },

    async delete(id) {
      const filePath = await findMemoryById(config.baseDir, id);
      if (!filePath) {
        throw new MemoryNotFoundError(id);
      }

      const file = Bun.file(filePath);
      await file.delete();
    },

    async list(filter?: MemoryFilter) {
      const memories: Memory[] = [];

      for (const type of VALID_TYPES) {
        // Skip if type filter doesn't match
        if (filter?.type && filter.type !== type) {
          continue;
        }

        const typeDir = join(config.baseDir, getTypeDir(type));
        try {
          const files = await readdir(typeDir);
          for (const file of files) {
            if (file.endsWith(".md")) {
              const filePath = join(typeDir, file);
              const memory = await readMemoryFile(filePath);

              // Apply filters
              if (
                filter?.importance &&
                filter.importance !== memory.metadata.importance
              ) {
                continue;
              }

              if (filter?.since && memory.metadata.createdAt < filter.since) {
                continue;
              }

              if (
                filter?.tags &&
                filter.tags.length > 0 &&
                !filter.tags.some((tag) => memory.metadata.tags.includes(tag))
              ) {
                continue;
              }

              memories.push({
                ...memory,
                filePath: relative(config.baseDir, filePath),
              });
            }
          }
        } catch {
          // Directory might not exist
        }
      }

      // Apply limit
      const limit = filter?.limit || memories.length;
      return memories.slice(0, limit);
    },

    async loadCore() {
      const typeDir = join(config.baseDir, getTypeDir("core"));
      const memories: Memory[] = [];

      try {
        const files = await readdir(typeDir);
        for (const file of files) {
          if (file.endsWith(".md")) {
            const filePath = join(typeDir, file);
            const memory = await readMemoryFile(filePath);
            memories.push({
              ...memory,
              filePath: relative(config.baseDir, filePath),
            });
          }
        }
      } catch {
        // Directory might not exist, return empty array
        return [];
      }

      return memories;
    },
  };
}
