import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

describe("Extension data API (C3) + extensionDb accessor (C4)", () => {
  let tempDir: string;
  let system: MemorySystem;

  beforeAll(async () => {
    tempDir = await createTempDir();
    system = createMemorySystem({
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
      // No global store — keep the test isolated to the project store (C6).
      globalDir: undefined,
    });
    await system.start();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    try {
      await system.stop();
    } catch {
      // already stopped
    }
    await cleanupTempDir(tempDir);
  }, TEST_TIMEOUT);

  test(
    "setExtensionData / getExtensionData round-trip preserves the ext.<name> block",
    async () => {
      const { id } = await system.memoryStore({
        title: "Hetzner",
        type: "entity",
        content: "Provider entry",
        tags: ["billing/provider/hetzner"],
      });

      const data = { provider: "Hetzner", amount: 5.29, status: "matched" };
      await system.setExtensionData(id, "billing", data);

      const read = await system.getExtensionData<typeof data>(id, "billing");
      expect(read).toEqual(data);
    },
    TEST_TIMEOUT,
  );

  test(
    "getExtensionData returns null when no ext block exists",
    async () => {
      const { id } = await system.memoryStore({
        title: "Plain entry",
        type: "note",
        content: "no extension data here",
      });
      const read = await system.getExtensionData(id, "billing");
      expect(read).toBeNull();
    },
    TEST_TIMEOUT,
  );

  test(
    "setExtensionData does not disturb core frontmatter or other ext namespaces",
    async () => {
      const { id, file_path } = await system.memoryStore({
        title: "Multi-ext entry",
        type: "entity",
        content: "distinctive body text",
        tags: ["x/y"],
      });

      await system.setExtensionData(id, "billing", { amount: 1 });
      await system.setExtensionData(id, "ideaforge", { status: "active" });

      expect(
        await system.getExtensionData<{ amount: number }>(id, "billing"),
      ).toEqual({ amount: 1 });
      expect(
        await system.getExtensionData<{ status: string }>(id, "ideaforge"),
      ).toEqual({ status: "active" });

      // Core body + frontmatter must survive the ext writes untouched.
      const back = await system.read({ path: file_path });
      expect(back.content).toContain("distinctive body text");
    },
    TEST_TIMEOUT,
  );

  test("extensionDb() exposes a scoped run/get/all over the project connection", () => {
    const db = system.searchIndex.extensionDb();
    db.run(
      "CREATE TABLE IF NOT EXISTS demo_meta (entry_id TEXT PRIMARY KEY, val TEXT)",
    );
    db.run("INSERT INTO demo_meta (entry_id, val) VALUES (?, ?)", [
      "e1",
      "hello",
    ]);
    const row = db.get<{ val: string }>(
      "SELECT val FROM demo_meta WHERE entry_id = ?",
      ["e1"],
    );
    expect(row?.val).toBe("hello");
    const all = db.all<{ entry_id: string }>("SELECT entry_id FROM demo_meta");
    expect(all.map((r) => r.entry_id)).toContain("e1");
    db.run("DROP TABLE demo_meta");
  });

  test("extensionDb foreign_keys pragma is ON (CASCADE precondition, C4/§5.2)", () => {
    const db = system.searchIndex.extensionDb();
    const row = db.get<{ foreign_keys: number }>("PRAGMA foreign_keys");
    expect(row?.foreign_keys).toBe(1);
  });

  test("extensions registry table is ensured at startup (Task 003, §5.1)", () => {
    const db = system.searchIndex.extensionDb();
    const row = db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='extensions'",
    );
    expect(row?.name).toBe("extensions");
  });
});
