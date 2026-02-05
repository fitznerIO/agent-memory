import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createGitManager } from "../../src/git/manager.ts";
import { createTempDir, cleanupTempDir } from "../helpers/fixtures.ts";
import type { MemoryConfig } from "../../src/shared/config.ts";

// Helper to ensure filesystem timestamp changes
// Git uses mtime to detect file changes - need to wait for mtime resolution
async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Most filesystems have 1-second mtime resolution
const MTIME_DELAY = 1010;

describe("GitManager", () => {
  let tempDir: string;
  let config: MemoryConfig;

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = {
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
      embeddingModel: "test-model",
      embeddingDimensions: 384,
      hybridDefaults: {
        limit: 5,
        minScore: 0.3,
        weightFts: 0.3,
        weightVector: 0.5,
        weightRecency: 0.2,
        rrfK: 60,
      },
      maxCoreTokens: 4000,
    };
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe("init", () => {
    test("initializes a new git repository", async () => {
      const manager = createGitManager(config);

      await manager.init();

      const initialized = await manager.isInitialized();
      expect(initialized).toBe(true);
    });

    test("no-ops when repository already exists", async () => {
      const manager = createGitManager(config);

      await manager.init();
      await manager.init(); // Should not throw

      const initialized = await manager.isInitialized();
      expect(initialized).toBe(true);
    });
  });

  describe("commit", () => {
    test("creates a commit with formatted message [type] message", async () => {
      const manager = createGitManager(config);
      await manager.init();

      // Create a test file
      const testFile = join(tempDir, "test.md");
      await Bun.write(testFile, "Test content");

      const hash = await manager.commit("Initial memory", "semantic");

      expect(hash).toBeDefined();
      expect(typeof hash).toBe("string");
      expect(hash.length).toBeGreaterThan(0);

      const log = await manager.log(1);
      expect(log.length).toBeGreaterThan(0);
      expect(log[0]!.message).toBe("[semantic] Initial memory");
    });

    test("stages all changed files before committing", async () => {
      const manager = createGitManager(config);
      await manager.init();

      // Create multiple test files
      await Bun.write(join(tempDir, "file1.md"), "Content 1");
      await Bun.write(join(tempDir, "file2.md"), "Content 2");
      await Bun.write(join(tempDir, "file3.md"), "Content 3");

      await manager.commit("Add multiple files", "episodic");

      const log = await manager.log(1);
      expect(log[0]!.filesChanged.length).toBe(3);
      expect(log[0]!.filesChanged).toContain("file1.md");
      expect(log[0]!.filesChanged).toContain("file2.md");
      expect(log[0]!.filesChanged).toContain("file3.md");
    });

    test("returns the commit hash", async () => {
      const manager = createGitManager(config);
      await manager.init();

      await Bun.write(join(tempDir, "test.md"), "Test");
      const hash = await manager.commit("Test commit", "procedural");

      expect(hash).toBeDefined();
      expect(typeof hash).toBe("string");
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
    });

    test("handles deleted files", async () => {
      const manager = createGitManager(config);
      await manager.init();

      // Create and commit a file
      const testFile = join(tempDir, "delete-me.md");
      await Bun.write(testFile, "To be deleted");
      await manager.commit("Add file to delete", "semantic");

      // Delete the file
      await Bun.write(testFile, ""); // Bun doesn't have unlink in std API, so use fs
      await import("node:fs/promises").then(fs => fs.unlink(testFile));

      // Commit the deletion
      const hash = await manager.commit("Remove file", "archive");
      expect(hash).toBeDefined();

      const log = await manager.log(1);
      expect(log[0]!.filesChanged).toContain("delete-me.md");
    });
  });

  describe("log", () => {
    test("returns commit history entries", async () => {
      const manager = createGitManager(config);
      await manager.init();

      // Create multiple commits
      await Bun.write(join(tempDir, "commit1.md"), "First");
      await manager.commit("First commit", "semantic");

      await Bun.write(join(tempDir, "commit2.md"), "Second");
      await manager.commit("Second commit", "episodic");

      const log = await manager.log();

      expect(log.length).toBe(2);
      expect(log[0]!.message).toBe("[episodic] Second commit");
      expect(log[1]!.message).toBe("[semantic] First commit");
      expect(log[0]!.hash).toBeDefined();
      expect(log[0]!.timestamp).toBeGreaterThan(0);
    });

    test("respects limit parameter", async () => {
      const manager = createGitManager(config);
      await manager.init();

      // Create multiple commits
      for (let i = 0; i < 5; i++) {
        await Bun.write(join(tempDir, `file${i}.md`), `Content ${i}`);
        await manager.commit(`Commit ${i}`, "semantic");
      }

      const log = await manager.log(3);
      expect(log.length).toBe(3);
    });

    test("includes filesChanged in each entry", async () => {
      const manager = createGitManager(config);
      await manager.init();

      await Bun.write(join(tempDir, "file1.md"), "Content");
      await Bun.write(join(tempDir, "file2.md"), "Content");
      await manager.commit("Add two files", "semantic");

      const log = await manager.log(1);
      expect(log[0]!.filesChanged).toContain("file1.md");
      expect(log[0]!.filesChanged).toContain("file2.md");
    });

    test("handles empty repository", async () => {
      const manager = createGitManager(config);
      await manager.init();

      const log = await manager.log();
      expect(log).toEqual([]);
    });
  });

  describe("diff", () => {
    test("returns diff of uncommitted changes", async () => {
      const manager = createGitManager(config);
      await manager.init();

      // Create initial commit
      await Bun.write(join(tempDir, "test.md"), "Original content");
      await manager.commit("Initial", "semantic");

      // Wait to ensure mtime changes
      await sleep(MTIME_DELAY);

      // Modify file
      await Bun.write(join(tempDir, "test.md"), "Modified content");

      const diff = await manager.diff();
      expect(diff).toContain("test.md");
      expect(diff).toContain("Original content");
      expect(diff).toContain("Modified content");
    });

    test("returns diff for a specific file", async () => {
      const manager = createGitManager(config);
      await manager.init();

      // Create multiple files
      await Bun.write(join(tempDir, "file1.md"), "Content 1");
      await Bun.write(join(tempDir, "file2.md"), "Content 2");
      await manager.commit("Initial", "semantic");

      // Wait to ensure mtime changes
      await sleep(MTIME_DELAY);

      // Modify both files
      await Bun.write(join(tempDir, "file1.md"), "Modified 1");
      await Bun.write(join(tempDir, "file2.md"), "Modified 2");

      const diff = await manager.diff("file1.md");
      expect(diff).toContain("file1.md");
      expect(diff).toContain("Modified 1");
      expect(diff).not.toContain("file2.md");
      expect(diff).not.toContain("Modified 2");
    });

    test("returns empty string for clean working tree", async () => {
      const manager = createGitManager(config);
      await manager.init();

      await Bun.write(join(tempDir, "test.md"), "Content");
      await manager.commit("Initial", "semantic");

      const diff = await manager.diff();
      expect(diff.trim()).toBe("");
    });

    test("shows new files in diff", async () => {
      const manager = createGitManager(config);
      await manager.init();

      await Bun.write(join(tempDir, "committed.md"), "Existing");
      await manager.commit("Initial", "semantic");

      await Bun.write(join(tempDir, "new.md"), "New file content");

      const diff = await manager.diff();
      expect(diff).toContain("new.md");
      expect(diff).toContain("new file");
      expect(diff).toContain("New file content");
    });
  });

  describe("getFileAtCommit", () => {
    test("retrieves file content at a specific commit hash", async () => {
      const manager = createGitManager(config);
      await manager.init();

      await Bun.write(join(tempDir, "test.md"), "Original content");
      const hash = await manager.commit("Initial", "semantic");

      // Modify file
      await Bun.write(join(tempDir, "test.md"), "Modified content");
      await manager.commit("Update", "semantic");

      const content = await manager.getFileAtCommit("test.md", hash);
      expect(content).toBe("Original content");
    });

    test("throws for non-existent file at commit", async () => {
      const manager = createGitManager(config);
      await manager.init();

      await Bun.write(join(tempDir, "test.md"), "Content");
      const hash = await manager.commit("Initial", "semantic");

      await expect(
        manager.getFileAtCommit("nonexistent.md", hash)
      ).rejects.toThrow();
    });

    test("retrieves content from multiple commits back", async () => {
      const manager = createGitManager(config);
      await manager.init();

      await Bun.write(join(tempDir, "test.md"), "Version 1");
      const hash1 = await manager.commit("v1", "semantic");

      await sleep(MTIME_DELAY);
      await Bun.write(join(tempDir, "test.md"), "Version 2");
      const hash2 = await manager.commit("v2", "semantic");

      await sleep(MTIME_DELAY);
      await Bun.write(join(tempDir, "test.md"), "Version 3");
      await manager.commit("v3", "semantic");

      const content1 = await manager.getFileAtCommit("test.md", hash1);
      const content2 = await manager.getFileAtCommit("test.md", hash2);

      expect(content1).toBe("Version 1");
      expect(content2).toBe("Version 2");
    });
  });

  describe("status", () => {
    test("reports staged, modified, and untracked files", async () => {
      const manager = createGitManager(config);
      await manager.init();

      // Create initial commit
      await Bun.write(join(tempDir, "committed.md"), "Original");
      await manager.commit("Initial", "semantic");

      // Wait to ensure mtime changes
      await sleep(MTIME_DELAY);

      // Create untracked file
      await Bun.write(join(tempDir, "untracked.md"), "New file");

      // Modify committed file
      await Bun.write(join(tempDir, "committed.md"), "Modified");

      const status = await manager.status();

      expect(status.untracked).toContain("untracked.md");
      expect(status.modified).toContain("committed.md");
    });

    test("returns empty arrays for clean working tree", async () => {
      const manager = createGitManager(config);
      await manager.init();

      await Bun.write(join(tempDir, "test.md"), "Content");
      await manager.commit("Initial", "semantic");

      const status = await manager.status();

      expect(status.staged).toEqual([]);
      expect(status.modified).toEqual([]);
      expect(status.untracked).toEqual([]);
    });

    test("handles multiple file states simultaneously", async () => {
      const manager = createGitManager(config);
      await manager.init();

      // Commit initial files
      await Bun.write(join(tempDir, "file1.md"), "Content 1");
      await Bun.write(join(tempDir, "file2.md"), "Content 2");
      await manager.commit("Initial", "semantic");

      // Create various states
      await Bun.write(join(tempDir, "file1.md"), "Modified 1");
      await Bun.write(join(tempDir, "new1.md"), "New 1");
      await Bun.write(join(tempDir, "new2.md"), "New 2");

      const status = await manager.status();

      expect(status.modified).toContain("file1.md");
      expect(status.untracked).toContain("new1.md");
      expect(status.untracked).toContain("new2.md");
      expect(status.modified).not.toContain("file2.md");
    });
  });

  describe("isInitialized", () => {
    test("returns true for initialized repo", async () => {
      const manager = createGitManager(config);

      await manager.init();
      const initialized = await manager.isInitialized();

      expect(initialized).toBe(true);
    });

    test("returns false for non-repo directory", async () => {
      const manager = createGitManager(config);

      const initialized = await manager.isInitialized();

      expect(initialized).toBe(false);
    });
  });
});
