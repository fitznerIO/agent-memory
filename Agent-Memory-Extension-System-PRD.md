# Agent-Memory Extension System – PRD

**Plugin-Infrastruktur für agent-memory v2-lite**

| | |
|---|---|
| **Version** | 1.0 |
| **Datum** | 08. Februar 2026 |
| **Autor** | fitznerIO – AI Services |
| **Status** | Draft |
| **Basis** | agent-memory v2-lite (implementiert) |
| **Konsumenten** | IdeaForge Extension, Billing Extension, zukünftige Extensions |

---

## 1. Problem

agent-memory v2-lite ist ein generisches Wissenssystem: Markdown-Dateien, SQLite-Index, Git, Connections, Tags. Verschiedene Use Cases brauchen aber spezifische Felder und Logik:

- **IdeaForge** braucht: Status-Lifecycle (unprocessed → active → archived), Urgency, Cluster-Detection
- **Billing** braucht: Provider, Betrag, Rechnungsnummer, Matching-Status, Sanitizer
- **Zukünftig:** Project-Tracker, CRM-Lite, etc.

Diese spezifischen Felder gehören NICHT in den Core. Sie würden die `knowledge`-Tabelle aufblähen und das Core-Schema für alle verkomplizieren.

### 1.1 Anforderung

Ein Extension-System das:

1. Extensions eigene Datenfelder gibt, ohne den Core zu verändern
2. Extensions eigene Tools registrieren können
3. Sauber installier- und deinstallierbar ist (kein Datenmüll)
4. Beim Startup automatisch installierte Extensions erkennt und lädt

---

## 2. Design-Prinzipien

1. **Eigene Tabelle pro Extension.** Extensions erweitern nie die `knowledge`-Tabelle. Sie bekommen eine eigene Tabelle mit Foreign Key auf `knowledge.id`.

2. **Eigener Frontmatter-Namespace.** Extension-Daten im Frontmatter leben unter `ext.<name>:`. Core-Felder und Extension-Felder sind klar getrennt.

3. **Saubere Deinstallation.** `DROP TABLE` + Frontmatter-Bereinigung = Extension ist weg. Knowledge-Einträge, Connections und Tags bleiben erhalten.

4. **Kein Core-Code-Änderung für neue Extensions.** Eine Extension ist ein Modul das sich beim Startup registriert. Der Core muss nicht angepasst werden wenn eine neue Extension hinzukommt.

---

## 2.5 Core-Voraussetzungen (Required Core Changes)

> **Kritisch.** Das Extension-System lässt sich NICHT ohne Änderungen am v2-lite Core implementieren. Der aktuelle Core (`src/index.ts`, `src/search/index.ts`, `src/shared/`) bietet die hier angenommenen Erweiterungspunkte noch nicht. Diese Lücken MÜSSEN vor Phase 1 geschlossen werden — sonst scheitert jede Extension an der ersten Buchung/Idee.

| # | Annahme im PRD | Ist-Zustand im Core | Erforderliche Core-Änderung |
|---|---|---|---|
| C1 | Extensions nutzen eigene `type`-Werte (`transaction`, `provider`, `idea`, `synthesis`) | `KnowledgeType` ist eine **geschlossene Union** (`decision\|incident\|entity\|pattern\|workflow\|note\|session`, `src/shared/types.ts:222`). `knowledgeTypeDir()` und `knowledgeToMemoryType()` sind **erschöpfende `switch` ohne `default`** (`src/shared/utils.ts:76,96`) → unbekannter Typ ⇒ `undefined` ⇒ Pfad-`join()` bricht. | Core muss einen **offenen Typ-Mechanismus** bieten: entweder Extensions registrieren ihre `type`-Werte (mit Verzeichnis-Mapping + v1-MemoryType-Fallback), oder `type` wird zu offenem `string` mit Default-Verzeichnis. |
| C2 | Extensions wollten ursprünglich **datums-codierte IDs** (`txn-2026-02-001`) | `memoryStore()` akzeptiert **kein** `id`-Argument; IDs werden via `getNextSequentialId(type)` als `{prefix}-{NNN}` autogeneriert (`src/index.ts:662`, `src/search/index.ts:835`). `parseV2LiteId` matcht nur `/^([a-z]+)-\d+$/` — `txn-2026-02-001` (Ziffer-Bindestrich-Ziffer) **bricht** das. | **Entschieden (kein Core-Change nötig):** Extensions verzichten auf datums-codierte IDs und nutzen **sequenzielle** IDs `{prefix}-{NNN}` über ihren in `knowledgeTypes` registrierten `idPrefix` (C1). Beispiel: `txn-001`, `idea-001`. Die Periode lebt ohnehin in Spalte `period` + Tag `billing/period/2026-02` — im ID redundant. `getNextSequentialId` mintet das direkt. Optionales `id`-Argument bleibt **out of scope** (kann später additiv kommen). |
| C3 | Extensions schreiben `ext.<name>:` ins Frontmatter | Es gibt **keine** Core-API, die `ext.*`-Keys schreibt. `memoryStore`/`update` setzen nur Core-Keys (`src/index.ts:680`). Der `yaml`-Parser **erhält** unbekannte Keys beim Round-Trip (verifiziert), aber `MemoryMetadata` kennt sie nicht. | Core braucht eine schmale API zum Lesen/Schreiben eines `ext.<name>`-Blocks im Frontmatter (z.B. `memory.setExtensionData(id, name, data)`), die Datei + Re-Index konsistent hält. |
| C4 | Loader/Context bekommt ein `Database`-Handle (`§6.1`, `§4.1`) | Das `Database`-Objekt wird **innerhalb** der Search-Factory erzeugt und **nie nach außen gereicht** (`src/search/index.ts:294`). `MemorySystem` hat kein `db`. Modul-Isolation (CLAUDE.md) verbietet Cross-Modul-Zugriff. | Search-Modul exponiert einen **schmalen Accessor** auf dem `SearchIndex`-Interface (z.B. `searchIndex.extensionDb()` → `ExtensionDB`, scoped auf Extension-Tabellen + lesend auf Core). **Integrationspunkt:** `createMemorySystem()` (`src/index.ts:188`) ruft nach dem Bau des `project`-Stores und vor dem `return`: `loadExtensions(project.searchIndex.extensionDb(), config.baseDir, AVAILABLE_EXTENSIONS)`. `src/index.ts` bleibt damit der einzige Integrationspunkt (CLAUDE.md). Kein freies `Database`. |
| C5 | Extensions „registrieren Tools" beim Agent (`§9`) | Es existiert **kein Agent-SDK / MCP Tool-Host**. Einziger Einstiegspunkt ist der CLI-`switch` (`src/cli.ts:160`). `buildToolDefinitions()` hat kein Ziel. | Entweder einen Tool-Host (MCP/Agent-SDK) bauen — **eigenes, größeres Vorhaben** — oder Extension-Tools als CLI-Subcommands (`agent-memory billing import …`) dispatchen. Scope explizit festlegen. |
| C6 | „die DB" (Singular) hält Registry + `<ext>_meta` | Es gibt **zwei** DBs: project + global Store, je eigene Connection + eigenes `knowledge` (`src/index.ts:197`). SQLite kann **keine** FK über DB-Dateien. | Festlegen: Extensions binden **ausschließlich an den project-Store**. `ext.*`-Einträge dürfen nie in den global-Store geroutet werden. Siehe §5.2. |

