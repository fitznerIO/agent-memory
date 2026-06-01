# Task 005: Phase 1 — Loader (Startup-Discovery) + ExtensionContext + MemoryAPI-Facade

## Dependencies
- Requires: 003, 004

## Description
(aus Ext-PRD §6.1, §4.1, §8.4.1)

**loadExtensions** (`src/extensions/loader.ts`, `db: ExtensionDB`):
1. Registry-Tabelle sicherstellen.
2. Registrierte Extensions aus DB laden.
3. Pro verfügbarem Extension-Modul (`AVAILABLE_EXTENSIONS`): wenn nicht in Registry → überspringen (kein Auto-Install).
4. `knowledgeTypes` für jede installierte Extension registrieren (vor erstem Tool-Call — siehe §8.4.1 Reihenfolge).
5. Versions-Check: bei Mismatch optional `onMigrate(ctx, {fromVersion, toVersion})`, dann Registry-Version bumpen. (Die transaktionale Migrations-Maschinerie ist v1 bewusst nur Stub — keine Vorversion existiert.)
6. `ExtensionContext` erstellen, `onStartup` aufrufen, Tools sammeln.

**ExtensionContext** (`createExtensionContext`): `db` (ExtensionDB, scoped), `memory` (MemoryAPI-Facade), `memoryPath`, `log`.

**MemoryAPI-Facade** — schmale Fassade über den Orchestrator (NICHT identisch mit `MemorySystem`). Abbildung:
- `store()` → `memoryStore(input)` (gibt `MemoryStoreOutput`; `.id` extrahieren)
- `search()` → `search({query, ...filters})`
- `read()` → `read({ path })` — Core liest per `file_path`, nicht per id → Fassade löst id→path via `SELECT file_path FROM knowledge WHERE id=?` auf (gleiche Auflösung wie `setExtensionData` Schritt 1, Task 002)
- `update()` → `update({ path, content, reason })`
- `connect()` → `memoryConnect({ source_id, target_id, type, note })`
- `commit()` → `commit({ message, type })`
- `setExtensionData()` / `getExtensionData()` → aus Task 002

## Expected Outcome
- `loadExtensions()` lädt nur installierte Extensions, registriert deren `knowledgeTypes` vor dem ersten Tool-Call, ruft `onStartup`, sammelt Tools.
- `ExtensionContext` mit funktionierendem `db` + `memory` + `memoryPath` + `log`.
- `MemoryAPI`-Facade implementiert; `read()` löst id→path korrekt auf.
- `onMigrate` als optionaler Stub aufrufbar (kein Plumbing in v1).
- Tests: Loader lädt Referenz-Extension korrekt; Context-Zugriffe funktionieren; nicht-installierte Module werden übersprungen.

## Agent Context
Hängt an Task 003 (Interface) und Task 004 (Manager/Cleanup). Verdrahtet die Startup-Discovery und stellt den `ExtensionContext` samt `MemoryAPI`-Facade bereit, über den Extension-Tools mit dem Core reden. Wird in `createMemorySystem()` am Wiring-Punkt aus Task 002 aufgerufen.
