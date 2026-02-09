# Agent Knowledge Memory v2 (Simplified)

**Pragmatisches Upgrade von Erinnerungssystem zu Wissenssystem**

| | |
|---|---|
| **Version** | 2.0-lite |
| **Datum** | 08. Februar 2026 |
| **Autor** | fitznerIO – AI Services |
| **Status** | Draft |
| **Basis** | agent-memory v1 PRD + v2 Full PRD |
| **Prinzip** | Der Agent pflegt alles. Der User merkt nichts davon. |

---

## 1. Design-Philosophie

### 1.1 Die eine Regel

Wenn ein Feature erfordert dass der User oder der Agent bewusst etwas pflegen muss was nicht ohnehin Teil seiner Arbeit ist, gehört es nicht in v2-lite.

Ein Agent der ein Projekt bearbeitet tut folgendes natürlich:
- Er trifft Entscheidungen und begründet sie
- Er löst Probleme und merkt sich die Lösung
- Er liest bestehendes Wissen bevor er anfängt
- Er committet seine Arbeit

Alles was darüber hinausgeht – Maturity tracken, Taxonomien pflegen, Cluster synthetisieren – ist Overhead der nur in spezifischen Kontexten (IdeaForge) Sinn macht.

### 1.2 Was v2-lite ist

Das bestehende agent-memory v1, erweitert um:

1. **Einzelne Dateien statt Sammel-Dateien** – Jede Entscheidung, jeder Incident ist eine eigene Datei
2. **Typisierte Connections** – Dateien kennen ihre Nachbarn und wissen warum
3. **Automatische Connection Discovery** – Der Agent muss Connections nicht manuell setzen
4. **Namespace-Tags** – Einfache hierarchische Tags statt Taxonomie-Verwaltung

Das ist alles. Vier Änderungen. Der Rest kommt später wenn es gebraucht wird.

### 1.3 Was v2-lite NICHT ist

- Kein Maturity-Tracking (gehört in IdeaForge, nicht ins Basis-Memory)
- Kein Evolution-Tracking (Git reicht)
- Keine Cluster-Detection (braucht Masse, kommt später)
- Kein Multi-Scope (kommt wenn mehrere Projekte aktiv sind)
- Keine Confidence-Scores (Pseudo-Präzision)
- Kein separates Query-Tool (Search reicht)

### 1.4 Was sich gegenüber v1 NICHT ändert

- Markdown als Source of Truth
- SQLite als abgeleiteter Index (FTS5 + sqlite-vec)
- Git für Versionierung
- Lokale Embeddings (all-MiniLM-L6-v2)
- Single Writer Pattern
- Session Lifecycle (Note-Taking → Consolidation → Commit)
- TypeScript/Bun Runtime
- 4 Memory-Typen (Core, Semantic, Episodic, Procedural)

---

## 2. Änderung 1: Einzelne Dateien statt Sammel-Dateien

### 2.1 Das Problem

In v1 landen alle Entscheidungen in `semantic/decisions.md`, alle Incidents in `episodic/incidents.md`. Nach 30 Entscheidungen ist die Datei 2.000 Zeilen lang. Der Agent muss sie komplett laden um eine einzige Entscheidung zu finden. Und Connections auf "die dritte Entscheidung in decisions.md" sind fragil.

### 2.2 Die Lösung

Jeder logische Eintrag wird eine eigene Datei mit eigenem Frontmatter:

```
# v1 (vorher)
semantic/
├── decisions.md          ← 30 Entscheidungen in einer Datei
├── entities/
│   ├── clients.md        ← alle Kunden in einer Datei
│   └── tools.md
episodic/
├── incidents.md          ← alle Incidents in einer Datei

# v2-lite (nachher)
semantic/
├── decisions/
│   ├── dec-001-webhook-vs-polling.md
│   ├── dec-002-sqlite-vs-postgres.md
│   └── dec-003-bun-vs-node.md
├── entities/
│   ├── client-praxis-mueller.md
│   ├── client-retropix.md
│   └── tool-n8n.md
episodic/
├── incidents/
│   ├── inc-001-ssl-wildcard.md
│   └── inc-002-memory-leak.md
├── sessions/
│   └── 2026-02-08.md      ← bleibt wie in v1
```