**Konsequenz für die Roadmap:** Die Implementierung beginnt nicht bei „Registry-Tabelle", sondern bei **C1–C6** — in §14 als **Phase 0 (gating)** geführt, vor Phase 1 (Runtime). Ohne diese ist das Interface aus §4 nicht erfüllbar.

---

## 3. Architektur

### 3.1 Schichten

```
┌─────────────────────────────────────────────────────┐
│  Extensions (optional, pluggable)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ IdeaForge│  │ Billing  │  │ Future Extension │  │
│  │  4 Tools │  │  4 Tools │  │  n Tools         │  │
│  │  1 Table │  │  1 Table │  │  1 Table         │  │
│  └─────┬────┘  └─────┬────┘  └────────┬─────────┘  │
│        │             │                │             │
├────────┴─────────────┴────────────────┴─────────────┤
│  Extension Runtime (dieses PRD)                      │
│  ├── Registry (extensions-Tabelle)                   │
│  ├── Loader (Startup-Discovery)                      │
│  ├── Tool-Registration                               │
│  └── Frontmatter-Namespace-Manager                   │
├──────────────────────────────────────────────────────┤
│  agent-memory v2-lite Core                           │
│  ├── knowledge, entry_tags, connections (SQLite)     │
│  ├── 9 Core Tools                                    │
│  ├── Markdown Files + Frontmatter                    │
│  └── Git                                             │
└──────────────────────────────────────────────────────┘
```

### 3.2 Datenfluss

```
Extension registriert sich
  │
  ├── 1. CREATE TABLE <ext>_meta (entry_id FK → knowledge.id, ...)
  ├── 2. INSERT INTO extensions (name, version, installed_at)
  ├── 3. Extension-Tools werden in Tool-Registry aufgenommen
  └── 4. onInstall()-Hook läuft (optionale Indizes, Seed-Daten)

Extension-Tool wird aufgerufen (z.B. billing_import)
  │
  ├── 1. Core-Tool aufrufen (memory_store → knowledge-Eintrag)
  ├── 2. Extension-Tabelle beschreiben (billing_meta → INSERT)
  ├── 3. Frontmatter erweitern (ext.billing: {...})
  └── 4. Ergebnis zurückgeben

Extension wird deinstalliert
  │
  ├── 1. onUninstall()-Hook läuft
  ├── 2. DROP TABLE <ext>_meta
  ├── 3. ext.<name>:-Blöcke aus allen Frontmattern entfernen
  ├── 4. DELETE FROM extensions WHERE name = '<ext>'
  └── 5. Tools deregistrieren
```

---

## 4. Extension Interface

### 4.1 TypeScript-Definition

