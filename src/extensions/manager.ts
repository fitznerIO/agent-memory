import {
  isKnowledgeType,
  registerKnowledgeType,
  unregisterKnowledgeType,
} from "../shared/knowledge-types.ts";
import { cleanFrontmatterNamespace } from "./frontmatter.ts";
import type {
  Extension,
  ExtensionContext,
  RegisteredExtension,
} from "./types.ts";

/** Build the CREATE TABLE statement for an extension's own table (§7.1).
 *  The runtime always prepends `entry_id TEXT PRIMARY KEY` and appends the
 *  FK with ON DELETE CASCADE — the consumer DDL never carries the cascade. */
function buildCreateTableSql(ext: Extension): string {
  const cols = ext.schema.columns
    .map((col) => {
      let def = `${col.name} ${col.type}`;
      if (col.notNull) def += " NOT NULL";
      if (col.default) def += ` DEFAULT ${col.default}`;
      return def;
    })
    .join(",\n  ");

  return `CREATE TABLE IF NOT EXISTS ${ext.schema.table} (
  entry_id TEXT PRIMARY KEY,
  ${cols},
  FOREIGN KEY (entry_id) REFERENCES knowledge(id) ON DELETE CASCADE
)`;
}

/** Register the extension's knowledge types with the runtime registry (C1).
 *  Idempotent for THIS extension's own types across repeated startups (skip if
 *  already present), but a genuine cross-extension collision — a different
 *  extension already owns this type name or ID prefix — still throws, which is
 *  exactly the guard C1 added. We only skip the exact-same type we registered. */
function registerTypes(ext: Extension): void {
  for (const kt of ext.knowledgeTypes ?? []) {
    if (isKnowledgeType(kt.type)) continue; // already registered (re-startup)
    registerKnowledgeType(kt); // throws on duplicate prefix from another ext
  }
}

/**
 * Install an extension (§7.1): create its table, register it, register its
 * knowledge types, run onInstall. Throws if already installed.
 */
export async function installExtension(
  ctx: ExtensionContext,
  ext: Extension,
): Promise<void> {
  const { db } = ctx;

  const existing = db.get<{ name: string }>(
    "SELECT name FROM extensions WHERE name = ?",
    [ext.name],
  );
  if (existing) {
    throw new Error(`Extension '${ext.name}' is already installed`);
  }

  // 1. Create the extension table (with FK + CASCADE).
  db.run(buildCreateTableSql(ext));

  // 2. Record in the registry.
  db.run(
    `INSERT INTO extensions (name, version, description, table_name)
     VALUES (?, ?, ?, ?)`,
    [ext.name, ext.version, ext.description, ext.schema.table],
  );

  // 3. Register knowledge types BEFORE onInstall (so a tool fired in onInstall
  //    can already memoryStore(type=...)).
  registerTypes(ext);

  // 4. onInstall hook.
  if (ext.onInstall) {
    await ext.onInstall(ctx);
  }
}

/**
 * Uninstall an extension (§7.2): onUninstall → drop table → remove from registry
 * → clean ext.<name> frontmatter → commit the bulk rewrite. Throws if not installed.
 */
export async function uninstallExtension(
  ctx: ExtensionContext,
  ext: Extension,
): Promise<void> {
  const { db, memory, memoryPath } = ctx;

  const existing = db.get<{ name: string }>(
    "SELECT name FROM extensions WHERE name = ?",
    [ext.name],
  );
  if (!existing) {
    throw new Error(`Extension '${ext.name}' is not installed`);
  }

  // 1. onUninstall hook (before anything is torn down).
  if (ext.onUninstall) {
    await ext.onUninstall(ctx);
  }

  // 2. Drop the extension table.
  db.run(`DROP TABLE IF EXISTS ${ext.schema.table}`);

  // 3. Remove from registry.
  db.run("DELETE FROM extensions WHERE name = ?", [ext.name]);

  // 4. Unregister this extension's knowledge types from the runtime registry so
  //    an in-process reinstall (or a different extension reusing the prefix)
  //    starts from a clean slate. (One-shot CLI rebuilds the registry per run,
  //    but a long-lived process would otherwise leak the type/prefix.)
  for (const kt of ext.knowledgeTypes ?? []) {
    unregisterKnowledgeType(kt.type);
  }

  // 5. Clean ext.<name> frontmatter from the project store only (C6 — ext keys
  //    never exist in the global store, so no global scan is needed).
  const cleaned = await cleanFrontmatterNamespace(memoryPath, ext.name);

  // 6. Commit the bulk rewrite so it doesn't linger as an uncommitted diff
  //    mixed with the user's own changes.
  if (cleaned > 0) {
    await memory.commit(`chore: uninstall extension ${ext.name}`, "extensions");
  }
}

/** List installed extensions from the registry. */
export function listInstalledExtensions(
  ctx: ExtensionContext,
): RegisteredExtension[] {
  return ctx.db.all<RegisteredExtension>(
    "SELECT * FROM extensions ORDER BY name",
  );
}