### 2.3 Datei-Konventionen

- **Dateiname:** `<type>-<nr>-<kurztitel>.md` oder `<type>-<name>.md`
- **Nummerierung:** Automatisch, aufsteigend pro Typ
- **Der Agent entscheidet** wann ein neuer Eintrag eine eigene Datei wird vs. an eine bestehende angehängt wird

### 2.4 Frontmatter-Standard

Jede Einzeldatei hat ein minimales Frontmatter:

```yaml
---
id: dec-001
title: "Webhook statt Polling für Telegram"
type: decision
tags:
  - tech/telegram
  - tech/infrastructure
created: 2026-02-05
updated: 2026-02-08
connections: []
---
```

Das ist der gesamte Standard. Keine Maturity, keine Evidence, keine Evolution, keine Concepts mit Roles. Nur: Was ist es, worum geht es, wann entstand es, womit hängt es zusammen.

### 2.5 Was der Agent tun muss

Nichts Besonderes. Statt `memory_update("semantic/decisions.md", ...)` ruft er `memory_store("semantic/decisions/dec-004-...", ...)` auf. Der Consolidation Agent am Session-Ende entscheidet: "Diese Entscheidung ist eigenständig genug für eine eigene Datei" vs. "Das ist ein Detail das an eine bestehende Datei angehängt wird."

---

## 3. Änderung 2: Typisierte Connections

### 3.1 Das Kernkonzept

Dateien können auf andere Dateien verweisen – mit einer Begründung warum. Wenn Datei A auf Datei B verweist, verweist Datei B automatisch zurück auf Datei A.

### 3.2 Fünf Connection Types

Nicht mehr, nicht weniger:

| Type | Bedeutung | Inverse | Wann der Agent es nutzt |
|---|---|---|---|
| `related` | Allgemeine Verbindung | `related` | Default wenn keine spezifischere Beziehung passt |
| `builds_on` | Baut inhaltlich auf etwas auf | `extended_by` | Neue Entscheidung basiert auf einer früheren |
| `contradicts` | Widerspricht etwas | `contradicts` | Neue Erkenntnis widerspricht alter Annahme |
| `part_of` | Gehört zu etwas Größerem | `contains` | Incident gehört zu einem größeren Problem |
| `supersedes` | Ersetzt etwas Älteres | `superseded_by` | Neue Lösung ersetzt alte |

### 3.3 Format im Frontmatter

```yaml
connections:
  - target: dec-003
    type: builds_on
    note: "Erweitert die Webhook-Entscheidung um Error Handling"
  - target: inc-001
    type: related
    note: "SSL-Problem hing mit dem Webhook-Setup zusammen"
```

### 3.4 Bidirektionalität

Wenn der Agent eine Connection setzt, wird automatisch die Inverse in der Zieldatei geschrieben:

```yaml
# In dec-001 (manuell gesetzt):
connections:
  - target: inc-001
    type: related
    note: "SSL-Problem hing mit dem Webhook-Setup zusammen"

# In inc-001 (automatisch gesetzt):
connections:
  - target: dec-001
    type: related
    note: "SSL-Problem hing mit dem Webhook-Setup zusammen"
```

Das passiert atomar im `memory_connect`-Tool: Beide Dateien + SQLite-Update in einer Operation.

### 3.5 Was der Agent tun muss

Der Agent setzt Connections wenn es natürlich ist. Beispiele aus einem normalen Projekt-Flow:

- Agent trifft eine Entscheidung die auf einer früheren aufbaut → `builds_on`
- Agent löst einen Bug und die Lösung ist ein neuer Workflow → `related`
- Agent findet heraus dass eine alte Annahme falsch war → `contradicts` + `supersedes`

Das ist kein extra Aufwand – der Agent dokumentiert ohnehin was er tut. Die Connection ist nur ein zusätzliches Feld im Tool-Call.

---