```typescript
// src/extensions/types.ts

export interface Extension {
  /** Eindeutiger Name (lowercase, keine Sonderzeichen) */
  name: string;

  /** Semver-Version */
  version: string;

  /** Kurzbeschreibung */
  description: string;

  /** Datenbank-Schema für die Extension-Tabelle */
  schema: ExtensionSchema;

  /** Extension-spezifische Tools */
  tools: ExtensionTool[];

  /** Wird nach CREATE TABLE aufgerufen */
  onInstall?: (ctx: ExtensionContext) => Promise<void>;

  /** Wird vor DROP TABLE aufgerufen */
  onUninstall?: (ctx: ExtensionContext) => Promise<void>;

  /** Wird bei jedem Startup aufgerufen */
  onStartup?: (ctx: ExtensionContext) => Promise<void>;

  /** Wird bei Versions-Mismatch aufgerufen (vor dem Registry-Bump, in Transaktion).
   *  Hier gehören ALTER TABLE / Daten-Migrationen hin. */
  onMigrate?: (
    ctx: ExtensionContext,
    versions: { fromVersion: string; toVersion: string },
  ) => Promise<void>;
}

export interface ExtensionSchema {
  /** Tabellenname (Konvention: <name>_meta) */
  table: string;

  /** Spalten der Extension-Tabelle */
  columns: ExtensionColumn[];
}

export interface ExtensionColumn {
  name: string;
  type: "TEXT" | "INTEGER" | "REAL";
  default?: string;
  notNull?: boolean;
}

export interface ExtensionTool {
  /** Tool-Name (Konvention: <ext>_<action>) */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: unknown, ctx: ExtensionContext) => Promise<unknown>;
}

export interface ExtensionContext {
  /** Zugriff auf die Extension-eigene Tabelle */
  db: ExtensionDB;

  /** Zugriff auf Core agent-memory Tools */
  memory: MemoryAPI;

  /** Pfad zum agent-memory Verzeichnis */
  memoryPath: string;

  /** Logger */
  log: Logger;
}

// ExtensionDB ist ein SCHMALER, scoped Wrapper über die Core-Connection —
// KEIN rohes bun:sqlite Database. Das Search-Modul exponiert diesen Accessor
// bewusst (§C4); das Runtime reicht NIE ein freies `Database` durch.
// Methoden sind SYNCHRON: bun:sqlite ist synchron (db.query(sql).run()/.get()/.all()).
// Konsequenz: Extension-Hooks rufen ctx.db.run(...) OHNE await auf.
export interface ExtensionDB {
  run(sql: string, params?: unknown[]): void;
  get<T>(sql: string, params?: unknown[]): T | undefined;
  all<T>(sql: string, params?: unknown[]): T[];
}

// MemoryAPI ist eine SCHMALE Fassade, die das Extension-Runtime über den
// Orchestrator (MemorySystem) baut — NICHT identisch mit MemorySystem selbst.
// Abbildung auf die realen Orchestrator-Methoden (src/index.ts):
//   store()   → memoryStore(input)  (gibt MemoryStoreOutput zurück; .id extrahieren)
//   search()  → search({query, ...filters})
//   read()    → read({ path })      ACHTUNG: Core liest per file_path, NICHT per id.
//                Die Fassade muss id→path auflösen (knowledge.file_path) ODER
//                Core um readById(id) erweitern (Core-Änderung, mit C-Liste bündeln).
//   update()  → update({ path, content, reason })  (kein Partial<Entry>; Core ersetzt Content)
//   connect() → memoryConnect({ source_id, target_id, type, note })
//   commit()  → commit({ message, type })
// Die Fassade kapselt diese Adapter, damit Extensions stabil bleiben, falls sich
// Core-Signaturen ändern. Abweichungen zur Core-API sind oben markiert.
export interface MemoryAPI {
  store(input: MemoryStoreInput): Promise<string>;
  search(query: string, filters?: SearchFilters): Promise<SearchResult[]>;
  read(id: string): Promise<MemoryEntry | null>;
  update(id: string, changes: Partial<MemoryEntry>): Promise<void>;
  connect(sourceId: string, targetId: string, type: ConnectionType, note?: string): Promise<void>;
  commit(message: string, scope?: string): Promise<void>;

  /** Schreibt/aktualisiert den ext.<name>-Block im Frontmatter eines Eintrags (C3).
   *  Schritte (vom Runtime über den Orchestrator implementiert):
   *    1. file_path aus knowledge per id auflösen (SELECT file_path WHERE id=?)
   *    2. Datei lesen, parseMarkdown() → frontmatter
   *    3. frontmatter["ext."+name] = data   (flacher Literal-Key, vom yaml-Parser erhalten)
   *    4. serializeMarkdown() + writeFileSync
   *    5. KEIN Core-Re-Index nötig — ext.* ist nicht im FTS/Vektor-Index;
   *       die strukturierte Kopie lebt in der <ext>_meta-Tabelle. */
  setExtensionData(id: string, name: string, data: Record<string, unknown>): Promise<void>;
  getExtensionData<T>(id: string, name: string): Promise<T | null>;
}
```

### 4.2 Beispiel: Billing Extension Definition

```typescript
// extensions/billing/index.ts
import type { Extension } from '../types';

export const billingExtension: Extension = {
  name: "billing",
  version: "1.0.0",
  description: "Automatischer Rechnungsabgleich",

  schema: {
    table: "billing_meta",
    columns: [
      { name: "provider",     type: "TEXT" },
      { name: "amount",       type: "REAL" },
      { name: "currency",     type: "TEXT",    default: "'EUR'" },
      { name: "booking_date", type: "TEXT" },
      { name: "period",       type: "TEXT" },
      { name: "invoice_nr",   type: "TEXT" },
      { name: "invoice_path", type: "TEXT" },
      { name: "status",       type: "TEXT",    default: "'expected'" },
      { name: "source_ref",   type: "TEXT" },
    ],
  },

  tools: [
    { name: "billing_import",   /* ... */ },
    { name: "billing_match",    /* ... */ },
    { name: "billing_status",   /* ... */ },
    { name: "billing_overview", /* ... */ },
  ],

  async onInstall(ctx) {
    ctx.db.run(`CREATE INDEX idx_bill_provider ON billing_meta(provider)`);
    ctx.db.run(`CREATE INDEX idx_bill_period ON billing_meta(period)`);
    ctx.db.run(`CREATE INDEX idx_bill_status ON billing_meta(status)`);
    ctx.log.info("Billing Extension installiert");
  },

  async onUninstall(ctx) {
    // Frontmatter bereinigen
    await cleanFrontmatterNamespace(ctx.memoryPath, "billing");
    ctx.log.info("Billing Extension deinstalliert");
  },
};
```

---

## 5. Registry

### 5.1 SQLite-Tabelle

```sql
CREATE TABLE IF NOT EXISTS extensions (
  name         TEXT PRIMARY KEY,
  version      TEXT NOT NULL,
  description  TEXT,
  table_name   TEXT NOT NULL,       -- z.B. "billing_meta"
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  config       TEXT DEFAULT '{}'    -- JSON, extension-spezifische Einstellungen
);
```

### 5.2 Extension-Tabellen

Jede Extension bekommt eine eigene Tabelle. Die einzige Constraint: Die Tabelle MUSS eine Spalte `entry_id` haben die als Foreign Key auf `knowledge.id` zeigt.

```sql
-- Wird automatisch vom Extension Runtime generiert
CREATE TABLE IF NOT EXISTS billing_meta (
  entry_id      TEXT PRIMARY KEY,
  provider      TEXT,
  amount        REAL,
  currency      TEXT DEFAULT 'EUR',
  booking_date  TEXT,
  period        TEXT,
  invoice_nr    TEXT,
  invoice_path  TEXT,
  status        TEXT DEFAULT 'expected',
  source_ref    TEXT,
  FOREIGN KEY (entry_id) REFERENCES knowledge(id) ON DELETE CASCADE
);
```

