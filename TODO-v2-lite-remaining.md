# v2-lite: Verbleibende Features

Erstellt nach Gap-Analyse PRD vs. Implementierung. Stand: 2026-02-09.
Branch `feature/v2-lite` wurde in `main` gemerged.

> **Status: DONE** — Alle 3 Features implementiert auf Branch `feature/v2-lite-remaining`.
> Commits: `e41988e`, `e293529`, `ac91ba2`, `2f31c03` (code review fixes).

---

## 1. CLI `rebuild-index` Command (PRD 6.3) ✅

**Prioritaet:** Hoch (Blocker nach Embedding-Modellwechsel)

### Kontext

Das Embedding-Modell wurde von `Xenova/all-MiniLM-L6-v2` auf `Xenova/paraphrase-multilingual-MiniLM-L12-v2` gewechselt. Bestehende Embeddings sind inkompatibel. Es gibt keine Moeglichkeit, den Index ueber die CLI neu aufzubauen.

`searchIndex.rebuild()` existiert in `src/search/index.ts`, baut aber nur FTS neu auf. Embeddings gehen verloren, weil sie nicht aus den Markdown-Dateien rekonstruiert werden koennen — sie muessen neu berechnet werden.

### Was fehlt

1. **Vollstaendiger Rebuild** in `src/search/index.ts`: Alle Markdown-Files von Disk lesen, neu embedden (ueber EmbeddingEngine), in FTS + vec-Table + knowledge/entry_tags/connections indexieren.
2. **CLI-Command** `rebuild-index` in `src/cli.ts`
3. **Tests**: Unit-Test fuer vollstaendigen Rebuild, E2E-Test ueber CLI

### PRD-Referenz

> Abschnitt 6.3: "Unveraendert aus v1: Wenn der Index korrupt ist, wird er aus den Markdown-Frontmatter komplett regeneriert."
> ```bash
> agent-memory rebuild-index
> ```

---

## 2. Consolidation Agent (PRD 9) ✅

**Prioritaet:** Mittel

### Kontext

Der Consolidation Agent entscheidet am Session-Ende, was mit Session-Notes passiert. Aktuell werden Notes einfach geschrieben, aber nie konsolidiert.

### Was fehlt

1. **Einzel-Datei-Erstellung**: Wenn eine Session-Note gross genug ist (Entscheidung, Incident, Pattern), soll der Consolidation Agent eine Einzeldatei via `memory_store` erstellen statt an eine Sammel-Datei anzuhaengen.

   Entscheidungskriterien aus dem PRD:
   - Entscheidung mit Begruendung -> eigene Datei in `semantic/decisions/`
   - Geloester Bug/Incident -> eigene Datei in `episodic/incidents/`
   - Neuer gelernter Workflow -> eigene Datei in `procedural/`
   - Kleiner Fakt -> an bestehende Entity-Datei anhaengen

2. **Tag-Konsistenz**: Pruefen ob verwendete Tags konsistent mit bestehenden Tags sind und normalisieren (z.B. `tech/AI` -> `tech/ai`).

3. **v1-Consolidation** (Dedup, Conflict Resolution, Subsumption): Pruefen ob diese Features aus v1 existieren und funktionieren. Falls nicht, implementieren.

### PRD-Referenz

> Abschnitt 9.1: "Die v1 Consolidation (Dedup, Conflict Resolution, Subsumption, Forgetting) bleibt. Zusaetzlich: Einzel-Datei-Erstellung."
> Abschnitt 9.2: "Kein Connection Discovery bei Consolidation (passiert schon bei memory_store). Kein Maturity-Review. Kein Pattern-Extraction. Kein Concept-Maintenance."

### Hinweis

Der PRD sagt explizit, dass Consolidation schlank bleiben soll. Kein LLM-Call, kein Connection Discovery (das passiert schon bei `memory_store`). Es ist im Wesentlichen eine Heuristik-basierte Entscheidung anhand von Content-Laenge und Typ.

---

## 3. Decay / Lifecycle Management (PRD 10) ✅

**Prioritaet:** Niedrig (wird erst bei grosser Wissensbasis relevant)

### Kontext

Schema-Felder (`last_accessed`, `access_count`) existieren in der `knowledge`-Tabelle, werden aber nie aktualisiert. `getActiveConnectionCount()` existiert als Prepared Statement, wird aber nirgends genutzt.

### Was fehlt

1. **Access-Tracking**: `last_accessed` und `access_count` bei `memory_read` und `memory_search` aktualisieren. Betrifft `src/index.ts` (read, search Methoden) und ggf. `src/search/index.ts` (Update-Queries).

2. **Importance-weighted Decay**: Logik die selten zugegriffene Eintraege als Archive-Kandidaten identifiziert. Kein automatisches Loeschen — nur Meldung an den Agent im Consolidation-Run.

3. **Connection-Awareness**: Vor Archivierung pruefen ob aktive Connections existieren (Query existiert schon: `getActiveConnectionCount()`). Eintraege mit aktiven Connections (ausser `supersedes`/`superseded_by`) nicht automatisch archivieren, sondern als "connected but stale" melden.

### PRD-Referenz

> Abschnitt 10.1: "Access-Tracking: last_accessed und access_count pro Eintrag. Importance-weighted Decay: Selten zugegriffene Eintraege werden Archive-Kandidaten."
> Abschnitt 10.2: "Wenn der Eintrag aktive Connections hat (ausser superseded_by), wird er nicht automatisch archiviert. Stattdessen wird er im naechsten Consolidation-Run als 'connected but stale' gemeldet."

---

## Implementierungs-Prompt

Nutze den folgenden Prompt um eine neue Session zu starten:

```
Du bist ein Senior TypeScript-Entwickler, spezialisiert auf Bun-Runtime, SQLite (bun:sqlite) und CLI-Tools. Du arbeitest am Agent Memory System — einem persistenten Wissensspeicher fuer KI-Agenten.

Deine Aufgabe: Implementiere die verbleibenden v2-lite Features aus `TODO-v2-lite-remaining.md`.

Rahmenbedingungen:
- Lies zuerst CLAUDE.md fuer Architektur, Patterns und Befehle
- Lies TODO-v2-lite-remaining.md fuer die Feature-Beschreibungen
- Lies den PRD (Agent-Knowledge-Memory-v2-lite-PRD.md) fuer zusaetzlichen Kontext bei Unklarheiten
- Erstelle einen neuen Branch `feature/v2-lite-remaining` von `main`
- Arbeite in Phasen mit separaten Commits pro Feature
- Halte dich an die bestehenden Patterns: Factory-Functions, keine Klassen, Interfaces in types.ts
- Module duerfen nur aus ihrem eigenen Verzeichnis und ../shared/* importieren
- Tests mit bun:test, Filesystem-Tests mit createTempDir()/cleanupTempDir()
- Nach jeder Phase: `bun test` + `bun run typecheck`

Reihenfolge:
1. rebuild-index (hoch, Blocker fuer Modellwechsel)
2. Consolidation Agent (mittel)
3. Decay/Lifecycle (niedrig)

Frage bei Unklarheiten nach, insbesondere bei Consolidation-Heuristiken.
```
