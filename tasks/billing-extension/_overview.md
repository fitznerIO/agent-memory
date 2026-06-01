# Billing Extension — Task-Aufteilung

> Quelle: `Billing-Extension-PRD.md` (gehärtet via converge-loop, 2026-06-01)
> Automatischer Rechnungsabgleich als agent-memory Extension.

## Projektbeschreibung

Kontoauszüge (CSV) importieren, Buchungen Anbietern zuordnen, Rechnungen per Playwright laden, abgleichen, fehlende melden, über Jahre Überblick behalten. Sensible Daten werden vor dem ersten LLM-Call deterministisch entfernt (Sanitizer). Eigene Tabelle `billing_meta`, eigene `type`-Werte `transaction`/`provider`.

**Voraussetzungen (beide zwingend):** agent-memory Core implementiert UND das Extension System (`tasks/extension-system/`, inkl. Phase-0 Core-Changes C1–C6) implementiert. Insbesondere C1 (offene `type`-Werte) und sequenzielle IDs (`txn-NNN`/`prov-NNN`) sind Blocker.

## Task-Tabelle

| # | Task | Depends on | Status |
|---|------|-----------|--------|
| 001 | Phase 1: Extension-Registrierung + Schema + Sanitizer | extension-system/007 | Pending |
| 002 | Phase 1: CSV-Parser (Bank-Formate) + Anbieter-Erkennung + billing_import | 001 | Pending |
| 003 | Phase 2: Playwright-Download + PDF-Betrag + billing_match + billing_status | 002 | Pending |
| 004 | Phase 3: billing_overview + Telegram-Interface + Digest + Wiederkehrende/Erwartungs-Check | 002, 003 | Pending |
| 005 | Phase 4: Polish — weitere Formate/Downloader, Jahresübersicht, Error-Handling, Tests | 003, 004 | Pending |

## Abhängigkeitsbeschreibung

Kette folgt der PRD-Roadmap (§14): **001 → 002 → 003 → 004 → 005.**
- 001 registriert die Extension (Schema `billing_meta`, `knowledgeTypes`, Indizes) und liefert den Sanitizer (sicherheitskritisch, eigenständig testbar).
- 002 baut Import: CSV-Parser + Anbieter-Erkennung + `billing_import`-Tool (nutzt Sanitizer aus 001).
- 003 baut Download/Matching auf den importierten Buchungen auf.
- 004 baut Übersicht + Telegram auf Import (002) und Match (003) auf.
- 005 ist Polish/Härtung über allem.

Hängt vollständig an `tasks/extension-system/task_007.md` (validiertes Fundament).