`ON DELETE CASCADE` stellt sicher: Wenn ein Knowledge-Eintrag gelöscht wird (`memory_forget`), werden auch die Extension-Metadaten automatisch entfernt.

> **Voraussetzung für CASCADE (sonst stille No-Ops):**
> 1. **Gleiche Connection.** `ON DELETE CASCADE` feuert nur, wenn `PRAGMA foreign_keys = ON` auf **derselben** Connection gesetzt ist, die das `DELETE` ausführt. Der Core setzt das Pragma in `initDatabase()` (`src/search/index.ts:305`). Das Extension-Runtime MUSS **genau diese** Connection wiederverwenden — kein eigenes `new Database(sqlitePath)` im Loader/Manager öffnen (Pragmas sind connection-scoped, Default OFF).
> 2. **Nur project-Store.** Da nur die project-DB ein `knowledge` mit passender `id` hält (§C6), darf die FK ausschließlich dort existieren.
> 3. **`setCustomSQLite`-Reihenfolge (macOS).** `Database.setCustomSQLite(...)` muss VOR dem ersten `Database` laufen (`src/search/index.ts:281`). Das Extension-Runtime darf kein `Database` konstruieren, bevor die Search-Factory initialisiert ist.
>
> **Konsistenz-Hinweis:** Die Beispiel-DDL in den Consumer-PRDs (Billing §3.2, IdeaForge §2.2) lässt `ON DELETE CASCADE` weg. Das ist unkritisch, weil die Tabelle vom Runtime aus `ExtensionSchema` **generiert** wird (§7.1) und die CASCADE-Klausel dort zentral anhängt — nicht aus der Consumer-DDL. Die Consumer-DDL ist illustrativ, nicht die Quelle der Wahrheit.

---

## 6. Loader (Startup-Flow)

### 6.1 Ablauf beim Startup

```typescript
// src/extensions/loader.ts

// Hinweis: `db` ist NICHT das rohe bun:sqlite Database, sondern der scoped
// ExtensionDB-Accessor, den das Search-Modul exponiert (§C4). Er wickelt die
// EINE Core-Connection des project-Stores (mit foreign_keys=ON), damit CASCADE
// und WAL-Setup intakt bleiben (§5.2). Das Runtime öffnet keine eigene Connection.
export async function loadExtensions(
  db: ExtensionDB,
  memoryPath: string,
  extensionModules: Extension[],
): Promise<LoadedExtension[]> {
  const loaded: LoadedExtension[] = [];

  // 1. Registry-Tabelle sicherstellen
  db.run(`CREATE TABLE IF NOT EXISTS extensions (...)`);

  // 2. Registrierte Extensions aus DB laden
  const registered = db.all<RegisteredExtension>(
    "SELECT * FROM extensions"
  );

  // 3. Jedes verfügbare Extension-Modul prüfen
  for (const ext of extensionModules) {
    const existing = registered.find(r => r.name === ext.name);

    if (!existing) {
      // Nicht installiert → Überspringen (kein Auto-Install)
      continue;
    }

    // Version-Check. Bei v1.0.0 existiert noch KEINE Vorversion → onMigrate ist
    // bewusst nur ein optionaler Stub (§4.1). Die transaktionale Migrations-
    // Maschinerie (from/to-Plumbing, Rollback) wird erst gebaut, wenn die erste
    // Schema-ändernde Folgeversion ansteht — nicht spekulativ in v1 (siehe §16.1).
    if (existing.version !== ext.version) {
      if (ext.onMigrate) {
        await ext.onMigrate(ctx, {
          fromVersion: existing.version,
          toVersion: ext.version,
        });
      }
      db.run(
        "UPDATE extensions SET version = ? WHERE name = ?",
        [ext.version, ext.name]
      );
    }

    // Context erstellen
    const ctx = createExtensionContext(db, ext, memoryPath);

    // Startup-Hook aufrufen
    if (ext.onStartup) {
      await ext.onStartup(ctx);
    }

    // Tools registrieren (Variante A: in CLI-Dispatch-Map, §9.1)
    loaded.push({
      extension: ext,
      tools: ext.tools,
      context: ctx,
    });
  }

  return loaded;
}
```

### 6.2 Extension Discovery

Extensions werden nicht automatisch entdeckt. Sie werden explizit in einer Konfigurationsdatei oder im Code registriert:

```typescript
// src/extensions/registry.ts

import { billingExtension } from './billing';
import { ideaforgeExtension } from './ideaforge';

/** Alle verfügbaren Extensions */
export const AVAILABLE_EXTENSIONS: Extension[] = [
  billingExtension,
  ideaforgeExtension,
  // Neue Extensions hier eintragen
];
```

Das ist bewusst explizit und nicht magisch (kein Ordner-Scanning, keine dynamischen Imports). Eine neue Extension hinzufügen = eine Zeile Code.

---

## 7. Install / Uninstall

### 7.1 Installation

```typescript
// src/extensions/manager.ts

export async function installExtension(
  db: ExtensionDB,   // scoped Accessor, kein rohes Database (C4)
  ext: Extension,
  memoryPath: string,
): Promise<void> {
  // 1. Prüfen ob schon installiert
  const existing = db.get(
    "SELECT name FROM extensions WHERE name = ?",
    [ext.name]
  );
  if (existing) {
    throw new Error(`Extension '${ext.name}' ist bereits installiert`);
  }

  // 2. Extension-Tabelle erstellen
  const columnDefs = ext.schema.columns.map(col => {
    let def = `${col.name} ${col.type}`;
    if (col.notNull) def += " NOT NULL";
    if (col.default) def += ` DEFAULT ${col.default}`;
    return def;
  }).join(",\n    ");

  db.run(`
    CREATE TABLE IF NOT EXISTS ${ext.schema.table} (
      entry_id TEXT PRIMARY KEY,
      ${columnDefs},
      FOREIGN KEY (entry_id) REFERENCES knowledge(id) ON DELETE CASCADE
    )
  `);

  // 3. In Registry eintragen
  db.run(
    `INSERT INTO extensions (name, version, description, table_name)
     VALUES (?, ?, ?, ?)`,
    [ext.name, ext.version, ext.description, ext.schema.table]
  );

  // 4. onInstall-Hook aufrufen
  if (ext.onInstall) {
    const ctx = createExtensionContext(db, ext, memoryPath);
    await ext.onInstall(ctx);
  }
}
```