## 4. Änderung 3: Automatische Connection Discovery

### 4.1 Wann es passiert

Nicht bei jeder Consolidation, nicht als Batch-Job – sondern genau dann wenn der Agent eine neue Datei erstellt oder eine bestehende signifikant ändert. Das ist der natürliche Moment.

### 4.2 Der Algorithmus

```
Agent ruft memory_store() oder memory_update() auf
  │
  ├── 1. SQLite-Suche: Tags + FTS5 auf den neuen Content
  │   → Top 5 Kandidaten (Zero LLM-Kosten)
  │
  ├── 2. Vektor-Suche: Embedding-Ähnlichkeit > 0.7
  │   → Top 5 Kandidaten (Zero LLM-Kosten, lokales Modell)
  │
  ├── 3. Deduplizieren und Ranken
  │   → Max 5 Kandidaten gesamt
  │
  ├── 4. Dem Agent vorlegen (kein extra LLM-Call!)
  │   Der Agent der gerade memory_store aufruft, bekommt die
  │   Kandidaten als Tool-Response zurück:
  │   "Möglicherweise verwandte Einträge: [dec-001, inc-003, ...]"
  │
  └── 5. Agent entscheidet im selben Turn
      ob und welche Connections er setzen will
```

### 4.3 Der entscheidende Unterschied zum v2-Full-PRD

Im Full-PRD war Connection Discovery ein separater Haiku-Call pro Kandidat. Das kostet Tokens und Zeit. Hier bekommt der Agent der ohnehin gerade arbeitet die Kandidaten als Vorschlag zurück und entscheidet selbst. Null Extra-Kosten.

### 4.4 Was der Agent tun muss

Fast nichts. Er ruft `memory_store()` auf, bekommt als Response: "Gespeichert. Möglicherweise verwandt mit: dec-001 (Webhook-Entscheidung), inc-003 (Timeout-Problem)." Der Agent kann dann `memory_connect()` aufrufen oder es ignorieren. Das ist ein natürlicher Teil des Flows, kein extra Pflegeschritt.

---

## 5. Änderung 4: Namespace-Tags

### 5.1 Das Konzept

Statt flacher Tags (`claude-sdk`, `telegram`, `automation`) nutzen wir Pfad-basierte Tags die eine implizite Hierarchie haben:

```yaml
tags:
  - tech/ai/claude-sdk
  - tech/infrastructure/telegram
  - business/automation
```

### 5.2 Keine Taxonomie-Datei

Es gibt keine `taxonomy.yaml`, keine `concepts`-Tabelle, keine Verwaltung. Ein Tag existiert sobald er benutzt wird. Der Agent wählt Tags frei, mit einer einfachen Konvention:

- Maximal 3 Ebenen tief: `bereich/thema/detail`
- Erster Level ist breit: `tech/`, `business/`, `personal/`, `project/`
- Zweiter Level ist das Thema: `tech/ai/`, `tech/web/`, `business/clients/`
- Dritter Level ist spezifisch: `tech/ai/claude-sdk`, `tech/web/stenciljs`

### 5.3 Tag-Lookup für Konsistenz

Damit der Agent nicht jedes Mal andere Pfade erfindet, bekommt er bei `memory_store()` eine Liste der bereits verwendeten Tags als Kontext. Das ist ein simples `SELECT DISTINCT tag FROM tags ORDER BY tag` – keine Taxonomie-Verwaltung, sondern ein Autocomplete.

```
Agent will neuen Eintrag speichern
  → Tool zeigt: "Bestehende Tags: tech/ai/claude-sdk, tech/ai/orchestration, 
     tech/web/stenciljs, business/clients/podologie, ..."
  → Agent wählt passende Tags oder erstellt neue
```

### 5.4 Hierarchische Abfragen

Weil Tags Pfade sind, funktioniert hierarchische Suche automatisch:

```sql
-- Alles unter tech/ai/
SELECT * FROM entry_tags WHERE tag LIKE 'tech/ai/%'

-- Alles unter tech/
SELECT * FROM entry_tags WHERE tag LIKE 'tech/%'

-- Alle Tags auf Level 2 (für Übersicht)
SELECT DISTINCT substr(tag, 1, instr(substr(tag, instr(tag,'/')+1), '/')+instr(tag,'/')) FROM entry_tags
```

