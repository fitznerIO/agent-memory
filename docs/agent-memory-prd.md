# PRD: Agent Memory System

**Version:** 1.0
**Datum:** 2026-02-05
**Status:** Draft

---

## 1. Übersicht

### 1.1 Projektziel

Entwicklung eines persistenten Memory-Systems für einen persönlichen Claude-Agenten auf Basis des Anthropic Agent SDK (TypeScript). Das System ermöglicht dem Agenten, Wissen über Sessions hinweg zu speichern, intelligent abzurufen und über Git zu versionieren.

### 1.2 Kernprinzipien

1. **Markdown als Source of Truth** — Alles Wissen existiert in menschenlesbaren, editierbaren Dateien
2. **SQLite als abgeleiteter Index** — Suchindex kann jederzeit aus Markdown regeneriert werden
3. **Git für bewusste Versionierung** — Agent committet explizit mit semantischen Messages
4. **Hybrid-Suche** — BM25 (Keywords) + Vektor-Ähnlichkeit für präzise Ergebnisse
5. **Lokale Autonomie** — Keine Cloud-Abhängigkeiten, alle Embeddings lokal

### 1.3 Abgrenzung

| In Scope | Out of Scope |
|----------|--------------|
| Persönlicher Single-Agent | Multi-Agent mit geteilter Memory |
| Lokale Speicherung | Cloud-Sync, Multi-Device |
| TypeScript/Bun Runtime | Python-Implementation |
| Agent SDK Integration | Claude Code CLI Hooks |
| Telegram als Kanal | Telegram-spezifische Features |

---

## 2. Benutzer & Stakeholder

### 2.1 Primärer Nutzer

**Sascha** — Senior Web Developer, baut einen persönlichen AI-Assistenten für:
- Entwicklungsarbeit (StencilJS, n8n, AI-Integration)
- Kundenmanagement (Podologie-Praxen, IT-Unternehmen)
- Projekt-Tracking über längere Zeiträume

### 2.2 Nutzungsszenarien

**Szenario 1: Kontextkontinuität**
> "Letzte Woche haben wir das SSL-Problem bei Kunde X gelöst. Wie war nochmal die Lösung?"

Der Agent findet die episodische Memory, liefert die Lösung und den Kontext.

**Szenario 2: Faktenwissen**
> "Welchen Tech-Stack nutzt Praxis Müller?"

Der Agent ruft semantische Memory ab: "n8n v2, migriert von Zapier, Ansprechpartnerin Frau Schmidt".

**Szenario 3: Gelerntes Verhalten**
> "Deploy das StencilJS-Projekt."

Der Agent nutzt prozedurale Memory für den gelernten Workflow ohne erneute Erklärung.

**Szenario 4: Explizites Merken**
> "Merk dir: Kunde Y bevorzugt Meetings am Vormittag."

Der Agent speichert den Fakt, committet mit sinnvoller Message in Git.

---

## 3. Systemarchitektur

### 3.1 Komponentenübersicht

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent (TypeScript/Bun)                   │
│                    via Anthropic Agent SDK                  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   Memory Tools    │
                    │  (native Tools)   │
                    └─────────┬─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────▼───────┐    ┌───────▼───────┐    ┌───────▼───────┐
│  Memory Store │    │  Search Index │    │  Git Manager  │
│  (Markdown)   │    │   (SQLite)    │    │  (libgit2)    │
└───────┬───────┘    └───────┬───────┘    └───────────────┘
        │                    │
        └────────┬───────────┘
                 │
        ┌────────▼────────┐
        │   File System   │
        │ ~/.agent-memory │
        └─────────────────┘