### 7.2 Deinstallation

```typescript
export async function uninstallExtension(
  db: ExtensionDB,   // scoped Accessor, kein rohes Database (C4)
  ext: Extension,
  memoryPath: string,
): Promise<void> {
  // 1. Prüfen ob installiert
  const existing = db.get(
    "SELECT name FROM extensions WHERE name = ?",
    [ext.name]
  );
  if (!existing) {
    throw new Error(`Extension '${ext.name}' ist nicht installiert`);
  }

  // 2. onUninstall-Hook aufrufen
  if (ext.onUninstall) {
    const ctx = createExtensionContext(db, ext, memoryPath);
    await ext.onUninstall(ctx);
  }

  // 3. Extension-Tabelle löschen
  db.run(`DROP TABLE IF EXISTS ${ext.schema.table}`);

  // 4. Aus Registry entfernen
  db.run("DELETE FROM extensions WHERE name = ?", [ext.name]);

  // 5. Frontmatter bereinigen — memoryPath = PROJECT-Store-Root. Extensions binden
  //    per Invariante (§C6) nur an den project-Store, also existieren ext.<name>-Keys
  //    nie im global-Store; ein zusätzlicher global-Scan würde gegen einen durch C6
  //    ausgeschlossenen Zustand verteidigen und ist daher bewusst weggelassen.
  const cleaned = await cleanFrontmatterNamespace(memoryPath, ext.name);

  // 6. Bulk-Rewrite committen, sonst bleiben N geänderte .md im Working Tree und
  //    vermischen sich mit den Änderungen des Users (§12.1).
  if (cleaned > 0) {
    await memory.commit(`chore: uninstall extension ${ext.name}`, "extensions");
  }
}
```

> **Hinweis `glob`:** Das Beispiel nutzt `glob.sync(...)`, aber `glob` ist **keine** Projekt-Dependency (der Core verwendet `node:fs`/Bun-APIs). Implementierung mit Bun's `Glob` (`new Bun.Glob("**/*.md").scanSync(memoryPath)`) oder rekursivem `readdirSync` — keine neue Dependency einführen.

### 7.3 Frontmatter-Bereinigung

```typescript
// src/extensions/frontmatter.ts
// WICHTIG: Core nutzt das `yaml`-Paket + eigene parseMarkdown/serializeMarkdown
// (src/memory/parser.ts) — NICHT gray-matter/`matter` und NICHT `glob` (keine Deps).
import { parseMarkdown, serializeMarkdown } from "../memory/parser.ts";

export async function cleanFrontmatterNamespace(
  memoryPath: string,
  extensionName: string,
): Promise<number> {
  let cleaned = 0;

  // Alle Markdown-Dateien durchgehen (Bun.Glob, keine externe Dependency)
  const glob = new Bun.Glob("**/*.md");

  for (const file of glob.scanSync({ cwd: memoryPath, absolute: true })) {
    const content = await Bun.file(file).text();
    const { frontmatter, body } = parseMarkdown(content);

    // ext.<name> ist ein flacher Literal-Key (kein verschachteltes Objekt)
    const extKey = `ext.${extensionName}`;
    if (frontmatter[extKey] !== undefined) {
      delete frontmatter[extKey];
      await Bun.write(file, serializeMarkdown({ frontmatter, body }));
      cleaned++;
    }
  }

  return cleaned;
}
```

---

## 8. Frontmatter-Namespace

### 8.1 Konvention

Core-Felder stehen auf Root-Ebene. Extension-Felder unter `ext.<name>:`.

```yaml
---
# Core (agent-memory v2-lite)
id: txn-042
title: "Hetzner Cloud Server CX22"
type: transaction
tags:
  - billing/provider/hetzner
  - billing/period/2026-02
created: 2026-02-08
updated: 2026-02-08
connections:
  - target: txn-017
    type: related

# Extension: Billing
ext.billing:
  provider: Hetzner
  amount: 5.29
  currency: EUR
  booking_date: 2026-02-01
  period: 2026-02
  status: matched
  invoice_path: /invoices/hetzner/2026-02.pdf
---
```

### 8.2 Lesen und Schreiben

```typescript
// Extension-Daten aus Frontmatter lesen
function getExtensionData(frontmatter: Record<string, any>, extName: string) {
  return frontmatter[`ext.${extName}`] || null;
}

// Extension-Daten in Frontmatter schreiben
function setExtensionData(
  frontmatter: Record<string, any>,
  extName: string,
  data: Record<string, any>,
) {
  frontmatter[`ext.${extName}`] = data;
}
```

### 8.3 Regel: Extensions schreiben nie Core-Felder

Eine Extension darf `ext.<name>:` lesen und schreiben. Sie darf Core-Felder (id, title, type, tags, connections) nur über die MemoryAPI lesen. Schreibzugriff auf Core-Felder geht ausschließlich über Core-Tools (`memory_store`, `memory_update`).

### 8.4 Extension-eigene `type`-Werte (Typ-Registrierung)

Extensions nutzen eigene `knowledge.type`-Werte: Billing `transaction` + `provider`, IdeaForge `idea` + `synthesis`. **Im aktuellen Core ist `KnowledgeType` eine geschlossene Union** (§C1) — diese Werte würden zur Laufzeit brechen (`knowledgeTypeDir()`/`knowledgeToMemoryType()` sind `switch` ohne `default`).