### 5.5 Was der Agent tun muss

Tags setzen wie bisher, nur mit Pfad-Konvention. Der Agent bekommt die bestehenden Tags als Vorschlag und wählt aus oder erstellt neue. Kein Pflege-Aufwand.

---

## 6. SQLite Schema (v2-lite)

### 6.1 Bestehende Tabellen (aus v1, unverändert)

```sql
-- Volltext-Suche
CREATE VIRTUAL TABLE memory_fts USING fts5(
  id, title, content, type
);

-- Vektor-Embeddings
CREATE VIRTUAL TABLE memory_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[384]
);
```

### 6.2 Neue Tabellen (v2-lite)

```sql
-- Haupttabelle für alle Einträge
-- Ersetzt das implizite "alles steht in der Datei" mit einem echten Index
CREATE TABLE knowledge (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL,    -- decision, incident, entity, pattern, workflow, session, note
  file_path     TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_accessed TEXT,
  access_count  INTEGER DEFAULT 0
);

CREATE INDEX idx_knowledge_type ON knowledge(type);
CREATE INDEX idx_knowledge_updated ON knowledge(updated_at);

-- Namespace-Tags
CREATE TABLE entry_tags (
  entry_id      TEXT NOT NULL,
  tag           TEXT NOT NULL,
  PRIMARY KEY (entry_id, tag),
  FOREIGN KEY (entry_id) REFERENCES knowledge(id)
);

CREATE INDEX idx_tags_tag ON entry_tags(tag);

-- Typisierte Verbindungen
CREATE TABLE connections (
  source_id     TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  type          TEXT NOT NULL,    -- related, builds_on, contradicts, part_of, supersedes
  note          TEXT,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id, type),
  FOREIGN KEY (source_id) REFERENCES knowledge(id),
  FOREIGN KEY (target_id) REFERENCES knowledge(id)
);

CREATE INDEX idx_conn_source ON connections(source_id);
CREATE INDEX idx_conn_target ON connections(target_id);
CREATE INDEX idx_conn_type ON connections(type);
```

**Das sind 3 neue Tabellen.** Nicht 7 wie im Full-PRD. Keine Evidence-Tabelle, keine Evolution-Tabelle, keine Concepts-Tabelle, keine Cluster-Members-Tabelle.

### 6.3 Index-Regeneration

Unverändert aus v1: Wenn der Index korrupt ist, wird er aus den Markdown-Frontmatter komplett regeneriert.

```bash
agent-memory rebuild-index
```

---

## 7. Tools

### 7.1 Bestehende Tools (aus v1, erweitert)

#### memory_note (minimal erweitert)

```typescript
memory_note(
  content: string,
  type: "semantic" | "episodic" | "procedural" | "decision" | "incident",
  importance: "high" | "medium" | "low",
  tags?: string[],           // NEU: Namespace-Tags
)
```

Funktioniert wie in v1. Session-Note wird geschrieben. Der Consolidation Agent entscheidet am Session-Ende ob daraus eine eigene Datei wird.

#### memory_search (erweitert)

```typescript
memory_search(
  query: string,
  type?: string,              // Filter auf Entry-Typ
  tags?: string[],            // NEU: Tag-Filter (mit Hierarchie: "tech/" findet alles darunter)
  connected_to?: string,      // NEU: Nur Einträge die mit dieser ID verbunden sind
  limit?: number,
) → [{
  id, title, type, file_path,
  tags: string[],             // NEU
  connections: Connection[],  // NEU
  score,
  snippet,
}]
```

Hybrid-Suche wie in v1 (FTS5 + Vektor), aber mit zusätzlichen Filtern.

#### memory_read (unverändert)

```typescript
memory_read(path: string) → string
```

#### memory_update (minimal erweitert)

```typescript
memory_update(
  path: string,
  content: string,
  reason: string,
)
```

