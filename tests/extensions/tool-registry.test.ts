import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { LoadedExtension } from "../../src/extensions/loader.ts";
import { buildExtensionDispatch } from "../../src/extensions/tool-registry.ts";
import type { ExtensionContext } from "../../src/extensions/types.ts";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const fakeCtx = {} as ExtensionContext;

function loaded(name: string, tools: string[]): LoadedExtension {
  return {
    extension: {
      name,
      version: "1.0.0",
      description: "",
      schema: { table: `${name}_meta`, columns: [] },
      tools: [],
    },
    tools: tools.map((t) => ({
      name: t,
      description: t,
      inputSchema: {},
      handler: async (input: unknown) => ({ tool: t, input }),
    })),
    context: fakeCtx,
  };
}

describe("buildExtensionDispatch (Task 006, Variante A)", () => {
  test("maps every tool name to its handler", async () => {
    const dispatch = buildExtensionDispatch([
      loaded("billing", ["billing_import", "billing_match"]),
      loaded("ideaforge", ["idea_store"]),
    ]);

    expect([...dispatch.keys()].sort()).toEqual([
      "billing_import",
      "billing_match",
      "idea_store",
    ]);

    const result = await dispatch.get("billing_import")?.({ csv: "x" });
    expect(result).toEqual({ tool: "billing_import", input: { csv: "x" } });
  });

  test("empty loaded set yields empty dispatch", () => {
    expect(buildExtensionDispatch([]).size).toBe(0);
  });

  test("handler is bound to its own extension's context (smoke)", async () => {
    let seenCtx: unknown;
    const l: LoadedExtension = {
      extension: {
        name: "x",
        version: "1.0.0",
        description: "",
        schema: { table: "x_meta", columns: [] },
        tools: [],
      },
      tools: [
        {
          name: "x_do",
          description: "",
          inputSchema: {},
          handler: async (_input, ctx) => {
            seenCtx = ctx;
            return "ok";
          },
        },
      ],
      context: { marker: 42 } as unknown as ExtensionContext,
    };
    const dispatch = buildExtensionDispatch([l]);
    await dispatch.get("x_do")?.({});
    expect((seenCtx as { marker: number }).marker).toBe(42);
  });
});

describe("orchestrator extension management (Task 006)", () => {
  let tempDir: string;
  let system: MemorySystem;

  beforeAll(async () => {
    tempDir = await createTempDir();
    system = createMemorySystem({
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
      globalDir: undefined,
    });
    await system.start();
  }, 120_000);

  afterAll(async () => {
    try {
      await system.stop();
    } catch {
      // already stopped
    }
    await cleanupTempDir(tempDir);
  }, 120_000);

  test("listExtensions reflects AVAILABLE_EXTENSIONS (empty by default)", () => {
    // No extensions registered in this build yet (Task 007 adds the reference).
    expect(Array.isArray(system.listExtensions())).toBe(true);
  });

  test("install/uninstall of an unknown extension throws", async () => {
    await expect(system.installExtensionByName("nope")).rejects.toThrow(
      /Unknown extension/,
    );
    await expect(system.uninstallExtensionByName("nope")).rejects.toThrow(
      /Unknown extension/,
    );
  });

  test("getLoadedExtensions is empty with no installed extensions", () => {
    expect(system.getLoadedExtensions()).toHaveLength(0);
  });
});
