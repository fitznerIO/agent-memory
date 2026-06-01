import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import {
  installExtension,
  listInstalledExtensions,
  uninstallExtension,
} from "../../src/extensions/manager.ts";
import type { Extension, ExtensionContext } from "../../src/extensions/types.ts";
import {
  isKnowledgeType,
  unregisterKnowledgeType,
} from "../../src/shared/knowledge-types.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

const demoExtension: Extension = {
  name: "demo",
  version: "1.0.0",
  description: "Demo extension for manager tests",
  knowledgeTypes: [
    { type: "demo", dir: "semantic/demos", v1Type: "semantic", idPrefix: "demo" },
  ],
  schema: {
    table: "demo_meta",
    columns: [
      { name: "label", type: "TEXT" },
      { name: "score", type: "REAL", default: "0" },
    ],
  },
  tools: [],
  async onInstall(ctx) {
    ctx.db.run("CREATE INDEX IF NOT EXISTS idx_demo_label ON demo_meta(label)");
  },
};

describe("Extension manager (install/uninstall, Task 004)", () => {
  let tempDir: string;
  let system: MemorySystem;
  let ctx: ExtensionContext;
  let commits: Array<{ message: string; scope?: string }>;

  beforeAll(async () => {
    tempDir = await createTempDir();
    system = createMemorySystem({
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
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

  beforeEach(() => {
    commits = [];
    // Minimal context: real project DB accessor + stub facade (Task 005 builds
    // the full facade; the manager only uses db, memory.commit, memoryPath).
    ctx = {
      db: system.searchIndex.extensionDb(),
      memoryPath: tempDir,
      log: { info() {}, warn() {}, error() {} },
      memory: {
        commit: async (message: string, scope?: string) => {
          commits.push({ message, scope });
        },
      } as unknown as ExtensionContext["memory"],
    };
    // Clean any prior install state between tests
    try {
      ctx.db.run("DROP TABLE IF EXISTS demo_meta");
      ctx.db.run("DELETE FROM extensions WHERE name = 'demo'");
    } catch {
      // ignore
    }
    unregisterKnowledgeType("demo");
  });

  test("install creates table with CASCADE FK, registry row, runs onInstall", async () => {
    await installExtension(ctx, demoExtension);

    // registry row
    const installed = listInstalledExtensions(ctx);
    expect(installed.find((e) => e.name === "demo")?.table_name).toBe("demo_meta");

    // table exists
    const tbl = ctx.db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='demo_meta'",
    );
    expect(tbl?.name).toBe("demo_meta");

    // FK with CASCADE present in the table DDL
    const ddl = ctx.db.get<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE name='demo_meta'",
    );
    expect(ddl?.sql).toContain("ON DELETE CASCADE");

    // onInstall ran (created the index)
    const idx = ctx.db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_demo_label'",
    );
    expect(idx?.name).toBe("idx_demo_label");
  });

  test("double install throws", async () => {
    await installExtension(ctx, demoExtension);
    await expect(installExtension(ctx, demoExtension)).rejects.toThrow(
      /already installed/,
    );
  });

  test("uninstall unregisters knowledge types; in-process reinstall is clean", async () => {
    await installExtension(ctx, demoExtension);
    expect(isKnowledgeType("demo")).toBe(true);

    await uninstallExtension(ctx, demoExtension);
    // type/prefix released so a long-lived process doesn't leak it
    expect(isKnowledgeType("demo")).toBe(false);

    // reinstall in the same process re-registers cleanly (no throw, type back)
    await installExtension(ctx, demoExtension);
    expect(isKnowledgeType("demo")).toBe(true);
    await uninstallExtension(ctx, demoExtension);
  });

  test("uninstall drops table, removes registry row, keeps no residue", async () => {
    await installExtension(ctx, demoExtension);
    await uninstallExtension(ctx, demoExtension);

    const tbl = ctx.db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='demo_meta'",
    );
    expect(tbl).toBeUndefined();
    expect(listInstalledExtensions(ctx).find((e) => e.name === "demo")).toBeUndefined();
  });

  test("uninstall of not-installed extension throws", async () => {
    await expect(uninstallExtension(ctx, demoExtension)).rejects.toThrow(
      /not installed/,
    );
  });

  test("CASCADE deletes ext row when the knowledge entry is removed", async () => {
    await installExtension(ctx, demoExtension);

    // Create a real knowledge entry, attach an ext_meta row keyed by its id.
    const { id } = await system.memoryStore({
      title: "Demo entry",
      type: "demo",
      content: "body",
    });
    ctx.db.run("INSERT INTO demo_meta (entry_id, label, score) VALUES (?, ?, ?)", [
      id,
      "x",
      1,
    ]);
    expect(
      ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM demo_meta")?.c,
    ).toBe(1);

    // memory_forget the entry → CASCADE removes the demo_meta row.
    await system.forget({ query: id, scope: "entry", confirm: true });

    expect(
      ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM demo_meta")?.c,
    ).toBe(0);

    await uninstallExtension(ctx, demoExtension);
  });

  test("uninstall cleans ext.<name> frontmatter and commits", async () => {
    await installExtension(ctx, demoExtension);
    const { id } = await system.memoryStore({
      title: "Frontmatter demo",
      type: "demo",
      content: "body",
    });
    await system.setExtensionData(id, "demo", { label: "y" });
    expect(await system.getExtensionData<{ label: string }>(id, "demo")).toEqual({
      label: "y",
    });

    await uninstallExtension(ctx, demoExtension);

    // ext.demo block removed from the file
    expect(await system.getExtensionData(id, "demo")).toBeNull();
    // bulk rewrite committed
    expect(commits.some((c) => c.message.includes("uninstall extension demo"))).toBe(
      true,
    );
  });
});