Die Lösung gehört in die Core-Änderung C1. Das Extension-Interface ergänzt dazu ein optionales Feld, über das eine Extension ihre Typen + Verzeichnis-Mapping deklariert:

```typescript
export interface Extension {
  // ...name, version, schema, tools...

  /** Knowledge-Typen, die diese Extension einführt. Der Core registriert
   *  Verzeichnis + v1-MemoryType-Fallback, damit memoryStore(type) nicht bricht. */
  knowledgeTypes?: Array<{
    type: string;            // z.B. "transaction"
    dir: string;             // z.B. "episodic/transactions"
    v1Type: "semantic" | "episodic" | "procedural";  // Fallback für memories-Tabelle
    idPrefix: string;        // z.B. "txn" → IDs txn-001 (siehe C2)
  }>;
}
```

Solange C1 nicht umgesetzt ist, ist **keine** Extension lauffähig. Dies ist die zentrale Abhängigkeit, die §2.5 als Phase-0 markiert.

#### 8.4.1 C1-Registrierung: Call-Path & betroffene Core-Funktionen

C1 ist **kein** einzelnes Feld, sondern ein Core-Refactor: fünf Funktionen, die heute die geschlossene Union zur Compile-Zeit lesen, müssen stattdessen ein **Laufzeit-Registry** konsultieren. Der Core bekommt:

```typescript
// src/shared/knowledge-types.ts (neu) — mutable Registry, mit den 7 Kern-Typen geseedet
registerKnowledgeType(decl: { type: string; dir: string; v1Type: "semantic"|"episodic"|"procedural"; idPrefix: string }): void
```

**Diese 5 Funktionen müssen vom switch/const auf das Registry umgestellt werden** (sonst brechen Extension-Typen an je einer Stelle):

| Funktion | Datei | Heute | Nach C1 |
|---|---|---|---|
| `knowledgeTypeDir()` | `src/shared/utils.ts:76` | `switch` ohne default | Registry-Lookup `dir` |
| `knowledgeToMemoryType()` | `src/shared/utils.ts:96` | `switch` ohne default | Registry-Lookup `v1Type` |
| `TYPE_PREFIX` / `PREFIX_TO_TYPE` | `src/shared/utils.ts:8,19` | `const` Record | aus Registry abgeleitet |
| `getNextSequentialId()` | `src/search/index.ts:835` | nutzt `TYPE_PREFIX` | Registry-`idPrefix` (tolerant: `?? type`) |
| `rebuildIndex()` Typ-Gate | `src/index.ts:888` | hartes `KNOWLEDGE_TYPES`-Set | Registry-Keys (Kern + Extension) |

> **`rebuildIndex()` ist kritisch:** Das hartcodierte `KNOWLEDGE_TYPES`-Set (`src/index.ts:888`) lässt `isV2Lite` für `transaction`/`idea`/… **false** werden → diese Einträge werden bei `rebuild-index` **nicht** in die `knowledge`-Tabelle geschrieben, alle `JOIN <ext>_meta`-Queries (§10) brechen. Da §16.1 `rebuild-index` als Mitigation für dangling Connections empfiehlt, würde der empfohlene Recovery-Pfad sonst alle Extension-Einträge ent-indexieren. Das Typ-Gate MUSS aus dem Registry kommen.

**Wann wird registriert (Reihenfolge zwingend):**
1. Beim **Startup** für jede *installierte* Extension: `loadExtensions()` ruft `registerKnowledgeType()` für jede `ext.knowledgeTypes`-Deklaration, **bevor** der erste Tool-Call laufen kann.
2. Beim **Install**: `installExtension()` registriert die Typen **vor** `onInstall`, damit ein direkt folgender `memoryStore(type=...)` funktioniert.
3. Registry-Einträge **mergen** mit den 7 Kern-Typen, überschreiben sie nie. Doppelter `type` oder `idPrefix` zweier Extensions ⇒ Install-Fehler.

---

## 9. Tool-Registration

> **Entschieden (C5): Variante A — CLI-Subcommands.** Der aktuelle Core hat **keinen** Agent-SDK-/MCP-Tool-Host — der einzige Einstiegspunkt ist der CLI-`switch` (`src/cli.ts:160`). Für ein Single-User-System wäre ein eigener Tool-Host Overkill. Daher: Extension-Tools werden als CLI-Kommandos dispatcht (`agent-memory billing import --csv …`). Das Runtime registriert die Tools in einer Map, die der CLI-`switch` konsultiert — kein SDK nötig. Ein echter Agent-SDK/MCP-Host (Variante B, `buildToolDefinitions()`-Merge) ist als spätere Option in §16.2 dokumentiert, **nicht** Teil von v1.

### 9.1 CLI-Dispatch-Registrierung (Variante A)

```typescript
// src/extensions/tool-registry.ts
// Baut eine Map <tool-name> → handler, die der CLI-switch (src/cli.ts) konsultiert.
export function buildExtensionDispatch(
  loadedExtensions: LoadedExtension[],
): Map<string, (input: unknown) => Promise<unknown>> {
  const dispatch = new Map();
  for (const loaded of loadedExtensions) {
    for (const tool of loaded.tools) {
      dispatch.set(tool.name, (input: unknown) => tool.handler(input, loaded.context));
    }
  }
  return dispatch;
}
// CLI: default-case im switch prüft dispatch.get(command) und ruft den Handler
// mit den geparsten Flags als input.
```

### 9.1b (Spätere Option) Integration mit Agent SDK — Variante B

```typescript
// src/extensions/tool-registry.ts

export function buildToolDefinitions(
  coreTools: AgentTool[],
  loadedExtensions: LoadedExtension[],
): AgentTool[] {
  const allTools = [...coreTools];

  for (const loaded of loadedExtensions) {
    for (const tool of loaded.tools) {
      allTools.push({
        name: tool.name,
        description: `[${loaded.extension.name}] ${tool.description}`,
        input_schema: tool.inputSchema,
        handler: (input: unknown) => tool.handler(input, loaded.context),
      });
    }
  }

  return allTools;
}
```

