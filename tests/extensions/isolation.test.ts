import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createMemoryApi } from "../../src/extensions/facade.ts";
import {
  installExtension,
  uninstallExtension,
} from "../../src/extensions/manager.ts";
import type { Extension, ExtensionContext } from "../../src/extensions/types.ts";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import { unregisterKnowledgeType } from "../../src/shared/knowledge-types.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

/** Two independent fixture extensions to prove §15 isolation: one cannot affect
 *  the other's table, frontmatter namespace, or registry row. */
function makeExt(name: string, prefix: string): Extension {
  return {
    name,
    version: "1.0.0",
    description: `${name} fixture`,
    knowledgeTypes: [
      { type: name, dir: `semantic/${name}s`, v1Type: "semantic", idPrefix: prefix },
    ],
    schema: { table: `${name}_meta`, columns: [{ name: "val", type: "TEXT" }] },
    tools: [],
  };
}

describe("Extension isolation (§15)", () => {
  let tempDir: string;
  let system: MemorySystem;
  let ctx: ExtensionContext;
  const alpha = makeExt("alpha", "al");
  const beta = makeExt("beta", "be");

  beforeAll(async () => {
    tempDir = await createTempDir();
    system = createMemorySystem({
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
      globalDir: undefined,
    });
    await system.start();
    ctx = {
      db: system.searchIndex.extensionDb(),
      memory: createMemoryApi(system),
      memoryPath: tempDir,
      log: { info() {}, warn() {}, error() {} },
    };
    await installExtension(ctx, alpha);
    await installExtension(ctx, beta);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    try {
      await system.stop();
    } catch {
      // already stopped
    }
    unregisterKnowledgeType("alpha");
    unregisterKnowledgeType("beta");
    await cleanupTempDir(tempDir);
  }, TEST_TIMEOUT);

  test("each extension gets its own isolated table", () => {
    const db = ctx.db;
    expect(
      db.get("SELECT name FROM sqlite_master WHERE name='alpha_meta'"),
    ).toBeDefined();
    expect(
      db.get("SELECT name FROM sqlite_master WHERE name='beta_meta'"),
    ).toBeDefined();
  });

  test("writing alpha data does not touch beta's table or namespace", async () => {
    const { id: aId } = await system.memoryStore({
      title: "Alpha entry",
      type: "alpha",
      content: "a",
    });
    ctx.db.run("INSERT INTO alpha_meta (entry_id, val) VALUES (?, ?)", [aId, "x"]);
    await system.setExtensionData(aId, "alpha", { val: "x" });

    // beta's table untouched, beta namespace absent on the alpha entry
    expect(
      ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM beta_meta")?.c,
    ).toBe(0);
    expect(await system.getExtensionData(aId, "beta")).toBeNull();
    expect(await system.getExtensionData<{ val: string }>(aId, "alpha")).toEqual({
      val: "x",
    });
  });

  test("uninstalling beta leaves alpha fully intact", async () => {
    const { id: aId } = await system.memoryStore({
      title: "Alpha keep",
      type: "alpha",
      content: "keep",
    });
    ctx.db.run("INSERT INTO alpha_meta (entry_id, val) VALUES (?, ?)", [
      aId,
      "keep",
    ]);
    await system.setExtensionData(aId, "alpha", { val: "keep" });

    await uninstallExtension(ctx, beta);

    // beta gone
    expect(
      ctx.db.get("SELECT name FROM sqlite_master WHERE name='beta_meta'"),
    ).toBeUndefined();
    // alpha intact: table, row, frontmatter, registry
    expect(
      ctx.db.get("SELECT name FROM sqlite_master WHERE name='alpha_meta'"),
    ).toBeDefined();
    expect(
      ctx.db.get<{ val: string }>(
        "SELECT val FROM alpha_meta WHERE entry_id = ?",
        [aId],
      )?.val,
    ).toBe("keep");
    expect(await system.getExtensionData<{ val: string }>(aId, "alpha")).toEqual({
      val: "keep",
    });
    expect(
      ctx.db.get("SELECT name FROM extensions WHERE name='alpha'"),
    ).toBeDefined();

    await uninstallExtension(ctx, alpha);
  });
});
