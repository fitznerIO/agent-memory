import { describe, test } from "bun:test";

describe("MemoryStore", () => {
  describe("create", () => {
    test.todo("creates a memory file with correct frontmatter", () => {});
    test.todo("generates a unique id for new memories", () => {});
    test.todo("rejects creation with invalid memory type", () => {});
  });

  describe("read", () => {
    test.todo("reads an existing memory by id", () => {});
    test.todo("throws MemoryNotFoundError for unknown id", () => {});
  });

  describe("readByPath", () => {
    test.todo("reads memory by file path", () => {});
    test.todo("throws PathTraversalError for paths outside baseDir", () => {});
  });

  describe("update", () => {
    test.todo("updates content and bumps updatedAt timestamp", () => {});
    test.todo("throws MemoryNotFoundError for unknown id", () => {});
  });

  describe("delete", () => {
    test.todo("removes memory file from disk", () => {});
    test.todo("throws MemoryNotFoundError for unknown id", () => {});
  });

  describe("list", () => {
    test.todo("returns all memories without filter", () => {});
    test.todo("filters by memory type", () => {});
    test.todo("filters by tags", () => {});
    test.todo("respects limit parameter", () => {});
  });

  describe("loadCore", () => {
    test.todo("loads all files from core/ directory", () => {});
    test.todo("returns empty array when core/ is empty", () => {});
  });
});
