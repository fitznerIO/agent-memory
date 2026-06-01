import type {
  ConnectionType,
  ExtensionDB,
  KnowledgeEntry,
  MemoryStoreInput,
  SearchResult,
} from "../shared/types.ts";

// Re-export the canonical ExtensionDB (defined in shared/types.ts, Task 002) so
// extension authors can import everything they need from one place.
export type { ExtensionDB } from "../shared/types.ts";

/** A column in an extension's own SQLite table. */
export interface ExtensionColumn {
  name: string;
  type: "TEXT" | "INTEGER" | "REAL";
  default?: string;
  notNull?: boolean;
}

/** Schema for an extension's table. The runtime adds `entry_id TEXT PRIMARY KEY`
 *  + `FOREIGN KEY (entry_id) REFERENCES knowledge(id) ON DELETE CASCADE` itself. */
export interface ExtensionSchema {
  /** Table name, convention `<name>_meta`. */
  table: string;
  columns: ExtensionColumn[];
}

/** Minimal logger handed to extensions via the context. */
export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** Filters for the facade `search()`. */
export interface SearchFilters {
  limit?: number;
  tags?: string[];
  type?: string;
}

/**
 * Narrow facade over the core orchestrator handed to extension tools (§4.1).
 * Implemented in Task 005; the interface lives here so the contract is fixed now.
 * Maps onto MemorySystem: store→memoryStore, connect→memoryConnect, read by id
 * (resolved to file_path internally), etc.
 */
export interface MemoryAPI {
  store(input: MemoryStoreInput): Promise<string>;
  search(query: string, filters?: SearchFilters): Promise<SearchResult[]>;
  read(id: string): Promise<KnowledgeEntry | null>;
  /** Replace an entry's body. `reason` is recorded in the git history (the core
   *  update() requires it); facade synthesizes a default when omitted. */
  update(id: string, content: string, reason?: string): Promise<void>;
  connect(
    sourceId: string,
    targetId: string,
    type: ConnectionType,
    note?: string,
  ): Promise<void>;
  commit(message: string, scope?: string): Promise<void>;
  setExtensionData(
    id: string,
    name: string,
    data: Record<string, unknown>,
  ): Promise<void>;
  getExtensionData<T = unknown>(id: string, name: string): Promise<T | null>;
}

/** Everything an extension hook or tool handler receives. */
export interface ExtensionContext {
  /** Scoped DB accessor on the project store's connection (C4). */
  db: ExtensionDB;
  /** Narrow core facade (C3 ext.* writes + store/search/connect). */
  memory: MemoryAPI;
  /** Absolute path to the project store's .agent-memory directory. */
  memoryPath: string;
  log: Logger;
}

/** A tool an extension contributes. Convention: name `<ext>_<action>`. */
export interface ExtensionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: unknown, ctx: ExtensionContext) => Promise<unknown>;
}

/** One knowledge type an extension introduces (registered via C1, Task 001). */
export interface ExtensionKnowledgeType {
  type: string;
  dir: string;
  v1Type: "semantic" | "episodic" | "procedural";
  idPrefix: string;
}

/** A pluggable extension: own table + tools, no core-schema changes. */
export interface Extension {
  /** Unique name, lowercase, no special chars. */
  name: string;
  /** Semver version. */
  version: string;
  description: string;
  schema: ExtensionSchema;
  tools: ExtensionTool[];
  /** Knowledge types this extension introduces (C1). */
  knowledgeTypes?: ExtensionKnowledgeType[];
  /** Called after the table is created, during install. */
  onInstall?: (ctx: ExtensionContext) => Promise<void>;
  /** Called before the table is dropped, during uninstall. */
  onUninstall?: (ctx: ExtensionContext) => Promise<void>;
  /** Called on every startup for installed extensions. */
  onStartup?: (ctx: ExtensionContext) => Promise<void>;
  /** Called on version mismatch (before the registry version is bumped). */
  onMigrate?: (
    ctx: ExtensionContext,
    versions: { fromVersion: string; toVersion: string },
  ) => Promise<void>;
}

/** A row in the `extensions` registry table (§5.1). */
export interface RegisteredExtension {
  name: string;
  version: string;
  description: string | null;
  table_name: string;
  installed_at: string;
  config: string;
}

/** DDL for the `extensions` registry table (project store). */
export const EXTENSIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS extensions (
  name         TEXT PRIMARY KEY,
  version      TEXT NOT NULL,
  description  TEXT,
  table_name   TEXT NOT NULL,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  config       TEXT DEFAULT '{}'
)`;