### 9.2 Tool-Namenskonvention

| Konvention | Beispiel | Warum |
|---|---|---|
| `<ext>_<action>` | `billing_import` | Klar welche Extension das Tool gehört |
| Kein Prefix-Clash mit Core | `memory_*` ist reserviert | Keine Verwechslung |
| Lowercase, Underscore | `idea_store` | Konsistent mit Core-Tools |

---

## 10. Extension-Queries: JOIN mit Core

Extensions können ihre Tabelle mit der Core `knowledge`-Tabelle joinen:

```sql
-- Alle Hetzner-Buchungen die noch nicht gematched sind
SELECT k.id, k.title, k.created_at, b.amount, b.status
FROM knowledge k
JOIN billing_meta b ON k.id = b.entry_id
WHERE b.provider = 'Hetzner'
AND b.status = 'expected'
ORDER BY b.booking_date DESC

-- Alle IdeaForge-Ideen mit Status "active" und Urgency "now"
SELECT k.id, k.title, k.tags, i.status, i.urgency
FROM knowledge k
JOIN ideaforge_meta i ON k.id = i.entry_id
WHERE i.status = 'active'
AND i.urgency = 'now'

-- Cross-Extension: Buchungen die mit einer Idee verlinkt sind
SELECT k1.title as buchung, k2.title as idee, c.type
FROM connections c
JOIN knowledge k1 ON c.source_id = k1.id
JOIN knowledge k2 ON c.target_id = k2.id
JOIN billing_meta b ON k1.id = b.entry_id
JOIN ideaforge_meta i ON k2.id = i.entry_id
```

Core-Tabellen bleiben unverändert. Extensions fügen nur ihre eigenen Tabellen hinzu und joinen bei Bedarf.

---

## 11. CLI-Commands

### 11.1 Extension-Management

```bash
# Alle verfügbaren Extensions auflisten
agent-memory extensions list
# → billing (nicht installiert)
# → ideaforge (installiert, v1.0.0)

# Extension installieren
agent-memory extensions install billing

# Extension deinstallieren (mit Bestätigung)
agent-memory extensions uninstall billing
# → "Billing Extension deinstallieren? Tabelle billing_meta wird gelöscht.
#    Knowledge-Einträge bleiben erhalten. [y/N]"

# Extension-Status prüfen
agent-memory extensions status billing
# → Name: billing
# → Version: 1.0.0
# → Installiert: 2026-02-08
# → Tabelle: billing_meta (342 Einträge)
# → Tools: billing_import, billing_match, billing_status, billing_overview
```

---

## 12. Garantien

### 12.1 Was bei Deinstallation passiert

| Komponente | Bei Uninstall | Warum |
|---|---|---|
| Extension-Tabelle | **Gelöscht** (DROP TABLE) | Sauberes Aufräumen |
| `ext.<name>:` Frontmatter | **Entfernt** aus allen Dateien | Kein Datenmüll |
| Extension-Tools | **Deregistriert** | Nicht mehr aufrufbar |
| Registry-Eintrag | **Gelöscht** | Extension unbekannt |
| Knowledge-Einträge | **Bleiben** | Gehören dem Core |
| Connections | **Bleiben** | Gehören dem Core |
| Tags | **Bleiben** | Gehören dem Core |
| Git-History | **Bleibt** | Unveränderlich |
| Externe Dateien (z.B. /invoices/) | **Bleiben** | User entscheidet |

### 12.2 Was bei Installation passiert

| Komponente | Bei Install | Idempotent? |
|---|---|---|
| Extension-Tabelle | CREATE TABLE IF NOT EXISTS | Ja |
| Registry-Eintrag | INSERT | Nein (Fehler bei Duplikat) |
| onInstall-Hook | Wird aufgerufen | Extension muss idempotent sein |
| Bestehende Knowledge-Einträge | Unverändert | Ja |

### 12.3 Isolation

- Extensions können andere Extensions nicht beeinflussen
- Extensions können Core-Tabellen nicht modifizieren (kein ALTER TABLE auf knowledge)
- Extensions können nur ihre eigene `ext.<name>:`-Namespace schreiben
- Extensions erhalten DB-Zugriff nur auf ihre eigene Tabelle und lesend auf Core-Tabellen via MemoryAPI

---

## 13. Dateisystem-Layout

```
~/.agent-memory/
├── src/
│   ├── extensions/                     # Extension Runtime (dieses PRD)
│   │   ├── types.ts                    # Extension Interface
│   │   ├── loader.ts                   # Startup Discovery + Loading
│   │   ├── manager.ts                  # Install / Uninstall
│   │   ├── tool-registry.ts            # Tool-Registration
│   │   ├── frontmatter.ts              # Namespace-Management
│   │   └── registry.ts                 # Verfügbare Extensions (explizit)
│   │
│   ├── extensions/billing/             # Billing Extension
│   │   ├── index.ts                    # Extension-Definition
│   │   ├── tools/                      # Tool-Handler
│   │   │   ├── billing-import.ts
│   │   │   ├── billing-match.ts
│   │   │   ├── billing-status.ts
│   │   │   └── billing-overview.ts
│   │   ├── sanitizer.ts               # CSV-Bereinigung
│   │   └── providers.ts               # Anbieter-Erkennung
│   │
│   ├── extensions/ideaforge/           # IdeaForge Extension
│   │   ├── index.ts
│   │   └── tools/
│   │       ├── idea-store.ts
│   │       ├── idea-status.ts
│   │       ├── idea-resurface.ts
│   │       └── idea-digest.ts
│   │
│   └── ...                             # Core agent-memory Module
│
├── tests/
│   └── extensions/
│       ├── loader.test.ts
│       ├── manager.test.ts
│       ├── frontmatter.test.ts
│       └── billing/
│           └── sanitizer.test.ts
│
└── ...
```

---

## 14. Implementation Roadmap

### Phase 0: Core-Voraussetzungen C1–C6 (gating, 3-5 Tage)