```

### 3.2 Dateistruktur

```
~/.agent-memory/
├── .git/                           # Git Repository
├── core/                           # Immer in Context geladen (~4k Tokens)
│   ├── identity.md                 # Agent-Persona, Rolle
│   ├── user.md                     # User-Profil, Präferenzen
│   └── project.md                  # Aktiver Projektkontext
├── semantic/                       # Langzeit-Faktenwissen
│   ├── entities/
│   │   ├── clients.md              # Kundeninformationen
│   │   ├── tools.md                # Tech-Stack, Präferenzen
│   │   └── domain.md               # Domänen-Wissen
│   └── decisions.md                # Getroffene Entscheidungen
├── episodic/                       # Erfahrungsbasiertes Wissen
│   ├── sessions/
│   │   └── YYYY-MM-DD.md           # Tägliche Session-Logs
│   └── incidents.md                # Bemerkenswerte Probleme & Lösungen
├── procedural/                     # Gelernte Workflows
│   ├── workflows.md                # Wiederkehrende Abläufe
│   └── patterns.md                 # Erkannte Muster
├── .index/
│   ├── search.sqlite               # FTS5 + sqlite-vec Index
│   ├── embeddings.bin              # Cached Embeddings
│   └── meta.json                   # Index-Konfiguration
└── .session/
    └── notes.md                    # Aktuelle Session-Notes (temporär)
```

### 3.3 Memory-Typen

| Typ | Beschreibung | Beispiel | Decay |
|-----|--------------|----------|-------|
| **Core** | Immer geladen, Agent-Identität | "Ich bin Saschas Assistent" | Nie |
| **Semantic** | Kontextunabhängige Fakten | "Kunde X nutzt n8n v2" | Bei Widerspruch aktualisiert |
| **Episodic** | Zeitgebundene Erfahrungen | "Am 15.01. SSL-Problem gelöst" | Nach 30 Tagen komprimiert |
| **Procedural** | Gelernte Workflows | "Deploy: Build → Test → CDN" | Nie (nur verfeinert) |

---

## 4. Funktionale Anforderungen

### 4.1 Memory Tools

Der Agent erhält folgende Tools über das Agent SDK:

#### F-01: `memory_note`
**Beschreibung:** Während der Session etwas als erinnerungswürdig markieren.

```typescript
interface MemoryNoteInput {
  content: string;
  type: "semantic" | "episodic" | "procedural";
  importance: "high" | "medium" | "low";
}

interface MemoryNoteOutput {
  success: boolean;
  noteId: string;
  message: string;
}
```

**Akzeptanzkriterien:**
- [ ] Note wird in `.session/notes.md` geschrieben
- [ ] Note enthält Timestamp und Importance-Tag
- [ ] Agent erhält Bestätigung mit Note-ID

#### F-02: `memory_search`
**Beschreibung:** Hybrid-Suche über den gesamten Memory-Bestand.

```typescript
interface MemorySearchInput {
  query: string;
  type?: "semantic" | "episodic" | "procedural" | "all";
  limit?: number;  // Default: 5
  minScore?: number;  // Default: 0.3
}

interface MemorySearchOutput {
  results: Array<{
    content: string;
    source: string;  // Dateipfad
    score: number;
    type: string;
    lastAccessed: string;
  }>;
  totalFound: number;
}
```

**Akzeptanzkriterien:**
- [ ] Hybrid-Scoring: 50% Vektor + 30% BM25 + 20% Recency
- [ ] Ergebnisse enthalten Source-Pfad für Nachvollziehbarkeit
- [ ] `lastAccessed` wird bei jedem Abruf aktualisiert

#### F-03: `memory_read`
**Beschreibung:** Eine bestimmte Memory-Datei direkt lesen.

```typescript
interface MemoryReadInput {
  path: string;  // Relativ zu ~/.agent-memory/
}

interface MemoryReadOutput {
  content: string;
  lastModified: string;
  wordCount: number;
}
```

**Akzeptanzkriterien:**
- [ ] Pfad wird validiert (nur innerhalb Memory-Verzeichnis)
- [ ] Nicht existierende Dateien geben klare Fehlermeldung

#### F-04: `memory_update`
**Beschreibung:** Eine Memory-Datei aktualisieren.

```typescript
interface MemoryUpdateInput {
  path: string;
  content: string;
  reason: string;  // Für Commit-Message
}

