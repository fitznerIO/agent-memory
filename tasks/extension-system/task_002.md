# Task 002: Phase 0 — C3 ext.*-Frontmatter-API + C4 extensionDb-Accessor & Wiring + C6 Invariante

## Dependencies
- Requires: 001

## Description
(aus Ext-PRD §2.5 C3/C4/C6, §4.1, §5.2)

**C3 — ext.*-Schreib-API:** Es gibt keine Core-API, die `ext.*`-Keys schreibt. Der `yaml`-Parser erhält unbekannte Keys beim Round-Trip, aber `MemoryMetadata` kennt sie nicht. Der Orchestrator braucht:

```typescript
setExtensionData(id: string, name: string, data: Record<string, unknown>): Promise<void>;
getExtensionData<T>(id: string, name: string): Promise<T | null>;
```

Schritte von `setExtensionData` (über den Orchestrator):
1. `file_path` aus `knowledge` per `id` auflösen (`SELECT file_path WHERE id=?`)
2. Datei lesen, `parseMarkdown()` → frontmatter
3. `frontmatter["ext."+name] = data` (flacher Literal-Key, vom yaml-Parser erhalten)
4. `serializeMarkdown()` + `writeFileSync`
5. KEIN Core-Re-Index nötig — `ext.*` ist nicht im FTS/Vektor-Index; die strukturierte Kopie lebt in der `<ext>_meta`-Tabelle.

**C4 — extensionDb-Accessor:** Das `Database`-Objekt wird innerhalb der Search-Factory erzeugt und nie nach außen gereicht (`src/search/index.ts:294`). `MemorySystem` hat kein `db`. Modul-Isolation (CLAUDE.md) verbietet Cross-Modul-Zugriff. Das Search-Modul exponiert einen schmalen Accessor auf dem `SearchIndex`-Interface (`searchIndex.extensionDb()` → `ExtensionDB`, scoped auf Extension-Tabellen + lesend auf Core). Integrationspunkt: `createMemorySystem()` (`src/index.ts:188`) ruft nach dem Bau des `project`-Stores und vor dem `return`: `loadExtensions(project.searchIndex.extensionDb(), config.baseDir, AVAILABLE_EXTENSIONS)`. `src/index.ts` bleibt einziger Integrationspunkt.

`ExtensionDB` ist SYNCHRON (bun:sqlite ist synchron): `run/get/all` ohne await.

**CASCADE-Voraussetzungen (§5.2):** `ON DELETE CASCADE` feuert nur, wenn `PRAGMA foreign_keys = ON` auf derselben Connection gesetzt ist, die das `DELETE` ausführt. Der Core setzt das Pragma in `initDatabase()` (`src/search/index.ts:305`). Das Extension-Runtime MUSS genau diese Connection wiederverwenden — kein eigenes `new Database(...)`. `setCustomSQLite(...)` muss vor dem ersten `Database` laufen (`src/search/index.ts:281`).

**C6 — project-Store-Bindung:** Es gibt zwei DBs (project + global, `src/index.ts:197`). SQLite kann keine FK über DB-Dateien. Invariante festschreiben: Extensions binden ausschließlich an den project-Store; `ext.*`-Einträge dürfen nie in den global-Store geroutet werden.

**Grün-bleiben an der Task-Grenze:** Der Loader (`loadExtensions`) wird erst in Task 005 gebaut. Damit der Tree nach Task 002 kompiliert und alle Tests grün bleiben, liefert Task 002 einen **No-op-Stub** `loadExtensions()` (gibt leeres `LoadedExtension[]` zurück) bzw. guarded den Aufruf, wenn `AVAILABLE_EXTENSIONS` leer ist. Task 005 ersetzt den Stub durch die echte Implementierung. So gibt es keinen kaputten Zwischenzustand.

## Expected Outcome
- `setExtensionData()` / `getExtensionData()` auf dem Orchestrator implementiert; Round-Trip erhält `ext.<name>`-Block.
- `searchIndex.extensionDb()` liefert ein `ExtensionDB`, das die EINE project-Connection (mit `foreign_keys=ON`) wrappt — kein rohes `Database`.
- `createMemorySystem()` ruft `loadExtensions(...)` am benannten Wiring-Punkt (nach project-Store, vor return).
- C6-Invariante im Code/Doc verankert (Extension-Bindung nur project).
- Bestehende Tests grün; ein neuer Test deckt `setExtensionData`-Round-Trip ab.

## Agent Context
Baut auf Task 001 (Registry) auf. Stellt die zwei fehlenden Erweiterungspunkte bereit, die jede Extension braucht: `ext.*`-Frontmatter schreiben (C3) und scoped DB-Zugriff über den Orchestrator (C4), plus die project-Store-Invariante (C6). Damit ist Phase 0 abgeschlossen und das Interface aus §4 erfüllbar.
