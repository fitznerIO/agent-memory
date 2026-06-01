import {
  isKnowledgeType,
  registerKnowledgeType,
} from "../shared/knowledge-types.ts";
import type { ExtensionDB } from "../shared/types.ts";
import {
  EXTENSIONS_TABLE_SQL,
  type Extension,
  type ExtensionContext,
  type ExtensionTool,
  type Logger,
  type MemoryAPI,
  type RegisteredExtension,
} from "./types.ts";

/** A loaded, installed extension: its definition, tools, and live context. */
export interface LoadedExtension {
  extension: Extension;
  tools: ExtensionTool[];
  context: ExtensionContext;
}

export interface LoadExtensionsOptions {
  /** Scoped DB accessor on the project store's connection (C4). */
  db: ExtensionDB;
  /** Absolute path to the project store directory. */
  memoryPath: string;
  /** Core facade extensions reach the orchestrator through (C3/§4.1). */
  memory: MemoryAPI;
  /** All extensions known to this build (registry.ts AVAILABLE_EXTENSIONS). */
  available: Extension[];
  /** Optional logger; defaults to a console logger. */
  log?: Logger;
}

const defaultLogger: Logger = {
  info: (m) => console.error(`[ext] ${m}`),
  warn: (m) => console.error(`[ext] WARN ${m}`),
  error: (m) => console.error(`[ext] ERROR ${m}`),
};

/**
 * Startup discovery + loading of installed extensions (§6.1).
 *
 * Only extensions present in BOTH the `extensions` registry table (installed)
 * AND the `available` array are loaded — no auto-install. For each:
 *   1. register its knowledgeTypes (BEFORE any tool can fire — §8.4.1)
 *   2. on version mismatch, run onMigrate then bump the registry version
 *   3. run onStartup
 *   4. collect its tools
 */
export async function loadExtensions(
  opts: LoadExtensionsOptions,
): Promise<LoadedExtension[]> {
  const { db, memoryPath, memory, available } = opts;
  const log = opts.log ?? defaultLogger;

  // Ensure the registry table exists (§5.1). Idempotent.
  db.run(EXTENSIONS_TABLE_SQL);

  const registered = db.all<RegisteredExtension>("SELECT * FROM extensions");
  const loaded: LoadedExtension[] = [];

  for (const ext of available) {
    const row = registered.find((r) => r.name === ext.name);
    if (!row) continue; // available but not installed → skip (no auto-install)

    const ctx: ExtensionContext = { db, memory, memoryPath, log };

    // 1. Register knowledge types before any tool can fire. Skip own types
    //    already registered (re-startup); a cross-extension collision throws.
    for (const kt of ext.knowledgeTypes ?? []) {
      if (!isKnowledgeType(kt.type)) registerKnowledgeType(kt);
    }

    // 2. Version mismatch → migrate, then bump the registry version (after the
    //    migration succeeds, so a crash mid-migration doesn't claim the new
    //    version over old schema). Real migration machinery is a later concern;
    //    onMigrate is an optional hook today.
    if (row.version !== ext.version) {
      if (ext.onMigrate) {
        await ext.onMigrate(ctx, {
          fromVersion: row.version,
          toVersion: ext.version,
        });
      }
      db.run("UPDATE extensions SET version = ? WHERE name = ?", [
        ext.version,
        ext.name,
      ]);
    }

    // 3. onStartup hook.
    if (ext.onStartup) await ext.onStartup(ctx);

    // 4. Collect tools.
    loaded.push({ extension: ext, tools: ext.tools, context: ctx });
  }

  return loaded;
}
