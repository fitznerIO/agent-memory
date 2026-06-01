import type { ExtensionDB } from "../shared/types.ts";

/**
 * Startup discovery + loading of installed extensions (Extension System §6.1).
 *
 * Task 002 ships this as a NO-OP STUB so the orchestrator can wire the call site
 * (createMemorySystem → start) and stay green at the task boundary. Task 005
 * replaces the body with the real loader: read the `extensions` registry, register
 * each installed extension's knowledgeTypes BEFORE the first tool call, run
 * onStartup hooks, and collect tools.
 *
 * The `db` parameter is the scoped ExtensionDB accessor from
 * `searchIndex.extensionDb()` (C4) — never a raw bun:sqlite Database.
 *
 * The return type is intentionally `unknown[]` here: the concrete
 * `LoadedExtension` shape (extension + tools + context) is defined and returned
 * by Task 005, not this stub.
 */
export async function loadExtensions(
  _db: ExtensionDB,
  _memoryPath: string,
): Promise<unknown[]> {
  // No-op until Task 005. No extensions are auto-loaded.
  return [];
}
