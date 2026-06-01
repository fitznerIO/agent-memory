import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildExtensionDispatch } from "../../src/extensions/tool-registry.ts";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

/**
 * End-to-end validation of the Extension System (Task 007, §15) using the
 * `bookmark` reference extension registered in AVAILABLE_EXTENSIONS.
 */
describe("Reference extension end-to-end (Task 007)", () => {
  let tempDir: string;
  let system: MemorySystem;
  let sqlitePath: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    sqlitePath = join(tempDir, ".index", "search.sqlite");
    system = createMemorySystem({ baseDir: tempDir, sqlitePath, globalDir: undefined });
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

  test("bookmark appears as available but not installed initially", () => {
    const list = system.listExtensions();
    const bm = list.find((e) => e.name === "bookmark");
    expect(bm).toBeDefined();
    expect(bm?.installed).toBe(false);
  });

  test("install completes quickly (< 1s) and registers cleanly", async () => {
    const t0 = performance.now();
    await system.installExtensionByName("bookmark");
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(1000);

    const status = system.extensionStatus("bookmark");
    expect(status?.installed).toBe(true);
    expect(status?.table).toBe("bookmark_meta");
    expect(status?.tools).toContain("bookmark_add");
  });

  test("tool becomes dispatchable after restart; creates entry + ext row + frontmatter", async () => {
    // Tools activate on next start() (documented Variante A behavior).
    await system.stop();
    system = createMemorySystem({ baseDir: tempDir, sqlitePath, globalDir: undefined });
    await system.start();

    const dispatch = buildExtensionDispatch(system.getLoadedExtensions());
    const handler = dispatch.get("bookmark_add");
    expect(handler).toBeDefined();

    const result = (await handler?.({
      title: "Anthropic",
      url: "https://anthropic.com",
      priority: 5,
    })) as { id: string; url: string; priority: number };

    // sequential extension-prefixed id (C1)
    expect(result.id.startsWith("bm-")).toBe(true);

    // ext row exists
    const db = system.searchIndex.extensionDb();
    const row = db.get<{ url: string; priority: number }>(
      "SELECT url, priority FROM bookmark_meta WHERE entry_id = ?",
      [result.id],
    );
    expect(row).toEqual({ url: "https://anthropic.com", priority: 5 });

    // ext.bookmark frontmatter written (C3)
    expect(
      await system.getExtensionData<{ url: string; priority: number }>(
        result.id,
        "bookmark",
      ),
    ).toEqual({
      url: "https://anthropic.com",
      priority: 5,
    });
  });

  test("extension type survives rebuild-index (C1 regression guard)", async () => {
    // Find the bookmark entry id
    const before = system.searchIndex.extensionDb();
    const idRow = before.get<{ entry_id: string }>(
      "SELECT entry_id FROM bookmark_meta LIMIT 1",
    );
    const id = idRow?.entry_id;
    expect(id).toBeDefined();

    await system.rebuildIndex();

    // The knowledge row for the bookmark-typed entry must still exist after rebuild
    const db = system.searchIndex.extensionDb();
    const k = db.get<{ id: string; type: string }>(
      "SELECT id, type FROM knowledge WHERE id = ?",
      [id as string],
    );
    expect(k?.id).toBe(id as string);
    expect(k?.type).toBe("bookmark");

    // The extension-table row must NOT be wiped by rebuild's resetAll (CASCADE
    // is suppressed during the wipe; FK target is re-inserted by rebuild).
    const meta = db.get<{ entry_id: string }>(
      "SELECT entry_id FROM bookmark_meta WHERE entry_id = ?",
      [id as string],
    );
    expect(meta?.entry_id).toBe(id as string);
  });

  test("CASCADE: forget removes the bookmark_meta row", async () => {
    const db = system.searchIndex.extensionDb();
    const idRow = db.get<{ entry_id: string }>(
      "SELECT entry_id FROM bookmark_meta LIMIT 1",
    );
    const id = idRow?.entry_id as string;
    expect(id).toBeDefined();

    await system.forget({ query: id, scope: "entry", confirm: true });

    const after = db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM bookmark_meta WHERE entry_id = ?",
      [id],
    );
    expect(after?.c).toBe(0);
  });

  test("clean uninstall: table dropped, registry empty, no ext.* residue", async () => {
    // Add one more bookmark with frontmatter to verify cleanup
    const dispatch = buildExtensionDispatch(system.getLoadedExtensions());
    const res = (await dispatch.get("bookmark_add")?.({
      title: "Residue check",
      url: "https://example.com",
    })) as { id: string };

    await system.uninstallExtensionByName("bookmark");

    const db = system.searchIndex.extensionDb();
    // table dropped
    const tbl = db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='bookmark_meta'",
    );
    expect(tbl).toBeUndefined();
    // registry row gone
    expect(system.extensionStatus("bookmark")?.installed).toBe(false);
    // frontmatter cleaned
    expect(await system.getExtensionData(res.id, "bookmark")).toBeNull();
    // knowledge entry itself remains (belongs to core)
    const k = db.get<{ id: string }>("SELECT id FROM knowledge WHERE id = ?", [
      res.id,
    ]);
    expect(k?.id).toBe(res.id);
  });
});