Wie in v1. Bei signifikanter Änderung werden Connection-Kandidaten als Response zurückgegeben (siehe Abschnitt 4).

#### memory_forget (unverändert)

```typescript
memory_forget(query: string, scope: "entry" | "topic")
```

#### memory_commit (unverändert)

```typescript
memory_commit(message: string, type: string)
```

### 7.2 Neue Tools (v2-lite)

#### memory_store

Erstellt eine neue Einzeldatei mit Frontmatter. Das ist das Haupttool für v2-lite – jeder neue Eintrag wird als eigene Datei gespeichert.

```typescript
memory_store(
  title: string,
  type: "decision" | "incident" | "entity" | "pattern" | "workflow" | "note",
  content: string,
  tags?: string[],
  connections?: Array<{target: string, type: ConnectionType, note?: string}>,
) → {
  id: string,
  file_path: string,
  suggested_connections: Array<{id: string, title: string, relevance: number}>,
  existing_tags: string[],   // Autocomplete-Liste
}
```

**Entscheidend:** Die Response enthält `suggested_connections` und `existing_tags`. Der Agent bekommt sofort Kontext um Connections zu setzen und konsistente Tags zu wählen. Kein extra Call nötig.

#### memory_connect

Erstellt eine bidirektionale, typisierte Verbindung.

```typescript
memory_connect(
  source_id: string,
  target_id: string,
  type: "related" | "builds_on" | "contradicts" | "part_of" | "supersedes",
  note?: string,
) → { success: boolean, inverse_type: string }
```

Schreibt in beide Frontmatter + SQLite. Atomar.

#### memory_traverse

Navigiert das Wissens-Netz.

```typescript
memory_traverse(
  start_id: string,
  direction: "outgoing" | "incoming" | "both",
  types?: ConnectionType[],
  depth?: number,             // Default: 1, Max: 2
) → [{
  id, title, type,
  connection_type: string,
  distance: number,
}]
```

**Wann der Agent es nutzt:** "Warum haben wir uns für Webhooks entschieden?" → `memory_traverse("dec-001", "incoming")` → findet den Incident der die Entscheidung ausgelöst hat und die Session in der es besprochen wurde.

### 7.3 Tool-Übersicht

| Tool | v1 | v2-lite | Zweck |
|---|---|---|---|
| memory_note | ✅ | ✅ (erweitert) | Session-Notes während der Arbeit |
| memory_search | ✅ | ✅ (erweitert) | Wissen finden |
| memory_read | ✅ | ✅ | Datei lesen |
| memory_update | ✅ | ✅ (erweitert) | Datei ändern |
| memory_forget | ✅ | ✅ | Wissen löschen |
| memory_commit | ✅ | ✅ | Git-Commit |
| memory_store | ❌ | ✅ NEU | Einzeldatei erstellen |
| memory_connect | ❌ | ✅ NEU | Verbindung setzen |
| memory_traverse | ❌ | ✅ NEU | Netzwerk navigieren |

**9 Tools total.** 6 aus v1 (3 davon erweitert) + 3 neue.

---

## 8. Wie der Agent das im normalen Flow nutzt

### 8.1 Szenario: Agent löst einen Bug

```
1. Agent liest Fehlerbeschreibung
2. Agent sucht nach ähnlichen Problemen:
   → memory_search("SSL certificate expired", type="incident")
   → Findet inc-001-ssl-wildcard.md

3. Agent liest den alten Incident:
   → memory_read("episodic/incidents/inc-001-ssl-wildcard.md")
   → "Aha, letztes Mal lag es am Wildcard-Zertifikat"

4. Agent löst das Problem

5. Agent speichert den neuen Incident:
   → memory_store(
       title: "SSL Renewal fehlgeschlagen nach Server-Migration",
       type: "incident",
       content: "Certbot renewal schlug fehl weil der neue Server...",
       tags: ["tech/infrastructure/ssl", "tech/infrastructure/nginx"],
       connections: [{target: "inc-001", type: "related", note: "Ähnliches SSL-Problem"}]
     )
   → Response enthält: suggested_connections: [{id: "dec-005", title: "Nginx Config Standard"}]

6. Agent setzt die vorgeschlagene Connection:
   → memory_connect("inc-002", "dec-005", "related", "Nginx-Config war Teil des Problems")

7. Agent committet:
   → memory_commit("[incident] SSL Renewal nach Migration dokumentiert", "episodic")
```

