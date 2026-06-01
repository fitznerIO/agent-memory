# IdeaForge Extension — Task-Aufteilung

> Quelle: `IdeaForge-Extension-PRD-v1.1.md` (gehärtet via converge-loop, 2026-06-01)
> Autonomous Second Brain als agent-memory Extension.

## Projektbeschreibung

Ideen über Telegram erfassen (Text/Voice/URL/Screenshot/YouTube), klassifizieren, mit Status-Lifecycle versehen (unprocessed → active → archived/project), Cluster erkennen und über einen täglichen Resurface-Digest wieder vorlegen, damit Ideen nicht vergessen werden. Eigene Tabelle `ideaforge_meta`, eigene `type`-Werte `idea`/`synthesis`.

**Voraussetzungen (beide zwingend):** agent-memory Core implementiert UND das Extension System (`tasks/extension-system/`, inkl. Phase-0 Core-Changes C1–C6). Insbesondere C1 (offener `type`-Wert `idea`/`synthesis`) ist Blocker.

## Task-Tabelle

| # | Task | Depends on | Status |
|---|------|-----------|--------|
| 001 | Phase 1: Extension-Registrierung + Schema + idea_store + idea_status + Telegram-Intake (Text/URL) | extension-system/007 | Pending |
| 002 | Phase 2: Pre-Processing (Voice/YouTube/Screenshot) + Research Agent | 001 | Pending |
| 003 | Phase 3: idea_resurface + idea_digest + Cluster-Detection + Cron + Telegram-Buttons | 001 | Pending |
| 004 | Phase 4: Polish — konfigurierbar, Duplicate Detection, Multi-Idea-Splitting, E2E-Tests | 002, 003 | Pending |

## Abhängigkeitsbeschreibung

Kette folgt der PRD-Roadmap (§9): **001 → {002, 003} → 004.**
- 001 registriert die Extension (Schema, `knowledgeTypes`, Indizes), liefert `idea_store` (Wrapper um `memory_store` + Haiku-Klassifizierung), `idea_status` und den Telegram-Intake für Text/URL.
- 002 (Pre-Processing) und 003 (Resurface) hängen beide nur an 001 und sind unabhängig voneinander — können parallel laufen.
- 004 ist Polish über beidem.

Hängt vollständig an `tasks/extension-system/task_007.md` (validiertes Fundament).
