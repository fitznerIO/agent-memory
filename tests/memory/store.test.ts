import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createMemoryStore } from "../../src/memory/store.ts";
import { parseMarkdown, serializeMarkdown } from "../../src/memory/parser.ts";
import { InvalidMemoryTypeError, MemoryNotFoundError, PathTraversalError } from "../../src/shared/errors.ts";
import { createTempDir, cleanupTempDir } from "../helpers/fixtures.ts";
import type { MemoryConfig } from "../../src/shared/config.ts";

describe("MemoryStore", () => {
  let tempDir: string;
  let config: MemoryConfig;

  beforeAll(async () => {
    tempDir = await createTempDir();
    config = {
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
      embeddingModel: "test",
      embeddingDimensions: 384,
      hybridDefaults: { limit: 5, minScore: 0.3, weightFts: 0.3, weightVector: 0.5, weightRecency: 0.2, rrfK: 60 },
      maxCoreTokens: 4000,
    };
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe("create", () => {
    test("creates a memory file with correct frontmatter", async () => {
      const store = createMemoryStore(config);
      const memory = await store.create({
        metadata: {
          title: "Test Memory",
          type: "semantic",
          tags: ["test"],
          importance: "high",
          source: "test-source",
        },
        content: "This is test content",
        filePath: "semantic/test.md",
      });

      expect(memory.metadata.id).toBeDefined();
      expect(memory.metadata.title).toBe("Test Memory");
      expect(memory.metadata.type).toBe("semantic");
      expect(memory.metadata.createdAt).toBeDefined();
      expect(memory.metadata.updatedAt).toBeDefined();
      expect(memory.metadata.lastAccessedAt).toBeDefined();
      expect(memory.content).toBe("This is test content");

      // Verify file was actually written
      const readBack = await store.read(memory.metadata.id);
      expect(readBack.metadata.title).toBe("Test Memory");
      expect(readBack.content).toBe("This is test content");
    });

    test("generates a unique id for new memories", async () => {
      const store = createMemoryStore(config);
      const memory1 = await store.create({
        metadata: {
          title: "Memory 1",
          type: "core",
          tags: [],
          importance: "medium",
          source: "test",
        },
        content: "Content 1",
        filePath: "core/test1.md",
      });

      const memory2 = await store.create({
        metadata: {
          title: "Memory 2",
          type: "core",
          tags: [],
          importance: "medium",
          source: "test",
        },
        content: "Content 2",
        filePath: "core/test2.md",
      });

      expect(memory1.metadata.id).not.toBe(memory2.metadata.id);
    });

    test("rejects creation with invalid memory type", async () => {
      const store = createMemoryStore(config);
      try {
        await store.create({
          metadata: {
            title: "Bad Type",
            type: "invalid" as any,
            tags: [],
            importance: "low",
            source: "test",
          },
          content: "Content",
          filePath: "invalid/test.md",
        });
        expect(true).toBe(false); // Should have thrown
      } catch (e) {
        expect(e instanceof InvalidMemoryTypeError).toBe(true);
      }
    });
  });

  describe("read", () => {
    test("reads an existing memory by id", async () => {
      const store = createMemoryStore(config);
      const created = await store.create({
        metadata: {
          title: "Read Test",
          type: "episodic",
          tags: ["read", "test"],
          importance: "high",
          source: "test",
        },
        content: "Read test content",
        filePath: "episodic/read-test.md",
      });

      const read = await store.read(created.metadata.id);
      expect(read.metadata.id).toBe(created.metadata.id);
      expect(read.metadata.title).toBe("Read Test");
      expect(read.content).toBe("Read test content");
    });

    test("throws MemoryNotFoundError for unknown id", async () => {
      const store = createMemoryStore(config);
      try {
        await store.read("nonexistent-id-12345");
        expect(true).toBe(false); // Should have thrown
      } catch (e) {
        expect(e instanceof MemoryNotFoundError).toBe(true);
      }
    });
  });

  describe("readByPath", () => {
    test("reads memory by file path", async () => {
      const store = createMemoryStore(config);
      const created = await store.create({
        metadata: {
          title: "Path Read Test",
          type: "procedural",
          tags: ["path"],
          importance: "medium",
          source: "test",
        },
        content: "Path read test content",
        filePath: "procedural/path-read.md",
      });

      const read = await store.readByPath(created.filePath);
      expect(read.metadata.id).toBe(created.metadata.id);
      expect(read.metadata.title).toBe("Path Read Test");
    });

    test("throws PathTraversalError for paths outside baseDir", async () => {
      const store = createMemoryStore(config);
      try {
        await store.readByPath("../../../etc/passwd");
        expect(true).toBe(false); // Should have thrown
      } catch (e) {
        expect(e instanceof PathTraversalError).toBe(true);
      }
    });
  });

  describe("update", () => {
    test("updates content and bumps updatedAt timestamp", async () => {
      const store = createMemoryStore(config);
      const created = await store.create({
        metadata: {
          title: "Update Test",
          type: "semantic",
          tags: ["update"],
          importance: "low",
          source: "test",
        },
        content: "Original content",
        filePath: "semantic/update-test.md",
      });

      const originalUpdatedAt = created.metadata.updatedAt;

      // Wait a bit to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await store.update(created.metadata.id, "Updated content");
      expect(updated.content).toBe("Updated content");
      expect(updated.metadata.updatedAt).toBeGreaterThan(originalUpdatedAt);
      expect(updated.metadata.id).toBe(created.metadata.id); // ID unchanged
    });

    test("throws MemoryNotFoundError for unknown id", async () => {
      const store = createMemoryStore(config);
      try {
        await store.update("nonexistent-id-98765", "New content");
        expect(true).toBe(false); // Should have thrown
      } catch (e) {
        expect(e instanceof MemoryNotFoundError).toBe(true);
      }
    });
  });

  describe("delete", () => {
    test("removes memory file from disk", async () => {
      const store = createMemoryStore(config);
      const created = await store.create({
        metadata: {
          title: "Delete Test",
          type: "core",
          tags: ["delete"],
          importance: "medium",
          source: "test",
        },
        content: "Delete me",
        filePath: "core/delete-test.md",
      });

      await store.delete(created.metadata.id);

      // Try to read it back - should throw
      try {
        await store.read(created.metadata.id);
        expect(true).toBe(false); // Should have thrown
      } catch (e) {
        expect(e instanceof MemoryNotFoundError).toBe(true);
      }
    });

    test("throws MemoryNotFoundError for unknown id", async () => {
      const store = createMemoryStore(config);
      try {
        await store.delete("nonexistent-delete-id");
        expect(true).toBe(false); // Should have thrown
      } catch (e) {
        expect(e instanceof MemoryNotFoundError).toBe(true);
      }
    });
  });

  // forget deletes the file it checked, so it needs "this path" and "every file with this id"
  // instead of "the first file with this id" (#24). Own directory, so list() below is unaffected.
  describe("deleteByPath and findPathsById", () => {
    let dir: string;
    let outside: string;
    const entry = (id: string, body: string) =>
      `---\nid: ${id}\ntitle: ${body}\ntype: decision\n---\n\n${body}\n`;

    beforeAll(async () => {
      dir = await createTempDir();
      outside = await createTempDir();
      mkdirSync(join(dir, "semantic", "decisions"), { recursive: true });
      mkdirSync(join(dir, "core"), { recursive: true });
      mkdirSync(join(dir, "episodic"), { recursive: true });
      writeFileSync(join(dir, "semantic/decisions/dec-001-first.md"), entry("dec-001", "First"));
      writeFileSync(join(dir, "semantic/decisions/dec-001-second.md"), entry("dec-001", "Second"));
      writeFileSync(join(dir, "semantic/decisions/dec-001-other.md"), entry("dec-002", "Other"));
      const uuid = "0f0e0d0c-0b0a-4908-8706-050403020100";
      writeFileSync(join(dir, "core", `${uuid}.md`), entry(uuid, "Core copy"));
      writeFileSync(join(dir, "episodic", `${uuid}-copy.md`), entry(uuid, "Episodic copy"));
      // A v2-lite twin filed in the wrong type directory.
      mkdirSync(join(dir, "episodic", "incidents"), { recursive: true });
      writeFileSync(join(dir, "semantic/decisions/dec-007-right.md"), entry("dec-007", "Right"));
      writeFileSync(join(dir, "episodic/incidents/dec-007-misfiled.md"), entry("dec-007", "Misfiled"));
      writeFileSync(join(outside, "keep.md"), entry("dec-009", "Outside"));
    });

    afterAll(async () => {
      await cleanupTempDir(dir);
      await cleanupTempDir(outside);
    });

    test("findPathsById returns every file whose frontmatter has the id", async () => {
      const store = createMemoryStore({ ...config, baseDir: dir });
      expect((await store.findPathsById("dec-001")).sort()).toEqual([
        "semantic/decisions/dec-001-first.md",
        "semantic/decisions/dec-001-second.md",
      ]);
      expect(
        (await store.findPathsById("0f0e0d0c-0b0a-4908-8706-050403020100")).sort(),
      ).toEqual([
        "core/0f0e0d0c-0b0a-4908-8706-050403020100.md",
        "episodic/0f0e0d0c-0b0a-4908-8706-050403020100-copy.md",
      ]);
      expect(await store.findPathsById("dec-003")).toEqual([]);
      expect((await store.findPathsById("dec-007")).sort()).toEqual([
        "episodic/incidents/dec-007-misfiled.md",
        "semantic/decisions/dec-007-right.md",
      ]);
    });

    test("deleteByPath refuses a sibling directory whose name starts with the store's", async () => {
      const parent = await createTempDir();
      const base = join(parent, "store");
      mkdirSync(base);
      mkdirSync(join(parent, "store-secret"));
      writeFileSync(join(parent, "store-secret", "keep.md"), entry("dec-009", "Secret"));
      const store = createMemoryStore({ ...config, baseDir: base });
      try {
        await store.deleteByPath("../store-secret/keep.md");
        expect(true).toBe(false); // Should have thrown
      } catch (e) {
        expect(e instanceof PathTraversalError).toBe(true);
      }
      expect(existsSync(join(parent, "store-secret", "keep.md"))).toBe(true);
      await cleanupTempDir(parent);
    });

    test("deleteByPath deletes exactly that file", async () => {
      const store = createMemoryStore({ ...config, baseDir: dir });
      await store.deleteByPath("semantic/decisions/dec-001-second.md");
      expect(await store.findPathsById("dec-001")).toEqual([
        "semantic/decisions/dec-001-first.md",
      ]);
    });

    test("deleteByPath refuses a path outside the store and deletes nothing there", async () => {
      const store = createMemoryStore({ ...config, baseDir: dir });
      try {
        await store.deleteByPath(relative(dir, join(outside, "keep.md")));
        expect(true).toBe(false); // Should have thrown
      } catch (e) {
        expect(e instanceof PathTraversalError).toBe(true);
      }
      expect(existsSync(join(outside, "keep.md"))).toBe(true);
    });

    test("deleteByPath throws MemoryNotFoundError for a missing file", async () => {
      const store = createMemoryStore({ ...config, baseDir: dir });
      try {
        await store.deleteByPath("semantic/decisions/dec-004-missing.md");
        expect(true).toBe(false); // Should have thrown
      } catch (e) {
        expect(e instanceof MemoryNotFoundError).toBe(true);
      }
    });
  });

  describe("list", () => {
    test("returns all memories without filter", async () => {
      const store = createMemoryStore(config);
      const mem1 = await store.create({
        metadata: {
          title: "List 1",
          type: "semantic",
          tags: ["list"],
          importance: "high",
          source: "test",
        },
        content: "List content 1",
        filePath: "semantic/list1.md",
      });

      const mem2 = await store.create({
        metadata: {
          title: "List 2",
          type: "episodic",
          tags: ["list"],
          importance: "low",
          source: "test",
        },
        content: "List content 2",
        filePath: "episodic/list2.md",
      });

      const all = await store.list();
      const ids = all.map((m) => m.metadata.id);
      expect(ids).toContain(mem1.metadata.id);
      expect(ids).toContain(mem2.metadata.id);
    });

    test("filters by memory type", async () => {
      const store = createMemoryStore(config);
      await store.create({
        metadata: {
          title: "Type Filter 1",
          type: "semantic",
          tags: ["filter"],
          importance: "medium",
          source: "test",
        },
        content: "Semantic content",
        filePath: "semantic/type-filter1.md",
      });

      await store.create({
        metadata: {
          title: "Type Filter 2",
          type: "procedural",
          tags: ["filter"],
          importance: "medium",
          source: "test",
        },
        content: "Procedural content",
        filePath: "procedural/type-filter2.md",
      });

      const semanticOnly = await store.list({ type: "semantic" });
      for (const mem of semanticOnly) {
        expect(mem.metadata.type).toBe("semantic");
      }
    });

    test("filters by tags", async () => {
      const store = createMemoryStore(config);
      await store.create({
        metadata: {
          title: "Tagged 1",
          type: "core",
          tags: ["special", "marked"],
          importance: "high",
          source: "test",
        },
        content: "Tagged content 1",
        filePath: "core/tagged1.md",
      });

      await store.create({
        metadata: {
          title: "Tagged 2",
          type: "core",
          tags: ["other"],
          importance: "high",
          source: "test",
        },
        content: "Tagged content 2",
        filePath: "core/tagged2.md",
      });

      const special = await store.list({ tags: ["special"] });
      expect(special.length).toBeGreaterThan(0);
      for (const mem of special) {
        expect(mem.metadata.tags).toContain("special");
      }
    });

    test("respects limit parameter", async () => {
      const store = createMemoryStore(config);
      for (let i = 0; i < 5; i++) {
        await store.create({
          metadata: {
            title: `Limit Test ${i}`,
            type: "episodic",
            tags: ["limit"],
            importance: "medium",
            source: "test",
          },
          content: `Limit content ${i}`,
          filePath: `episodic/limit${i}.md`,
        });
      }

      const limited = await store.list({ limit: 2 });
      expect(limited.length).toBeLessThanOrEqual(2);
    });
  });

  describe("loadCore", () => {
    test("loads all files from core/ directory", async () => {
      const store = createMemoryStore(config);
      const core1 = await store.create({
        metadata: {
          title: "Core 1",
          type: "core",
          tags: ["core"],
          importance: "high",
          source: "test",
        },
        content: "Core content 1",
        filePath: "core/core1.md",
      });

      const core2 = await store.create({
        metadata: {
          title: "Core 2",
          type: "core",
          tags: ["core"],
          importance: "high",
          source: "test",
        },
        content: "Core content 2",
        filePath: "core/core2.md",
      });

      const cores = await store.loadCore();
      const coreIds = cores.map((m) => m.metadata.id);
      expect(coreIds).toContain(core1.metadata.id);
      expect(coreIds).toContain(core2.metadata.id);

      for (const core of cores) {
        expect(core.metadata.type).toBe("core");
      }
    });

    test("returns empty array when core/ is empty", async () => {
      const emptyConfig: MemoryConfig = {
        baseDir: await createTempDir(),
        sqlitePath: join(tempDir, ".index", "search2.sqlite"),
        embeddingModel: "test",
        embeddingDimensions: 384,
        hybridDefaults: { limit: 5, minScore: 0.3, weightFts: 0.3, weightVector: 0.5, weightRecency: 0.2, rrfK: 60 },
        maxCoreTokens: 4000,
      };

      try {
        const store = createMemoryStore(emptyConfig);
        const cores = await store.loadCore();
        expect(cores.length).toBe(0);
      } finally {
        await cleanupTempDir(emptyConfig.baseDir);
      }
    });
  });

  describe("findMemoryById fast-path (v2-lite)", () => {
    test("finds v2-lite file by ID via fast-path (no full scan)", async () => {
      const v2Dir = await createTempDir();
      const v2Config: MemoryConfig = {
        baseDir: v2Dir,
        sqlitePath: join(v2Dir, ".index", "search.sqlite"),
        embeddingModel: "test",
        embeddingDimensions: 384,
        hybridDefaults: { limit: 5, minScore: 0.3, weightFts: 0.3, weightVector: 0.5, weightRecency: 0.2, rrfK: 60 },
        maxCoreTokens: 4000,
      };

      try {
        // Create a v2-lite file in the expected subdirectory
        const notesDir = join(v2Dir, "semantic", "notes");
        mkdirSync(notesDir, { recursive: true });

        const frontmatter = {
          id: "note-001",
          title: "Test Note",
          type: "note",
          tags: ["test"],
          created: "2026-02-09",
          updated: "2026-02-09",
          connections: [],
        };
        const content = serializeMarkdown({ frontmatter, body: "Hello from v2-lite" });
        writeFileSync(join(notesDir, "note-001-test-note.md"), content);

        const store = createMemoryStore(v2Config);
        const memory = await store.read("note-001");

        expect((memory.metadata as unknown as Record<string, unknown>).id).toBe("note-001");
        expect(memory.content).toBe("Hello from v2-lite");
      } finally {
        await cleanupTempDir(v2Dir);
      }
    });

    test("returns MemoryNotFoundError for unknown v2-lite ID", async () => {
      const store = createMemoryStore(config);
      try {
        await store.read("dec-999");
        expect(true).toBe(false);
      } catch (e) {
        expect(e instanceof MemoryNotFoundError).toBe(true);
      }
    });
  });

  describe("update format preservation (v2-lite)", () => {
    test("preserves v2-lite frontmatter format on update", async () => {
      const v2Dir = await createTempDir();
      const v2Config: MemoryConfig = {
        baseDir: v2Dir,
        sqlitePath: join(v2Dir, ".index", "search.sqlite"),
        embeddingModel: "test",
        embeddingDimensions: 384,
        hybridDefaults: { limit: 5, minScore: 0.3, weightFts: 0.3, weightVector: 0.5, weightRecency: 0.2, rrfK: 60 },
        maxCoreTokens: 4000,
      };

      try {
        // Create a v2-lite file
        const entitiesDir = join(v2Dir, "semantic", "entities");
        mkdirSync(entitiesDir, { recursive: true });

        const frontmatter = {
          id: "entity-001",
          title: "Test Entity",
          type: "entity",
          tags: ["test"],
          created: "2026-01-15",
          updated: "2026-01-15",
          connections: [],
        };
        const content = serializeMarkdown({ frontmatter, body: "Original content" });
        writeFileSync(join(entitiesDir, "entity-001-test-entity.md"), content);

        const store = createMemoryStore(v2Config);
        const updated = await store.update("entity-001", "Updated content");

        expect(updated.content).toBe("Updated content");

        // Read back raw file and verify frontmatter format is preserved
        const rawFile = await Bun.file(join(entitiesDir, "entity-001-test-entity.md")).text();
        const doc = parseMarkdown(rawFile);

        // Should still have v2-lite fields
        expect(doc.frontmatter.updated).toBeDefined();
        expect(typeof doc.frontmatter.updated).toBe("string");
        expect(doc.frontmatter.created).toBe("2026-01-15");

        // Should NOT have v1 updatedAt field
        expect(doc.frontmatter.updatedAt).toBeUndefined();
      } finally {
        await cleanupTempDir(v2Dir);
      }
    });

    test("preserves v1 frontmatter format on update", async () => {
      const store = createMemoryStore(config);
      const created = await store.create({
        metadata: {
          title: "V1 Update Test",
          type: "semantic",
          tags: ["v1"],
          importance: "medium",
          source: "test",
        },
        content: "V1 original content",
        filePath: "semantic/v1-update.md",
      });

      const updated = await store.update(created.metadata.id, "V1 updated content");
      expect(updated.content).toBe("V1 updated content");

      // v1 files have updatedAt as number — verify it was updated
      const fm = updated.metadata as unknown as Record<string, unknown>;
      expect(typeof fm.updatedAt).toBe("number");
      expect(fm.updated).toBeUndefined();
    });
  });
});