**Was der User davon mitbekommt:** Nichts. Der Agent hat einen Bug gelöst und nebenbei sein Wissen aktualisiert. Beim nächsten SSL-Problem findet er sofort zwei dokumentierte Incidents mit Lösungen und weiß welche Entscheidungen damit zusammenhängen.

### 8.2 Szenario: Agent trifft eine Architektur-Entscheidung

```
1. User: "Sollen wir für die Queue Redis oder BullMQ nehmen?"

2. Agent sucht nach verwandten Entscheidungen:
   → memory_search("queue message broker", type="decision")
   → Findet dec-003: "SQLite statt PostgreSQL" (ähnliche Trade-offs)

3. Agent liest die alte Entscheidung:
   → memory_read("semantic/decisions/dec-003-sqlite-vs-postgres.md")
   → Sieht das Pattern: "Wir bevorzugen eingebettete Lösungen"

4. Agent empfiehlt BullMQ (eingebettet in Node.js, kein separater Redis-Server)

5. Agent speichert die Entscheidung:
   → memory_store(
       title: "BullMQ statt Redis für Job Queue",
       type: "decision",
       content: "## Kontext\nBrauchen eine Job Queue für...\n## Entscheidung\nBullMQ...\n## Begründung\n...",
       tags: ["tech/infrastructure/queue", "tech/node"],
       connections: [{target: "dec-003", type: "builds_on", note: "Gleiches Pattern: eingebettet > extern"}]
     )

6. Agent committet:
   → memory_commit("[decision] BullMQ für Job Queue gewählt", "semantic")
```

**Was passiert ist:** Der Agent hat nicht nur eine Entscheidung getroffen, sondern auch das Pattern "eingebettet > extern" implizit verstärkt durch die `builds_on`-Connection. Beim nächsten ähnlichen Trade-off wird er via `memory_traverse` dieses Pattern finden.

### 8.3 Szenario: Neuer Agent übernimmt Projekt

```
1. Neuer Agent startet Session auf dem Projekt

2. Core Memory wird geladen (wie v1):
   → core/identity.md, core/user.md, core/project.md

3. Agent will sich orientieren:
   → memory_search("", type="decision", limit=10)
   → Bekommt die 10 neuesten Entscheidungen mit Tags und Connections
   
   → memory_search("", type="incident", limit=5)
   → Bekommt die 5 neuesten Incidents

4. Agent sieht eine Entscheidung die er nicht versteht:
   → memory_traverse("dec-007", "incoming")
   → Findet: inc-004 (der Bug der die Entscheidung ausgelöst hat)
   → Findet: dec-003 (die Entscheidung auf der sie aufbaut)
   → Jetzt versteht er den Kontext

5. Agent arbeitet mit vollem Projektverständnis weiter
```

**Der Unterschied zu v1:** In v1 liest der Agent `decisions.md` – eine lange Datei ohne Kontext. In v2-lite liest er einzelne Entscheidungen mit Connections und kann den Kontext traversieren. Er versteht nicht nur WAS entschieden wurde, sondern WARUM.

---

## 9. Consolidation Agent (v2-lite)

### 9.1 Was sich ändert

Die v1 Consolidation (Dedup, Conflict Resolution, Subsumption, Forgetting) bleibt. Zusätzlich:

**Einzel-Datei-Erstellung:** Wenn eine Session-Note groß genug für eine eigene Datei ist (Entscheidung, Incident, neues Pattern), erstellt der Consolidation Agent eine Einzeldatei statt an eine Sammel-Datei anzuhängen.

