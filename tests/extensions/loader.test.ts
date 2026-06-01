import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createMemoryApi } from "../../src/extensions/facade.ts";
import { loadExtensions } from "../../src/extensions/loader.ts";
import { installExtension } from "../../src/extensions/manager.ts";
import type { Extension, ExtensionContext } from "../../src/extensions/types.ts";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import {
  isKnowledgeType,
  unregisterKnowledgeType,
} from "../../src/shared/knowledge-types.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

function makeExt(overrides: Partial<Extension> = {}): Extension {
  let startupRan = 0;
  const ext: Extension = {
    name: "loadtest",
    version: "1.0.0",
    description: "Loader test extension",
    knowledgeTypes: [
      {
        type: "loadtest",
        dir: "semantic/loadtests",
        v1Type: "semantic",
        idPrefix: "lt",
      },
    ],
    schema: {
      table: "loadtest_meta",
      columns: [{ name: "flag", type: "TEXT" }],
    },
    tools: [
      {
        name: "loadtest_ping",
        description: "ping",
        inputSchema: {},
        handler: async () => "pong",
      },
    ],
    async onStartup() {
      startupRan++;
    },
    ...overrides,
  };
  // expose counter for assertions
  (ext as unknown as { startupRuns: () => number }).startupRuns = () =>
    startupRan;
  return ext;
}

describe("Extension loader (Task 005)", () => {
  let tempDir: string;
  let system: MemorySystem;
  let ctx: ExtensionContext;

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
    ctx = {
      db: system.searchIndex.extensionDb(),
      memoryPath: tempDir,
      log: { info() {}, warn() {}, error() {} },
      memory: createMemoryApi(system),
    };
    ctx.db.run("DROP TABLE IF EXISTS loadtest_meta");
    ctx.db.run("DELETE FROM extensions WHERE name = 'loadtest'");
    unregisterKnowledgeType("loadtest");
  });

  test("only loads extensions that are installed AND available", async () => {
    const ext = makeExt();
    // available but NOT installed → not loaded
    let loaded = await loadExtensions({
      db: ctx.db,
      memoryPath: tempDir,
      memory: ctx.memory,
      available: [ext],
    });
    expect(loaded).toHaveLength(0);

    // install it, then it loads
    await installExtension(ctx, ext);
    loaded = await loadExtensions({
      db: ctx.db,
      memoryPath: tempDir,
      memory: ctx.memory,
      available: [ext],
    });
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.extension.name).toBe("loadtest");
    expect(loaded[0]?.tools.map((t) => t.name)).toContain("loadtest_ping");
  });

  test("registers knowledgeTypes and runs onStartup on load", async () => {
    const ext = makeExt();
    await installExtension(ctx, ext);
    // installExtension already registered the type
    expect(isKnowledgeType("loadtest")).toBe(true);

    const loaded = await loadExtensions({
      db: ctx.db,
      memoryPath: tempDir,
      memory: ctx.memory,
      available: [ext],
    });
    expect(loaded).toHaveLength(1);
    expect(
      (ext as unknown as { startupRuns: () => number }).startupRuns(),
    ).toBeGreaterThanOrEqual(1);
  });

  test("loaded tool handler is callable through its context", async () => {
    const ext = makeExt();
    await installExtension(ctx, ext);
    const loaded = await loadExtensions({
      db: ctx.db,
      memoryPath: tempDir,
      memory: ctx.memory,
      available: [ext],
    });
    const tool = loaded[0]?.tools[0];
    const result = await tool?.handler({}, loaded[0]!.context);
    expect(result).toBe("pong");
  });

  test("version mismatch triggers onMigrate then bumps registry version", async () => {
    const v1 = makeExt();
    await installExtension(ctx, v1);

    const migrations: Array<{ fromVersion: string; toVersion: string }> = [];
    const v2 = makeExt({
      version: "2.0.0",
      async onMigrate(_c, versions) {
        migrations.push(versions);
      },
    });
    await loadExtensions({
      db: ctx.db,
      memoryPath: tempDir,
      memory: ctx.memory,
      available: [v2],
    });

    expect(migrations).toEqual([{ fromVersion: "1.0.0", toVersion: "2.0.0" }]);
    const row = ctx.db.get<{ version: string }>(
      "SELECT version FROM extensions WHERE name = 'loadtest'",
    );
    expect(row?.version).toBe("2.0.0");
  });

  test("facade store/read round-trips an extension-typed entry", async () => {
    const ext = makeExt();
    await installExtension(ctx, ext);
    const api = createMemoryApi(system);
    const id = await api.store({
      title: "Loader facade entry",
      type: "loadtest",
      content: "facade body",
    });
    expect(id.startsWith("lt-")).toBe(true);
    const entry = await api.read(id);
    expect(entry?.id).toBe(id);
    expect(entry?.type).toBe("loadtest");
  });
});
