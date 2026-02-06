import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import { findProjectRoot } from "../../src/shared/config.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

// -- findProjectRoot ----------------------------------------------------------

describe("findProjectRoot", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test("finds project root from .git directory", () => {
    mkdirSync(join(tempDir, "git-project", ".git"), { recursive: true });
    const result = findProjectRoot(join(tempDir, "git-project"));
    expect(result).toBe(join(tempDir, "git-project", ".agent-memory"));
  });

  test("finds project root from nested subdirectory", () => {
    mkdirSync(join(tempDir, "nested-project", ".git"), { recursive: true });
    mkdirSync(join(tempDir, "nested-project", "src", "deep"), {
      recursive: true,
    });
    const result = findProjectRoot(
      join(tempDir, "nested-project", "src", "deep"),
    );
    expect(result).toBe(join(tempDir, "nested-project", ".agent-memory"));
  });

  test("finds project root from package.json", () => {
    mkdirSync(join(tempDir, "pkg-project"), { recursive: true });
    writeFileSync(
      join(tempDir, "pkg-project", "package.json"),
      '{"name":"test"}',
    );
    const result = findProjectRoot(join(tempDir, "pkg-project"));
    expect(result).toBe(join(tempDir, "pkg-project", ".agent-memory"));
  });

  test("falls back to cwd when no project markers found", () => {
    const isolated = join(tempDir, "no-markers", "deep", "dir");
    mkdirSync(isolated, { recursive: true });
    const result = findProjectRoot(isolated);
    // Should end with .agent-memory
    expect(result.endsWith(".agent-memory")).toBe(true);
  });
});

// -- .gitignore management ----------------------------------------------------

describe("ensureGitignore", () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await createTempDir();
  });

  afterAll(async () => {
    await cleanupTempDir(projectDir);
  });

  test("creates .gitignore with .agent-memory/ when none exists", async () => {
    const dir = join(projectDir, "new-gitignore");
    mkdirSync(join(dir, ".git"), { recursive: true });
    const memoryDir = join(dir, ".agent-memory");

    const system = createMemorySystem({
      baseDir: memoryDir,
      sqlitePath: join(memoryDir, ".index", "search.sqlite"),
    });
    await system.start();

    const gitignore = readFileSync(join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".agent-memory/");

    system.searchIndex.close();
  });

  test("appends to existing .gitignore without duplicating", async () => {
    const dir = join(projectDir, "existing-gitignore");
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n.env\n");
    const memoryDir = join(dir, ".agent-memory");

    const system = createMemorySystem({
      baseDir: memoryDir,
      sqlitePath: join(memoryDir, ".index", "search.sqlite"),
    });
    await system.start();

    const gitignore = readFileSync(join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain(".agent-memory/");

    // Start again — should not duplicate
    const system2 = createMemorySystem({
      baseDir: memoryDir,
      sqlitePath: join(memoryDir, ".index", "search.sqlite"),
    });
    await system2.start();

    const gitignore2 = readFileSync(join(dir, ".gitignore"), "utf-8");
    const matches = gitignore2.match(/\.agent-memory\//g);
    expect(matches?.length).toBe(1);

    system2.searchIndex.close();
  });

  test("does nothing when no .git directory exists", async () => {
    const dir = join(projectDir, "no-git");
    mkdirSync(dir, { recursive: true });
    const memoryDir = join(dir, ".agent-memory");

    const system = createMemorySystem({
      baseDir: memoryDir,
      sqlitePath: join(memoryDir, ".index", "search.sqlite"),
    });
    await system.start();

    expect(existsSync(join(dir, ".gitignore"))).toBe(false);

    system.searchIndex.close();
  });
});

// -- Dual-store search --------------------------------------------------------

describe("Dual-store", () => {
  let projectDir: string;
  let globalDir: string;
  let system: MemorySystem;

  beforeAll(async () => {
    projectDir = await createTempDir();
    globalDir = await createTempDir();

    const projectMemory = join(projectDir, ".agent-memory");
    const globalMemory = join(globalDir, ".agent-memory");

    system = createMemorySystem({
      baseDir: projectMemory,
      sqlitePath: join(projectMemory, ".index", "search.sqlite"),
      globalDir: globalMemory,
      globalSqlitePath: join(globalMemory, ".index", "search.sqlite"),
    });
    await system.start();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    try {
      await system.stop();
    } catch {
      // may fail
    }
    await cleanupTempDir(projectDir);
    await cleanupTempDir(globalDir);
  }, TEST_TIMEOUT);

  test("exposes global store modules when globalDir configured", () => {
    expect(system.globalStore).toBeDefined();
    expect(system.globalSearchIndex).toBeDefined();
    expect(system.globalGit).toBeDefined();
  });

  test(
    "search merges project and global results with storeSource",
    async () => {
      // Index a memory into the project store
      const projectMemory = await system.store.create({
        metadata: {
          title: "Project Pattern",
          type: "semantic",
          tags: ["architecture"],
          importance: "high",
          source: "test",
        },
        content: "This project uses a hexagonal architecture pattern.",
        filePath: "semantic/project-arch.md",
      });
      const projectEmbed = await system.embedding.embed(projectMemory.content);
      await system.searchIndex.index(
        Object.assign({}, projectMemory, { embedding: projectEmbed.vector }),
      );

      // Index a memory into the global store
      const globalMemory = await system.globalStore!.create({
        metadata: {
          title: "Global Preference",
          type: "semantic",
          tags: ["preference"],
          importance: "high",
          source: "test",
        },
        content:
          "General preference: always use hexagonal architecture for new services.",
        filePath: "semantic/global-pref.md",
      });
      const globalEmbed = await system.embedding.embed(globalMemory.content);
      await system.globalSearchIndex!.index(
        Object.assign({}, globalMemory, { embedding: globalEmbed.vector }),
      );

      // Search should find both
      const results = await system.search({
        query: "hexagonal architecture",
        limit: 10,
        minScore: 0.0,
      });

      expect(results.totalFound).toBeGreaterThanOrEqual(2);

      const projectResult = results.results.find(
        (r) => r.storeSource === "project",
      );
      const globalResult = results.results.find(
        (r) => r.storeSource === "global",
      );
      expect(projectResult).toBeDefined();
      expect(globalResult).toBeDefined();
    },
    TEST_TIMEOUT,
  );

  test(
    "write operations go to project store by default",
    async () => {
      const noteResult = await system.note({
        content: "A project-specific note for testing write ops",
        type: "semantic",
        importance: "medium",
      });
      expect(noteResult.success).toBe(true);

      // Note should be a real memory file in the project store
      const memory = await system.store.read(noteResult.noteId);
      expect(memory.content).toBe(
        "A project-specific note for testing write ops",
      );
      expect(memory.metadata.type).toBe("semantic");

      // Note should be searchable
      const results = await system.search({
        query: "testing write ops",
        limit: 1,
        minScore: 0.0,
      });
      expect(results.totalFound).toBeGreaterThanOrEqual(1);
      expect(results.results[0]?.storeSource).toBe("project");
    },
    TEST_TIMEOUT,
  );
});