> **Muss zuerst.** Ohne diese ist das Interface aus §4 nicht erfüllbar (§2.5).
- **C1** — Laufzeit-Registry für `knowledge.type` (§8.4.1): 5 Core-Funktionen vom `switch`/`const` aufs Registry umstellen (`knowledgeTypeDir`, `knowledgeToMemoryType`, `TYPE_PREFIX`, `getNextSequentialId`, `rebuildIndex`-Typ-Gate)
- **C3** — `setExtensionData()`/`getExtensionData()` für `ext.<name>`-Frontmatter im Orchestrator
- **C4** — `searchIndex.extensionDb()` Accessor + Wiring in `createMemorySystem()`
- **C6** — Extensions an project-Store binden (Invariante festschreiben)
- C2/C5 sind bereits entschieden (sequenzielle IDs / Variante A) — keine Core-Arbeit
- Tests: Extension-`type` überlebt store + rebuild-index

> **Milestone:** Core kann Extension-Typen + `ext.*`-Frontmatter ohne Bruch verarbeiten.

### Phase 1: Runtime (3-4 Tage)

- Extension Interface (`types.ts`)
- Registry-Tabelle (`extensions`)
- Manager: `installExtension()`, `uninstallExtension()`
- Loader: `loadExtensions()` beim Startup
- Frontmatter: `cleanFrontmatterNamespace()`
- CLI: `extensions list`, `extensions install`, `extensions uninstall`
- Tests für alle Komponenten

> **Milestone:** Extensions können installiert und deinstalliert werden. Sauber, keine Rückstände.

### Phase 2: Tool-Registration — CLI-Dispatch (2 Tage)

> Variante A (§9, entschieden).
- `buildExtensionDispatch()` baut die Tool-Map; CLI-`switch` konsultiert sie im default-case
- `ExtensionContext` mit `ExtensionDB` + MemoryAPI Zugriff
- Tests: Extension-Tools werden korrekt geladen und über die CLI ausgeführt

> **Milestone:** Extension-Tools sind als CLI-Subcommands aufrufbar.

### Phase 3: Erste Extension (1 Woche)

- IdeaForge oder Billing als erste echte Extension implementieren
- Validiert das Interface gegen einen echten Use Case
- Anpassungen am Interface falls nötig

> **Milestone:** Erste Extension läuft auf dem Extension System.

**Gesamt: ~2,5–3 Wochen** (Phase 0: 3–5 Tage Core-Changes + Phasen 1–3: ~2 Wochen)

---

## 15. Erfolgskriterien

| Metrik | Ziel |
|---|---|
| Installation einer Extension | < 1 Sekunde |
| Deinstallation sauber | Keine Rückstände in DB oder Frontmatter |
| Startup mit 3 Extensions | < 500ms zusätzliche Ladezeit |
| Neue Extension hinzufügen | < 1 Stunde für leere Extension mit Schema + 1 Tool |
| Core-Code-Änderung für neue Extension | 1 Zeile (Import in registry.ts) |
| Extension-Isolation | Extension kann andere Extensions nicht beeinflussen |
| CASCADE Delete | Extension-Daten werden bei knowledge-Löschung mitgelöscht |

---

## 16. Was dieses PRD NICHT abdeckt

- **Extension-spezifische Logik:** Was IdeaForge oder Billing intern tun, steht in deren PRDs
- **Marketplace / Remote Extensions:** Keine dynamische Installation. Extensions sind lokale Module.
- **Extension-Konfiguration UI:** Kein Web-Interface für Einstellungen. Config lebt in der DB.
- **Extension-zu-Extension-Kommunikation:** Extensions kennen sich nicht. Cross-Extension-Queries laufen über Core-Tabellen.

### 16.1 Bekannte Einschränkungen (vom Core geerbt)

- **Dangling Inverse-Connections bei `memory_forget`.** Connections werden dual gespeichert (SQLite `connections` + Frontmatter beider Dateien). Der CASCADE räumt `<ext>_meta` auf, aber das Löschen eines Eintrags lässt **inverse Connection-Refs im Frontmatter anderer Dateien** zurück, bis ein Rebuild läuft. Extensions verstärken das (Billing `txn → provider`, IdeaForge `synthesis → cluster-member`). Pre-existing Core-Issue; Mitigation: `rebuild-index` bereinigt verwaiste Refs.
- **Synchrones Embedding im Store-Pfad.** `memory_store` embedded synchron. `billing_import` über hunderte Zeilen (Jahres-/Multi-Konto-Import) blockiert den aufrufenden Handler ohne Fortschritts-Feedback. Für übliche Monats-CSVs (10–30 Zeilen) unkritisch; große Importe sollten gebatcht oder mit Fortschrittsmeldung versehen werden.
- **Unbegrenztes `<ext>_meta`-Wachstum.** Kein Archival von Extension-Rows. Bei Billing-10-Jahres-Aufbewahrung (niedrige Hunderte/Jahr) und Ideen (~100/Monat) für SQLite trivial — kein Handlungsbedarf, nur dokumentiert.

### 16.2 Bewusst auf „später" verschoben (nicht v1)

Diese Punkte sind für ein Single-User-System v1 Over-Engineering und werden erst bei Bedarf gebaut:

- **Variante B — Agent-SDK/MCP-Tool-Host** (§9.1b). v1 nutzt CLI-Dispatch. Ein echter Host lohnt erst, wenn das LLM Extension-Tools autonom orchestrieren soll.
- **Echte Migrations-Maschinerie für `onMigrate`** (transaktionaler Rollback, from/to-Plumbing). Erst nötig bei der ersten schema-ändernden Folgeversion einer Extension — bei v1.0.0 existiert keine Vorversion.
- **Single-Flight-Locks für `billing_match`.** v1 nutzt eine dokumentierte Regel (Cron = einziger geplanter Writer) + atomares write-temp-then-rename. Echte Locks erst bei mehreren parallelen Trigger-Quellen (Multi-Device).

---

*Extension System PRD v1.0 – fitznerIO AI Services – Februar 2026*
