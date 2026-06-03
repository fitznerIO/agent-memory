import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildExtensionDispatch } from "../../src/extensions/tool-registry.ts";
import { createMemorySystem } from "../../src/index.ts";
import type { Extension, MemorySystem } from "../../src/index.ts";
import { unregisterKnowledgeType } from "../../src/shared/knowledge-types.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

/**
 * A consumer-defined extension (not in AVAILABLE_EXTENSIONS) — the v0.3.0 use
 * case: registered purely via createMemorySystem(cfg, { extensions: [...] }).
 * Uses a unique type/idPrefix (`test`/`tst`) so the process-global knowledge-type
 * registry doesn't collide across runs; afterAll unregisters it.
 */
function makeTestExtension(): Extension {
  return {
    name: "test",
    version: "1.0.0",
    description: "External test extension",
    knowledgeTypes: [
      { type: "test", dir: "semantic/tests", v1Type: "semantic", idPrefix: "tst" },
    ],
    schema: {
      table: "test_meta",
      columns: [
        { name: "label", type: "TEXT", notNull: true },
        { name: "score", type: "REAL", default: "0" },
      ],
    },
    tools: [
      {
        name: "test_add",
        description: "Create a test entry + test_meta row",
        inputSchema: {
          type: "object",
          properties: { label: { type: "string" } },
          required: ["label"],
        },
        async handler(input, ctx) {
          const { label } = input as { label: string };
          const id = await ctx.memory.store({
            title: label,
            type: "test",
            content: `Test: ${label}`,
            tags: ["test"],
          });
          ctx.db.run(
            "INSERT INTO test_meta (entry_id, label, score) VALUES (?, ?, ?)",
            [id, label, 1],
          );
          await ctx.memory.setExtensionData(id, "test", { label, score: 1 });
          return { id };
        },
      },
    ],
  };
}

describe("External (consumer-defined) extension via createMemorySystem opts (v0.3.0)", () => {
  let tempDir: string;
  let sqlitePath: string;
  let system: MemorySystem;

  beforeAll(async () => {
    tempDir = await createTempDir();
    sqlitePath = join(tempDir, ".index", "search.sqlite");
    system = createMemorySystem(
      { baseDir: tempDir, sqlitePath, globalDir: undefined },
      { extensions: [makeTestExtension()] },
    );
    await system.start();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    try {
      await system.stop();
    } catch {
      // already stopped
    }
    unregisterKnowledgeType("test");
    await cleanupTempDir(tempDir);
  }, TEST_TIMEOUT);

  test("external extension is registered, installable, creates its table", async () => {
    const list = system.listExtensions();
    expect(list.find((e) => e.name === "test")?.installed).toBe(false);

    await system.installExtensionByName("test");

    const status = system.extensionStatus("test");
    expect(status?.installed).toBe(true);
    expect(status?.table).toBe("test_meta");
    expect(status?.tools).toContain("test_add");

    const db = system.searchIndex.extensionDb();
    expect(
      db.get("SELECT name FROM sqlite_master WHERE name='test_meta'"),
    ).toBeDefined();
  });

  test("tool is dispatchable in-process right after install (no restart)", async () => {
    // install in this test's beforeAll-built system already ran above; the tool
    // must be live in loadedExtensions without a second start().
    const dispatch = buildExtensionDispatch(system.getLoadedExtensions());
    expect(dispatch.has("test_add")).toBe(true);
    const res = (await dispatch.get("test_add")?.({ label: "inproc" })) as {
      id: string;
    };
    expect(res.id.startsWith("tst-")).toBe(true);
  });

  test("tool runs after restart: entry + meta row + frontmatter + sequential id", async () => {
    await system.stop();
    system = createMemorySystem(
      { baseDir: tempDir, sqlitePath, globalDir: undefined },
      { extensions: [makeTestExtension()] },
    );
    await system.start();

    const dispatch = buildExtensionDispatch(system.getLoadedExtensions());
    const result = (await dispatch.get("test_add")?.({ label: "hello" })) as {
      id: string;
    };
    expect(result.id.startsWith("tst-")).toBe(true);

    const db = system.searchIndex.extensionDb();
    expect(
      db.get<{ label: string }>(
        "SELECT label FROM test_meta WHERE entry_id = ?",
        [result.id],
      )?.label,
    ).toBe("hello");
    expect(
      await system.getExtensionData<{ label: string; score: number }>(
        result.id,
        "test",
      ),
    ).toEqual({ label: "hello", score: 1 });
  });

  test("uninstall drops table + cleans ext.test frontmatter", async () => {
    const db = system.searchIndex.extensionDb();
    const idRow = db.get<{ entry_id: string }>(
      "SELECT entry_id FROM test_meta LIMIT 1",
    );
    const id = idRow?.entry_id as string;

    await system.uninstallExtensionByName("test");

    expect(
      db.get("SELECT name FROM sqlite_master WHERE name='test_meta'"),
    ).toBeUndefined();
    expect(await system.getExtensionData(id, "test")).toBeNull();
  });

  test("name collision with a built-in extension throws", () => {
    expect(() =>
      createMemorySystem(
        { baseDir: tempDir, sqlitePath, globalDir: undefined },
        {
          extensions: [
            { ...makeTestExtension(), name: "bookmark", knowledgeTypes: [] },
          ],
        },
      ),
    ).toThrow(/already registered/);
  });

  test("backward compatible: createMemorySystem without opts still works", async () => {
    const dir = await createTempDir();
    const sys = createMemorySystem({
      baseDir: dir,
      sqlitePath: join(dir, ".index", "search.sqlite"),
      globalDir: undefined,
    });
    await sys.start();
    // built-in bookmark still available; no external extensions present
    expect(sys.listExtensions().some((e) => e.name === "bookmark")).toBe(true);
    expect(sys.listExtensions().some((e) => e.name === "test")).toBe(false);
    await sys.stop();
    await cleanupTempDir(dir);
  }, TEST_TIMEOUT);

  test("multiple external extensions coexist with the built-in (fioOS scenario)", async () => {
    const dir = await createTempDir();
    const mk = (n: string, p: string): Extension => ({
      name: n,
      version: "1.0.0",
      description: `${n} ext`,
      knowledgeTypes: [
        { type: n, dir: `semantic/${n}s`, v1Type: "semantic", idPrefix: p },
      ],
      schema: { table: `${n}_meta`, columns: [{ name: "v", type: "TEXT" }] },
      tools: [],
    });
    const sys = createMemorySystem(
      { baseDir: dir, sqlitePath: join(dir, ".index", "search.sqlite"), globalDir: undefined },
      { extensions: [mk("lead", "lead"), mk("campaign", "camp")] },
    );
    await sys.start();
    try {
      const names = sys.listExtensions().map((e) => e.name);
      // both externals AND the built-in are present together
      expect(names).toContain("lead");
      expect(names).toContain("campaign");
      expect(names).toContain("bookmark");

      await sys.installExtensionByName("lead");
      await sys.installExtensionByName("campaign");
      const db = sys.searchIndex.extensionDb();
      expect(db.get("SELECT name FROM sqlite_master WHERE name='lead_meta'")).toBeDefined();
      expect(db.get("SELECT name FROM sqlite_master WHERE name='campaign_meta'")).toBeDefined();
    } finally {
      await sys.stop();
      unregisterKnowledgeType("lead");
      unregisterKnowledgeType("campaign");
      await cleanupTempDir(dir);
    }
  }, TEST_TIMEOUT);
});