interface MemoryUpdateOutput {
  success: boolean;
  diff: string;  // Kurze Zusammenfassung der Änderung
  indexed: boolean;
}
```

**Akzeptanzkriterien:**
- [ ] Datei wird geschrieben
- [ ] Index wird aktualisiert (Embeddings neu berechnet)
- [ ] Änderung wird NICHT automatisch committet (siehe F-06)

#### F-05: `memory_forget`
**Beschreibung:** Explizites Löschen von Memory-Einträgen.

```typescript
interface MemoryForgetInput {
  query: string;  // Was vergessen werden soll
  scope: "entry" | "topic";  // Einzelner Eintrag oder ganzes Thema
  confirm: boolean;  // Sicherheitsabfrage
}

interface MemoryForgetOutput {
  success: boolean;
  forgotten: string[];  // Was gelöscht wurde
  message: string;
}
```

**Akzeptanzkriterien:**
- [ ] `confirm: true` ist erforderlich
- [ ] Gelöschtes bleibt in Git-Historie abrufbar
- [ ] Index wird aktualisiert

#### F-06: `memory_commit`
**Beschreibung:** Expliziter Git-Commit der aktuellen Änderungen.

```typescript
interface MemoryCommitInput {
  message: string;  // Commit-Message (Agent schreibt sie selbst)
  type: "semantic" | "episodic" | "procedural" | "consolidate" | "archive";
}