Entscheidungskriterien:
- Entscheidung mit Begründung → eigene Datei in `semantic/decisions/`
- Gelöster Bug/Incident → eigene Datei in `episodic/incidents/`
- Neuer gelernter Workflow → eigene Datei in `procedural/`
- Kleiner Fakt (z.B. "Kunde bevorzugt Meetings am Vormittag") → an bestehende Entity-Datei anhängen

**Tag-Konsistenz:** Der Consolidation Agent prüft ob die verwendeten Tags konsistent mit bestehenden Tags sind und normalisiert sie (z.B. `tech/AI` → `tech/ai`).

### 9.2 Was sich NICHT ändert

- Kein Connection Discovery bei Consolidation (passiert schon bei `memory_store`)
- Kein Maturity-Review
- Kein Pattern-Extraction
- Kein Concept-Maintenance

Die Consolidation bleibt schlank und schnell.

---

## 10. Decay (v2-lite)

### 10.1 Aus v1 übernommen

- Access-Tracking: `last_accessed` und `access_count` pro Eintrag
- Importance-weighted Decay: Selten zugegriffene Einträge werden Archive-Kandidaten

### 10.2 Neu: Connection-Awareness

Bevor ein Eintrag archiviert wird, eine einfache Prüfung:

```sql
SELECT COUNT(*) FROM connections 
WHERE (source_id = ? OR target_id = ?) 
AND type != 'supersedes'
```

Wenn der Eintrag aktive Connections hat (außer `superseded_by`), wird er nicht automatisch archiviert. Stattdessen wird er im nächsten Consolidation-Run als "connected but stale" gemeldet.

Das ist eine 3-Zeilen-Query, kein eigener Algorithmus.

---

## 11. Migration v1 → v2-lite

### 11.1 Schritt 1: Sammel-Dateien aufteilen

```bash
agent-memory migrate split-files
```

Das Skript:
1. Liest `semantic/decisions.md`
2. Splittet an `##`-Headings
3. Erstellt pro Abschnitt eine Einzeldatei mit generiertem Frontmatter
4. Löscht die Sammel-Datei
5. Wiederholt für `episodic/incidents.md`, `semantic/entities/*.md` (wenn sinnvoll)

### 11.2 Schritt 2: Tags migrieren

```bash
agent-memory migrate namespace-tags
```

Das Skript:
1. Sammelt alle bestehenden Tags
2. Versucht Namespace-Zuweisung: `claude-sdk` → `tech/ai/claude-sdk`, `n8n` → `tech/automation/n8n`
3. Nicht-zuweisbare Tags bekommen Prefix `_untagged/`
4. Aktualisiert alle Frontmatter

### 11.3 Schritt 3: SQLite erweitern

```bash
agent-memory migrate schema-v2
```

Das Skript:
1. Erstellt neue Tabellen (`knowledge`, `entry_tags`, `connections`)
2. Befüllt aus bestehenden Markdown-Frontmatter
3. Behält bestehende FTS5- und Vec-Tabellen bei

### 11.4 Schritt 4: Initiale Connections (optional)

```bash
agent-memory migrate discover-connections
```

Das Skript:
1. Nimmt jede Datei
2. Sucht via FTS5 + Vektor nach Top-3-Kandidaten
3. Erstellt `related`-Connections für Paare mit Score > 0.8
4. Setzt bidirektionale Links

Dieser Schritt ist optional und kann auch organisch passieren (der Agent setzt Connections im normalen Flow).

---

## 12. Implementation Roadmap

### Phase 1: Einzeldateien + Schema (Woche 1)

- SQLite-Schema v2-lite erstellen (3 neue Tabellen)
- `memory_store`-Tool implementieren
- Migrations-Skript für Sammel-Dateien
- Consolidation Agent: Einzeldatei-Erstellung
- Tests

> **Milestone:** Neue Einträge werden als Einzeldateien gespeichert. Bestehende Sammel-Dateien sind migriert.

### Phase 2: Connections (Woche 2)

- `memory_connect`-Tool (bidirektional, atomar)
- `memory_traverse`-Tool
- `connections`-Tabelle befüllen
- Connection-Kandidaten als Response bei `memory_store`
- Connection-Awareness bei Decay
- Tests

