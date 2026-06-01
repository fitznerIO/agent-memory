# Task 003: Phase 1 — Extension-Interface (types.ts) + Registry-Tabelle

## Dependencies
- Requires: 002

## Description
(aus Ext-PRD §4.1, §5.1, §6.2)

**Extension-Interface** (`src/extensions/types.ts`):

```typescript
export interface Extension {
  name: string;            // lowercase, keine Sonderzeichen
  version: string;         // Semver
  description: string;
  schema: ExtensionSchema;
  tools: ExtensionTool[];
  knowledgeTypes?: Array<{ type: string; dir: string; v1Type: "semantic"|"episodic"|"procedural"; idPrefix: string }>;
  onInstall?: (ctx: ExtensionContext) => Promise<void>;
  onUninstall?: (ctx: ExtensionContext) => Promise<void>;
  onStartup?: (ctx: ExtensionContext) => Promise<void>;
  onMigrate?: (ctx: ExtensionContext, versions: { fromVersion: string; toVersion: string }) => Promise<void>;
}

export interface ExtensionSchema { table: string; columns: ExtensionColumn[]; }
export interface ExtensionColumn { name: string; type: "TEXT"|"INTEGER"|"REAL"; default?: string; notNull?: boolean; }
export interface ExtensionTool { name: string; description: string; inputSchema: Record<string, unknown>; handler: (input: unknown, ctx: ExtensionContext) => Promise<unknown>; }
export interface ExtensionContext { db: ExtensionDB; memory: MemoryAPI; memoryPath: string; log: Logger; }
export interface ExtensionDB { run(sql, params?): void; get<T>(sql, params?): T|undefined; all<T>(sql, params?): T[]; }
```

`MemoryAPI` + `Logger` Interface gehören hierher (Bodies definieren, Typecheck muss grün sein); die Facade-Implementierung kommt in Task 005:

```typescript
export interface MemoryAPI {
  store(input: MemoryStoreInput): Promise<string>;
  search(query: string, filters?: SearchFilters): Promise<SearchResult[]>;
  read(id: string): Promise<MemoryEntry | null>;          // löst id→file_path auf (Task 005)
  update(id: string, changes: Partial<MemoryEntry>): Promise<void>;
  connect(sourceId: string, targetId: string, type: ConnectionType, note?: string): Promise<void>;
  commit(message: string, scope?: string): Promise<void>;
  setExtensionData(id: string, name: string, data: Record<string, unknown>): Promise<void>;  // aus Task 002
  getExtensionData<T>(id: string, name: string): Promise<T | null>;                            // aus Task 002
}

export interface Logger {
  info(msg: string): void; warn(msg: string): void; error(msg: string): void;
}
```

**Registry-Tabelle** (`extensions`, §5.1):

```sql
CREATE TABLE IF NOT EXISTS extensions (
  name TEXT PRIMARY KEY, version TEXT NOT NULL, description TEXT,
  table_name TEXT NOT NULL, installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  config TEXT DEFAULT '{}'
);
```

**AVAILABLE_EXTENSIONS** (`src/extensions/registry.ts`, §6.2): explizites Array verfügbarer Extensions — kein Ordner-Scanning, keine dynamischen Imports. Neue Extension hinzufügen = eine Zeile.

## Expected Outcome
- `src/extensions/types.ts` mit allen oben genannten Interfaces (inkl. `onMigrate`-Stub, `knowledgeTypes`).
- `extensions`-Registry-Tabelle wird beim Startup sichergestellt (`CREATE TABLE IF NOT EXISTS`).
- `src/extensions/registry.ts` mit `AVAILABLE_EXTENSIONS: Extension[]` (zunächst leer bzw. Referenz-Extension aus Task 007).
- Typecheck grün; Interfaces folgen den Core-Konventionen (Interfaces in types.ts).

## Agent Context
Baut auf Phase 0 (Tasks 001/002) auf. Liefert die Typ-Verträge und die Registry-Tabelle, die Manager (004) und Loader (005) konsumieren. Reine Definitions-/Schema-Arbeit, keine Laufzeitlogik.