interface MemoryCommitOutput {
  success: boolean;
  commitHash: string;
  filesChanged: number;
}
```

**Akzeptanzkriterien:**
- [ ] Commit-Message folgt Format: `[<type>] <message>`
- [ ] Nur geänderte Dateien werden committet
- [ ] Agent erhält Commit-Hash als Bestätigung

### 4.2 Session-Lifecycle

#### F-07: Session-Start
**Trigger:** Agent wird gestartet

**Aktionen:**
1. Core Memory laden (`core/*.md`) → In System-Prompt injizieren
2. Letzte Session-Notes prüfen → Falls vorhanden, Consolidation triggern
3. Index-Integrität prüfen → Bei Bedarf Reindex

**Akzeptanzkriterien:**
- [ ] Core Memory ist im ersten Agent-Turn verfügbar
- [ ] Alte Session-Notes werden nicht ignoriert

#### F-08: Session-Ende
**Trigger:** Agent wird beendet (graceful shutdown)

**Aktionen:**
1. Session-Notes aus `.session/notes.md` lesen
2. Consolidation-Agent aufrufen (separater LLM-Call)
3. Konsolidierte Memories in passende Dateien schreiben
4. Git-Commit mit Session-Summary
5. Session-Notes löschen

**Akzeptanzkriterien:**
- [ ] Keine Session-Notes gehen verloren
- [ ] Consolidation dedupliziert und löst Konflikte
- [ ] Commit-Message fasst Session zusammen

### 4.3 Consolidation-Logik

#### F-09: Consolidation-Agent
**Beschreibung:** Separater LLM-Call am Session-Ende, der Session-Notes verarbeitet.

**Input:**
- Session-Notes (`.session/notes.md`)
- Betroffene Memory-Dateien (basierend auf Note-Types)

**Operationen:**
1. **Deduplication:** "User arbeitet mit StencilJS" existiert → Skip
2. **Conflict Resolution:** Neuere Info überschreibt alte mit Archiv-Vermerk
3. **Subsumption:** Mehrere ähnliche Episoden → Prozedurales Wissen
4. **Forgetting:** Unwichtige Details werden nicht übernommen

**Output:**
- Aktualisierte Memory-Dateien
- Commit-Message-Vorschlag

**Akzeptanzkriterien:**
- [ ] Keine Halluzinationen (nur Session-Notes als Quelle)
- [ ] Konflikte werden dokumentiert
- [ ] Consolidation dauert <30 Sekunden

---

## 5. Nicht-Funktionale Anforderungen

### 5.1 Performance

| Metrik | Ziel | Messmethode |
|--------|------|-------------|
| Core Memory Load | <100ms | Startup-Zeit messen |
| Hybrid Search | <500ms | Query-Latenz messen |
| Local Embedding | <2s pro Chunk | Embedding-Zeit messen |
| Consolidation | <30s | Session-Ende messen |

### 5.2 Speicher

| Metrik | Ziel |
|--------|------|
| Embedding-Modell | ~500MB - 1GB Disk |
| SQLite Index | <100MB für 10.000 Chunks |
| Memory-Dateien | Unbegrenzt (Git komprimiert) |

### 5.3 Zuverlässigkeit

- **Datenverlust:** Kein Datenverlust bei Crash (Git als Backup)
- **Index-Korruption:** Automatischer Reindex bei Inkonsistenz
- **Graceful Degradation:** Ohne Index funktioniert Direct-Read weiter

### 5.4 Sicherheit

- **Dateizugriff:** Nur innerhalb `~/.agent-memory/`
- **Keine Secrets:** Memory enthält keine API-Keys oder Passwörter
- **Git-Remote:** Optional, nicht standardmäßig konfiguriert

---

## 6. Technologie-Stack

| Komponente | Technologie | Version | Begründung |
|------------|-------------|---------|------------|
| Runtime | Bun | 1.x | Konsistent mit bestehendem Stack |
| Sprache | TypeScript | 5.x | Typsicherheit, Agent SDK Support |
| Agent SDK | @anthropic-ai/sdk | latest | Native Tool-Integration |
| Datenbank | SQLite | 3.x | Eingebettet, kein Server |
| Volltext-Suche | SQLite FTS5 | - | Integriert in SQLite |
| Vektor-Suche | sqlite-vec | 0.x | SQLite-Extension, kein ChromaDB |
| Embeddings | all-MiniLM-L6-v2 | - | Lokales Modell, ~80MB |
| Git | isomorphic-git | 5.x | Pure JS, kein libgit2 nötig |
| Markdown | remark | 15.x | Parsing und Manipulation |

---

## 7. Implementierungsplan

### Phase 1: Foundation (MVP)
**Ziel:** Grundlegende Memory-Operationen funktionieren

**Deliverables:**
- [ ] Dateistruktur angelegt
- [ ] `memory_read` und `memory_update` Tools
- [ ] Core Memory Injection bei Session-Start
- [ ] Manueller Git-Commit via Tool

**Zeitrahmen:** 1 Woche

### Phase 2: Search
**Ziel:** Intelligentes Retrieval

**Deliverables:**
- [ ] SQLite FTS5 Index
- [ ] Lokale Embeddings mit all-MiniLM-L6-v2
- [ ] sqlite-vec Integration
- [ ] Hybrid-Scoring implementiert
- [ ] `memory_search` Tool

**Zeitrahmen:** 1 Woche

### Phase 3: Session Lifecycle
**Ziel:** Automatische Memory-Pflege

**Deliverables:**
- [ ] `memory_note` Tool
- [ ] Session-Notes Management
- [ ] Consolidation-Agent
- [ ] Automatischer Commit bei Session-Ende

**Zeitrahmen:** 1 Woche

### Phase 4: Decay & Polish
**Ziel:** Langzeit-Stabilität

**Deliverables:**
- [ ] Episodic Memory Kompression (>30 Tage)
- [ ] Access-Tracking für Retrieval-Reinforcement
- [ ] `memory_forget` Tool
- [ ] Index-Reparatur bei Korruption
- [ ] Dokumentation

**Zeitrahmen:** 1 Woche

---

## 8. Erfolgsmetriken

| Metrik | Ziel | Messung |
|--------|------|---------|
| Retrieval-Relevanz | >80% der Suchergebnisse sind relevant | Manuelle Bewertung |
| Context-Nutzung | Agent nutzt Memory in >50% der Antworten | Log-Analyse |
| Commit-Qualität | Commit-Messages sind verständlich | Review |
| Kein Datenverlust | 0 verlorene Notes über 30 Tage | Audit |

---

## 9. Risiken & Mitigationen

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|--------|-------------------|--------|------------|
| Lokale Embeddings zu langsam | Mittel | Mittel | Caching, Batch-Processing |
| Consolidation halluziniert | Niedrig | Hoch | Strikte Prompt-Constraints, nur Notes als Quelle |
| Git-Konflikte bei Crash | Niedrig | Mittel | Atomic Writes, Lock-Files |
| Memory wächst unkontrolliert | Mittel | Niedrig | Decay-Strategie in Phase 4 |
| sqlite-vec Kompatibilität | Niedrig | Hoch | Fallback auf pure FTS5 |

---

## 10. Offene Fragen

1. **Embedding-Modell:** all-MiniLM-L6-v2 oder größeres Modell für bessere Qualität?
2. **Telegram-Integration:** Wie wird der Telegram-Bot an die Memory angebunden? (Separater Agent, der dieselbe Memory nutzt?)
3. **Backup-Strategie:** Soll Git-Remote konfigurierbar sein für Cloud-Backup?

---

## Anhang A: Beispiel Memory-Dateien

### core/identity.md
```markdown
# Agent Identity

Ich bin Saschas persönlicher AI-Assistent, spezialisiert auf:
- Web-Entwicklung (StencilJS, TypeScript, n8n)
- AI-Integration und Agentic Coding
- Kundenmanagement für seine Agentur

## Kommunikationsstil
- Deutsch, informelles "Du"
- Direkt und technisch präzise
- Kritisch hinterfragend bei Unklarheiten

## Aktuelle Prioritäten
- Memory-System für Agent SDK entwickeln
- Micro-Startups (RetroPix, GastroPix) betreuen
```

### semantic/entities/clients.md
```markdown
# Kunden

## Praxis Müller
- **Branche:** Podologie
- **Standorte:** 3
- **Tech-Stack:** n8n v2 (migriert von Zapier)
- **Ansprechpartnerin:** Frau Schmidt
- **Letzte Interaktion:** 2026-01-20

## IT Solutions GmbH
- **Branche:** IT-Dienstleister
- **Projekt:** AI-Integration Consulting
- **Status:** Aktiv
```

### episodic/sessions/2026-02-05.md
```markdown
# Session 2026-02-05

## Zusammenfassung
Konzept für Agent Memory System erarbeitet. PRD erstellt.

## Wichtige Entscheidungen
- Markdown als Source of Truth
- SQLite + sqlite-vec für Hybrid-Suche
- Git mit bewussten Commits durch Agent
- Lokale Embeddings (all-MiniLM-L6-v2)

## Offene Punkte
- Telegram-Integration klären
- Embedding-Modell-Größe evaluieren
```

---

## Anhang B: Tool-Schemas für Agent SDK

```typescript
// tools/memory.ts

import { Tool } from "@anthropic-ai/sdk";

export const memoryTools: Tool[] = [
  {
    name: "memory_note",
    description: "Markiere etwas als erinnerungswürdig für die aktuelle Session. Wird am Session-Ende konsolidiert.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Was soll gemerkt werden" },
        type: { type: "string", enum: ["semantic", "episodic", "procedural"] },
        importance: { type: "string", enum: ["high", "medium", "low"] }
      },
      required: ["content", "type", "importance"]
    }
  },
  {
    name: "memory_search",
    description: "Durchsuche die gesamte Memory nach relevantem Wissen.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Suchanfrage" },
        type: { type: "string", enum: ["semantic", "episodic", "procedural", "all"] },
        limit: { type: "number", description: "Max. Ergebnisse (Default: 5)" }
      },
      required: ["query"]
    }
  },
  {
    name: "memory_commit",
    description: "Committe aktuelle Memory-Änderungen in Git mit einer beschreibenden Message.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Commit-Message (du schreibst sie selbst)" },
        type: { type: "string", enum: ["semantic", "episodic", "procedural", "consolidate", "archive"] }
      },
      required: ["message", "type"]
    }
  }
];
```
