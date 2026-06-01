# Extension System — Task-Aufteilung

> Quelle: `Agent-Memory-Extension-System-PRD.md` (gehärtet via converge-loop, 2026-06-01)
> Fundament-Schicht für die Extensions Billing und IdeaForge.

## Projektbeschreibung

Plugin-Infrastruktur für agent-memory: Extensions bekommen eine eigene SQLite-Tabelle (FK auf `knowledge.id`, `ON DELETE CASCADE`) und einen eigenen Frontmatter-Namespace (`ext.<name>:`), ohne das Core-Schema zu verändern. Installier-/deinstallierbar ohne Datenmüll.

**Zentrale Erkenntnis aus der Härtung:** Das Interface ist NICHT ohne Core-Änderungen erfüllbar. Phase 0 (C1–C6) ist gating und kommt vor jeder Runtime-Arbeit. Danach Runtime (Phase 1), CLI-Tool-Dispatch (Phase 2, Variante A — kein Agent-SDK-Host), Validierung (Phase 3).

## Task-Tabelle

| # | Task | Depends on | Status |
|---|------|-----------|--------|
| 001 | Phase 0: C1 — Runtime-KnowledgeType-Registry | None | Pending |
| 002 | Phase 0: C3 ext.*-Frontmatter-API + C4 extensionDb-Accessor & Wiring + C6 Invariante | 001 | Pending |
| 003 | Phase 1: Extension-Interface (types.ts) + Registry-Tabelle | 002 | Pending |
| 004 | Phase 1: Manager (install/uninstall) + Frontmatter-Cleanup | 003 | Pending |
| 005 | Phase 1: Loader (Startup-Discovery) + ExtensionContext + MemoryAPI-Facade | 003, 004 | Pending |
| 006 | Phase 2: CLI-Commands + Tool-Dispatch (Variante A) | 005 | Pending |
| 007 | Phase 3: Validierung — Referenz-Extension + Tests | 006 | Pending |

## Abhängigkeitsbeschreibung

Strikte Kette: **001 → 002 → 003 → {004, 005} → 006 → 007.**
- 001 (C1-Registry) ist die Wurzel: ohne offenen Typ-Mechanismus bricht jeder Extension-`type` zur Laufzeit.
- 002 ergänzt die Schreib-/DB-Zugriffspunkte (C3/C4) und die project-Store-Bindung (C6).
- 003 liefert die Typ-Verträge (Interface) + Registry-Tabelle, auf denen 004 (Manager) und 005 (Loader/Context) aufsetzen.
- 005 hängt zusätzlich an 004, weil der Loader die Frontmatter-Cleanup-Funktion und die Manager-Logik referenziert.
- 006 (CLI/Dispatch) braucht den geladenen Zustand aus 005.
- 007 validiert das Gesamtsystem End-to-End mit einer minimalen Referenz-Extension.

Die Extensions **Billing** (`tasks/billing-extension/`) und **IdeaForge** (`tasks/ideaforge-extension/`) hängen vollständig an Task 007 dieses Ordners.