> **Milestone:** Dateien können verbunden und traversiert werden. Connection Discovery funktioniert passiv.

### Phase 3: Namespace-Tags (Woche 3)

- `entry_tags`-Tabelle
- Tag-Lookup bei `memory_store` (bestehende Tags als Vorschlag)
- Hierarchische Tag-Suche in `memory_search`
- Migrations-Skript für bestehende Tags
- Tag-Normalisierung im Consolidation Agent
- Tests

> **Milestone:** Namespace-Tags statt flacher Tags. Hierarchische Navigation funktioniert.

### Phase 4: Polish + Integration (Woche 4)

- Erweiterte `memory_search` Filter (tags, connected_to)
- Optionaler initiale Connection Discovery für bestehende Dateien
- Performance-Tuning
- Dokumentation
- End-to-End Tests: Agent arbeitet normal an Projekt, Wissen entsteht automatisch

> **Milestone:** v2-lite ist produktionsreif. Agent nutzt das Wissenssystem ohne extra Aufwand.

**Gesamt: 4 Wochen** (vs. 10 Wochen im Full-PRD)

---

## 13. Was später kommen kann (aber nicht muss)

Wenn v2-lite läuft und sich zeigt dass mehr gebraucht wird:

| Feature | Wann sinnvoll | Aufwand |
|---|---|---|
| **Multi-Scope** (personal/projects/shared) | Wenn ≥ 3 aktive Projekte | ~2 Wochen |
| **Maturity-Tracking** | Für IdeaForge, nicht für Projekt-Memory | ~1 Woche |
| **Cluster-Detection** | Wenn > 50 Ideen in personal/ | ~1 Woche |
| **Cross-Project Learning** | Wenn Multi-Scope aktiv | ~1 Woche |
| **Dashboard** | Wenn Wissens-Netz groß genug für Visualisierung | ~2 Wochen |

Jedes Feature kann unabhängig nachgerüstet werden, ohne das Basissystem anzufassen.

---

## 14. Erfolgskriterien

| Metrik | Ziel | Messmethode |
|---|---|---|
| Agent nutzt memory_store statt memory_update auf Sammel-Dateien | > 80% der neuen Einträge | Log-Analyse |
| Connections pro Eintrag (Durchschnitt) | 1–3 nach 30 Tagen | SQLite Query |
| Connection-Precision | > 80% der Connections sind sinnvoll | Stichproben-Review |
| Tag-Konsistenz | < 10% doppelte/inkonsistente Tags | Distinct-Count vs. normalisierter Count |
| Retrieval-Verbesserung | Agent findet relevanten Kontext in > 70% der Fälle | Manuelle Bewertung |
| Kein Mehraufwand für den User | 0 manuelle Memory-Pflege-Aktionen pro Woche | Beobachtung |
| Migration ohne Datenverlust | 100% der v1-Einträge in v2-lite indexiert | Automatisierter Test |
| Performance | memory_search < 200ms, memory_traverse < 100ms | Latenz-Logging |

---

## 15. Vergleich v2-Full vs. v2-lite

| Dimension | v2-Full | v2-lite |
|---|---|---|
| SQLite-Tabellen (neu) | 7 | 3 |
| Tools | 11 | 9 |
| Connection Types | 12 | 5 |
| Maturity-Stufen | 5 + Confidence-Score | Keine (später nachrüstbar) |
| Taxonomie | yaml + 2 Tabellen + Verwaltung | Namespace-Tags mit Autocomplete |
| Cluster | First-Class Citizens | Später nachrüstbar |
| Multi-Scope | Von Anfang an | Später nachrüstbar |
| Evolution-Tracking | Eigene Tabelle + Tool | Git-History reicht |
| Implementierung | 10 Wochen | 4 Wochen |
| Pflege-Aufwand für Agent | Hoch (Maturity, Taxonomy, Evolution) | Minimal (Tags + Connections im Flow) |
| Pflege-Aufwand für User | Niedrig | **Null** |

---

*Agent Knowledge Memory v2.0-lite – fitznerIO AI Services – Februar 2026*
