# Task 004: Phase 1 — Manager (install/uninstall) + Frontmatter-Cleanup

## Dependencies
- Requires: 003

## Description
(aus Ext-PRD §7.1, §7.2, §7.3, §5.2)

**installExtension** (`src/extensions/manager.ts`, Signatur `db: ExtensionDB`):
1. Prüfen ob schon installiert (Fehler bei Duplikat).
2. Extension-Tabelle aus `ext.schema.columns` generieren — `entry_id TEXT PRIMARY KEY` + Spalten + `FOREIGN KEY (entry_id) REFERENCES knowledge(id) ON DELETE CASCADE` (die CASCADE-Klausel hängt der Runtime zentral an, nicht die Consumer-DDL).
3. In Registry eintragen (`INSERT`).
4. `knowledgeTypes` registrieren (vor `onInstall`).
5. `onInstall`-Hook aufrufen.

**uninstallExtension** (Signatur `db: ExtensionDB`):
1. Prüfen ob installiert.
2. `onUninstall`-Hook.
3. `DROP TABLE IF EXISTS <table>`.
4. `DELETE FROM extensions WHERE name = ?`.
5. Frontmatter bereinigen — `memoryPath` = project-Store-Root. Die C6-Invariante schließt `ext.<name>`-Keys im global-Store aus; ein global-Scan ist daher bewusst weggelassen.
6. Bulk-Rewrite committen (`memory.commit("chore: uninstall extension <name>", "extensions")`), sonst bleiben N geänderte .md im Working Tree.

**cleanFrontmatterNamespace** (`src/extensions/frontmatter.ts`): Core nutzt das `yaml`-Paket + eigene `parseMarkdown`/`serializeMarkdown` (`src/memory/parser.ts`) — NICHT gray-matter/`matter` und NICHT `glob` (keine Deps). Implementierung mit `Bun.Glob("**/*.md").scanSync({cwd: memoryPath, absolute: true})`; `ext.<name>` ist ein flacher Literal-Key.

**Idempotenz (§12.2):** `CREATE TABLE IF NOT EXISTS` idempotent; Registry-`INSERT` nicht (Fehler bei Duplikat); `onInstall` muss idempotent sein.

## Expected Outcome
- `installExtension()`/`uninstallExtension()` funktionieren end-to-end gegen `ExtensionDB`.
- Extension-Tabelle wird mit `ON DELETE CASCADE` generiert; bei `memory_forget` werden `<ext>_meta`-Rows mitgelöscht (CASCADE-Voraussetzungen aus Task 002 erfüllt).
- `cleanFrontmatterNamespace()` entfernt `ext.<name>`-Blöcke via `Bun.Glob` + `parseMarkdown`/`serializeMarkdown`, ohne neue Dependency.
- Uninstall committet den Frontmatter-Bulk-Diff.
- Tests: Install/Uninstall sauber, keine Rückstände in DB oder Frontmatter; CASCADE-Delete verifiziert.

## Agent Context
Baut auf das Interface + die Registry-Tabelle (Task 003) auf. Liefert die Install/Uninstall-Lifecycle-Logik und die Frontmatter-Bereinigung. Der Loader (Task 005) referenziert `cleanFrontmatterNamespace` und die Manager-Funktionen.
