# IdeaForge – Agent-Memory Extension

**Autonomous Second Brain als v2-lite Extension**

| | |
|---|---|
| **Version** | 1.1 |
| **Datum** | 08. Februar 2026 |
| **Autor** | fitznerIO – AI Services |
| **Status** | Draft |
| **Basis** | Agent Knowledge Memory v2-lite PRD |
| **Typ** | agent-memory Extension |

---

## 1. Einordnung

IdeaForge ist eine Extension für agent-memory v2-lite. Es nutzt die Kern-Infrastruktur (Einzeldateien, Connections, Namespace-Tags, Hybrid-Suche) und ergänzt sie um Ideen-Lifecycle, Cluster-Detection und einen Resurface-Mechanismus.

### 1.1 Was v2-lite liefert (nutzen, nicht neu bauen)

| Feature | v2-lite Tool | IdeaForge nutzt es für |
|---|---|---|
| Ideen speichern | `memory_store` | Ideen als Einzeldateien ablegen |
| Verbindungen setzen | `memory_connect` | Ideen untereinander verlinken |
| Verbindungen finden | Auto-Discovery bei `memory_store` | Vorschläge für verwandte Ideen |
| Netzwerk navigieren | `memory_traverse` | "Was hängt an dieser Idee?" |
| Suchen | `memory_search` | Ideen nach Tags, Typ, Verbindungen finden |
| Tags | Namespace-Tags | Hierarchische Kategorisierung |
| Versionierung | Git (v1) | History aller Ideen-Änderungen |

### 1.2 Was IdeaForge ergänzt

| Feature | Warum v2-lite es nicht hat | Warum IdeaForge es braucht |
|---|---|---|
| Status-Lifecycle | Projekt-Wissen ist sofort "aktiv" | Ideen durchlaufen: unprocessed → active → archived/project |
| Urgency | Projekt-Wissen hat keine Dringlichkeit | "now" vs. "someday" steuert den Resurface-Digest |
| Cluster-Detection | Braucht Masse, für Projekte irrelevant | Kernfeature: Muster in Ideen erkennen |
| Resurface-Loop | Projekt-Agent sucht aktiv, kein Push nötig | Ideen dürfen nicht vergessen werden |
| Telegram-Interface | Projekt-Agent arbeitet in der IDE | IdeaForge lebt in Telegram |

---

## 2. Extension Definition

### 2.1 Schema

```typescript
export const ideaforgeExtension: Extension = {
  name: "ideaforge",
  version: "1.1.0",                          // Pflichtfeld (Extension-Interface §4.1)
  description: "Autonomous Second Brain",    // Pflichtfeld

  // Eigene knowledge.type-Werte registrieren (Core-Voraussetzung C1, Ext-PRD §8.4).
  // Ohne diese Deklaration bricht memoryStore(type="idea") zur Laufzeit.
  knowledgeTypes: [
    { type: "idea",      dir: "semantic/ideas",     v1Type: "semantic", idPrefix: "idea" },
    { type: "synthesis", dir: "semantic/syntheses", v1Type: "semantic", idPrefix: "syn" },
  ],

  schema: {
    table: "ideaforge_meta",
    columns: [
      { name: "status",      type: "TEXT", default: "'unprocessed'" },
      { name: "urgency",     type: "TEXT", default: "'someday'" },
      { name: "source_type", type: "TEXT", default: "'text'" },
      { name: "source_url",  type: "TEXT" },
      { name: "last_resurfaced_at", type: "TEXT" },  // Snooze: zuletzt im Digest gezeigt
    ],
  },

  tools: [
    ideaStore,
    ideaResurface,
    ideaStatus,
    ideaDigest,
  ],

  // Hooks erhalten ctx (Extension-Interface §4.1); ctx.db ist synchron (kein await).
  async onInstall(ctx) {
    // Index auf status für schnelle Resurface-Queries
    ctx.db.run(`CREATE INDEX idx_if_status ON ideaforge_meta(status)`);
    ctx.db.run(`CREATE INDEX idx_if_urgency ON ideaforge_meta(urgency)`);
  },

  async onUninstall(ctx) {
    // ext.ideaforge-Block aus allen Frontmatter entfernen
    await cleanFrontmatterNamespace(ctx.memoryPath, "ideaforge");
  },
};
```

### 2.2 SQLite-Tabelle

```sql
-- Wird bei Installation automatisch erstellt
CREATE TABLE ideaforge_meta (
  entry_id          TEXT PRIMARY KEY,
  status            TEXT DEFAULT 'unprocessed',  -- unprocessed, active, archived, project
  urgency           TEXT DEFAULT 'someday',      -- now, soon, someday
  source_type       TEXT DEFAULT 'text',         -- voice, url, screenshot, text, video
  source_url        TEXT,
  last_resurfaced_at TEXT,                        -- Snooze-Cooldown: zuletzt im Digest gezeigt
  FOREIGN KEY (entry_id) REFERENCES knowledge(id)
);
```

### 2.3 Frontmatter-Format

```yaml
---
id: idea-001
title: "Agent Orchestrator mit Claude SDK"
type: idea
tags:
  - tech/ai/claude-sdk
  - tech/ai/orchestration
created: 2026-02-08
updated: 2026-02-08
connections:
  - target: idea-002
    type: related
    note: "Beide betreffen Multi-Agent-Workflows"
ext.ideaforge:
  status: active
  urgency: soon
  source_type: voice
  source_url: null
---

## Summary
Claude Agent SDK V2 ermöglicht native Agent Orchestration...

## Research
SDK V2 bietet native Tool-Orchestration. Anthropic hat Agent Teams
als Beta-Feature eingeführt.
```

Bei Deinstallation der Extension: Der `ext.ideaforge:`-Block wird entfernt. Der Rest (id, title, type, tags, connections, content) bleibt als normales v2-lite Wissen erhalten.

---

## 3. Extension Tools

### 3.1 idea_store

Wrapper um `memory_store` mit IdeaForge-spezifischen Feldern und automatischem Pre-Processing.

```typescript
idea_store(
  content: string,              // Raw-Input (Text, transkribierter Voice, extrahierter Artikel)
  title?: string,               // Optional – wird von Haiku generiert wenn leer
  tags?: string[],              // Optional – wird von Haiku generiert wenn leer
  source_type?: "voice" | "url" | "screenshot" | "text" | "video",
  source_url?: string,
  urgency?: "now" | "soon" | "someday",
  connections?: Array<{target: string, type: ConnectionType, note?: string}>,
) → {
  id: string,
  file_path: string,
  title: string,                // Generiert oder übergeben
  tags: string[],               // Generiert oder übergeben
  suggested_connections: Array<{id: string, title: string, relevance: number}>,
  existing_tags: string[],
}
```

**Was idea_store intern tut:**

1. Falls `title` oder `tags` fehlen: Haiku-Call zur Klassifizierung. Der Call bekommt den Raw-Content und gibt strukturiert `{ title, tags[] }` zurück (Schema-validiert, §8 „Haiku-Klassifizierung invalide" → Fallback: nur Raw Content speichern). Kein externer v1-Doc-Verweis nötig.
2. `memory_store()` aufrufen mit `type: "idea"`
3. IdeaForge-Meta in `ideaforge_meta`-Tabelle schreiben
4. `ext.ideaforge:`-Block ins Frontmatter setzen
5. Suggested Connections + existing Tags zurückgeben

### 3.2 idea_status

Ändert den Status einer Idee.

```typescript
idea_status(
  id: string,
  status: "unprocessed" | "active" | "archived" | "project",
  project_name?: string,       // Nur bei status="project"
) → { success: boolean }
```

**Transitions:**

```
unprocessed → active       (nach Intake/Research)
active → archived          (User: 🗑️)
active → active            (User: 📌 – updated_at wird resettet)
active → project           (User: 🚀)
archived → active          (Resurface bringt es zurück)
```

### 3.3 idea_resurface

Findet Ideen die Aufmerksamkeit brauchen. Das ist das Kern-Tool für den Resurface-Cron.

```typescript
idea_resurface(
  mode: "stale" | "clusters" | "decay_warning" | "all",
) → {
  stale: Array<{id, title, days_stale, urgency}>,
  clusters: Array<{
    theme: string,
    member_ids: string[],
    shared_tags: string[],
  }>,
  decay_warnings: Array<{id, title, urgency, days_since_action}>,
}
```

**Interne Queries:**

```sql
-- Stale Ideas: unprocessed seit > 7 Tagen, NICHT in den letzten 3 Tagen schon gezeigt.
-- Der last_resurfaced_at-Cooldown verhindert, dass derselbe Stale-Eintrag täglich
-- den Digest spammt, wenn der User nicht reagiert (Backoff statt Endlos-Wiederholung).
SELECT k.id, k.title, k.updated_at, m.urgency,
  julianday('now') - julianday(k.updated_at) as days_stale
FROM knowledge k
JOIN ideaforge_meta m ON k.id = m.entry_id
WHERE m.status = 'unprocessed'
AND k.updated_at < datetime('now', '-7 days')
AND (m.last_resurfaced_at IS NULL OR m.last_resurfaced_at < datetime('now', '-3 days'))
ORDER BY m.urgency DESC, days_stale DESC
-- Nach dem Digest: UPDATE ideaforge_meta SET last_resurfaced_at = datetime('now')
-- für alle gezeigten Einträge.

-- Cluster-Kandidaten, SCHRITT 1: Ideen-PAARE mit ≥ 2 gemeinsamen Tags
-- Diese Query liefert PAARE (Kanten), keine fertigen Cluster.
SELECT t1.entry_id as id1, t2.entry_id as id2,
  GROUP_CONCAT(t1.tag) as shared_tags,
  COUNT(*) as tag_overlap
FROM entry_tags t1
JOIN entry_tags t2 ON t1.tag = t2.tag AND t1.entry_id < t2.entry_id
JOIN knowledge k1 ON t1.entry_id = k1.id AND k1.type = 'idea'
JOIN knowledge k2 ON t2.entry_id = k2.id AND k2.type = 'idea'
JOIN ideaforge_meta m1 ON k1.id = m1.entry_id AND m1.status = 'active'
JOIN ideaforge_meta m2 ON k2.id = m2.entry_id AND m2.status = 'active'
GROUP BY t1.entry_id, t2.entry_id
HAVING tag_overlap >= 2

-- Decay Warnings: urgency=now aber keine Aktion seit 3 Tagen
SELECT k.id, k.title, m.urgency,
  julianday('now') - julianday(k.updated_at) as days_since_action
FROM knowledge k
JOIN ideaforge_meta m ON k.id = m.entry_id
WHERE m.urgency = 'now'
AND m.status = 'active'
AND k.updated_at < datetime('now', '-3 days')
```

**SCHRITT 2 (Pair → Cluster, in TypeScript):** Die Paar-Query liefert Kanten eines Graphen. Ein Cluster = Connected Component dieses Graphen mit **≥ 3 Mitgliedern** (Definition §4.3). Die Aggregation läuft im Tool-Code (Union-Find über die Paare), nicht in SQL:

```typescript
// Paare → Connected Components via Union-Find, dann Components mit ≥3 Membern
// als Cluster zurückgeben. theme = häufigster shared_tag der Component.
function clustersFromPairs(pairs: Pair[]): Cluster[] { /* Union-Find */ }
```

Das `clusters`-Return aus §3.3 (`theme`, `member_ids[]`, `shared_tags[]`) entsteht erst nach diesem Schritt. Die rohe SQL-Query allein erfüllt den Return-Vertrag NICHT.

Keine LLM-Kosten für das Finden. Nur SQLite-Queries + lokale Aggregation auf bestehenden Daten.

### 3.4 idea_digest

Formatiert die Resurface-Ergebnisse als Telegram-Digest.

```typescript
idea_digest(
  resurface_result: ResurfaceResult,
) → {
  message: string,             // Formatierter Telegram-Text
  buttons: Array<{             // Inline-Buttons
    text: string,
    callback_data: string,
  }>,
}
```

**Beispiel-Output:**

```
📋 Dein Ideen-Digest – 08.02.2026

⏰ 3 Ideen warten auf deine Entscheidung:
1. Podologie-Pricing Agent (12 Tage)
2. n8n + SDK Reporting Tool (9 Tage)
3. Voice-to-Blog Pipeline (7 Tage)

🧩 Cluster erkannt:
4 Ideen zu "Agent Orchestration" (tech/ai/orchestration)

⚡ Achtung:
"Investor Deck aktualisieren" ist seit 4 Tagen auf "now"!

Buttons: [🗑️ 1] [📌 1] [🚀 1] [🗑️ 2] [📌 2] [🚀 2] ...
```

### 3.5 Tool-Übersicht

| Tool | Zweck | LLM-Kosten | Aufgerufen von |
|---|---|---|---|
| `idea_store` | Idee erfassen + klassifizieren | ~$0.001 (Haiku) | Intake Agent |
| `idea_status` | Status ändern | $0.00 | Telegram Callback |
| `idea_resurface` | Stale/Cluster/Warnings finden | $0.00 (nur SQL) | Cron-Job |
| `idea_digest` | Telegram-Nachricht formatieren | $0.00 | Cron-Job |

---

## 4. Agent-Architektur (aktualisiert)

### 4.1 Agents und ihre Tools

```
┌──────────────────────────────────────────────────────┐
│                    IdeaForge Agents                    │
│                                                       │
│  Intake Agent (Haiku)                                 │
│  └── Tools: idea_store, memory_connect                │
│                                                       │
│  Research Agent (Sonnet)                              │
│  └── Tools: web_search, fetch_url, memory_update      │
│                                                       │
│  Connection Agent (Haiku)                             │
│  └── Tools: memory_connect, memory_traverse           │
│  └── (meist automatisch via idea_store Discovery)     │
│                                                       │
│  Resurface Agent (Haiku + Opus für Synthese)          │
│  └── Tools: idea_resurface, idea_digest, idea_status  │
│  └── Cron: täglich 09:00                              │
│                                                       │
│  Telegram Handler                                     │
│  └── Tools: idea_status (Callback-Buttons)            │
└──────────────┬───────────────────────────────────────┘
               │ nutzt
┌──────────────▼───────────────────────────────────────┐
│              agent-memory v2-lite                      │
│                                                       │
│  memory_store, memory_search, memory_connect,         │
│  memory_traverse, memory_read, memory_update,         │
│  memory_note, memory_forget, memory_commit            │
└───────────────────────────────────────────────────────┘
```

### 4.2 Pipeline Flow (aktualisiert)

```
DU (Telegram)
 │
 ├── Voice Note → Whisper (lokal) → Text
 ├── Link → readability-cli → Clean Text
 ├── Screenshot → Haiku Vision → Text
 ├── YouTube → yt-dlp → Transcript
 ├── Plain Text → direkt
 │
 ▼
┌─────────────────────────────────────────┐
│  INTAKE AGENT (Haiku)                   │
│  → idea_store(content, source_type)     │
│  → Klassifiziert, generiert Title+Tags  │
│  → memory_store() wird intern aufgerufen│
│  → Auto-Discovery liefert Vorschläge    │
│  → Agent setzt Connections              │
└──────────────┬──────────────────────────┘
               │ (nur wenn needs_research erkannt)
               ▼
┌─────────────────────────────────────────┐
│  RESEARCH AGENT (Sonnet)                │
│  → web_search, fetch_url (max 3x)      │
│  → memory_update() mit Research-Inhalt  │
│  → idea_status(id, "active")            │
└──────────────┬──────────────────────────┘
               │
               ▼
         Telegram Confirmation
         "✅ Gespeichert: Title | Tags | Connections"
```

```
TÄGLICH 09:00 (Cron)
 │
 ▼
┌─────────────────────────────────────────┐
│  RESURFACE AGENT                        │
│  → idea_resurface(mode="all")           │
│  → idea_digest(results)                 │
│  → (bei Cluster ≥ 3: Opus Synthese)    │
│  → Telegram Digest senden               │
└──────────────┬──────────────────────────┘
               │
               ▼
         User klickt Buttons
         🗑️ → idea_status(id, "archived")
         📌 → idea_status(id, "active")  
         🚀 → idea_status(id, "project")
```

### 4.3 Cluster-Handling (vereinfacht)

Cluster sind keine eigene Entität. Ein Cluster ist einfach eine Gruppe von Ideen die `idea_resurface` als zusammengehörig erkennt (≥ 3 Ideen mit ≥ 2 gemeinsamen Tags).

Wenn der User "Details?" klickt, passiert:
1. Opus bekommt die Cluster-Ideen als Input
2. Opus schreibt eine Synthese
3. Die Synthese wird als neue Idee gespeichert: `idea_store(type="synthesis", connections=[part_of zu allen Cluster-Membern])`
4. User entscheidet ob der Cluster ein Projekt wird (🚀)

Kein Cluster-Lifecycle, keine Cluster-Tabelle, kein Cluster-Merge. Eine SQL-Query, ein Opus-Call, eine neue Idee mit Connections. Fertig.

---

## 5. Pre-Processing Tools (außerhalb agent-memory)

Diese Tools sind IdeaForge-spezifisch und haben nichts mit agent-memory zu tun. Sie leben im IdeaForge-Projekt, nicht in der Extension.

| Tool | Technologie | Funktion | Fallback |
|---|---|---|---|
| whisper_transcribe | Whisper CLI (lokal) | Voice → Text | OpenAI Whisper API |
| fetch_url | readability-cli | URL → Clean Text | Playwright Headless |
| web_search | SearXNG (self-hosted) | Websuche | DuckDuckGo (ddgr) |
| youtube_transcript | yt-dlp | Video → Transcript | YouTube Transcript API |
| telegram_send | Telegram Bot API | Nachrichten senden | – |
| telegram_callback | Telegram Bot API | Button-Callbacks empfangen | – |

---

## 6. Telegram Bot Interface

### 6.1 Commands

| Command | Funktion |
|---|---|
| (kein Command) | Idee/Link/Voice wird automatisch verarbeitet |
| `/search <query>` | `memory_search` auf alle Ideen |
| `/status` | Übersicht: X aktive, Y unprocessed, Z archived |
| `/recent` | Letzte 10 gespeicherte Ideen |
| `/digest` | Manueller Digest (ohne auf Cron zu warten) |
| `/config` | Einstellungen (Digest-Zeit, Research on/off) |

### 6.2 Inline-Buttons

| Button | Callback | Aktion |
|---|---|---|
| 🗑️ | `archive:{id}` | `idea_status(id, "archived")` |
| 📌 | `keep:{id}` | `idea_status(id, "active")` – resettet updated_at |
| 🚀 | `project:{id}` | `idea_status(id, "project")` |
| 🔍 | `details:{id}` | `memory_read` + `memory_traverse` → Vollständiger Inhalt |

---

## 7. Kostenmodell

### 7.1 Pro Idee

| Szenario | Modell | Tokens | Kosten |
|---|---|---|---|
| Text-Idee (Klassifizierung) | Haiku | ~800 | ~$0.001 |
| Link Capture (kein Research) | Haiku | ~600 | ~$0.001 |
| Voice + Research | Haiku + Sonnet | ~3.800 | ~$0.02 |
| Täglicher Digest (10 Items) | – (nur SQL) | 0 | $0.00 |
| Cluster-Synthese | Opus | ~1.500 | ~$0.05 |

### 7.2 Monatlich (100 Ideen)

| Posten | Monatlich |
|---|---|
| 60x einfache Ideen | $0.06 |
| 40x mit Research | $0.80 |
| 30x Digests | $0.00 |
| 4x Cluster-Synthesen | $0.20 |
| Hetzner VPS | €5.29 |
| **Gesamt** | **~€7/Monat** |

---

## 8. Error Handling

| Fehler | Auto-Fix | Degradation | Eskalation |
|---|---|---|---|
| Whisper Timeout | Retry 2x | Fallback: OpenAI API | "Voice nicht erkannt" |
| URL nicht erreichbar | Playwright Fallback | Nur URL speichern | "Seite nicht lesbar" |
| API Rate Limit | Exponential Backoff | Queue | "Verzögerung" |
| Haiku-Klassifizierung invalide | Schema-Validation | Nur Raw Content speichern | "Konnte nicht klassifizieren" |
| ideaforge_meta inkonsistent | Rebuild aus Frontmatter | – | Nie – Frontmatter ist Truth |

---

## 9. Implementation Roadmap

**Voraussetzungen (beide zwingend):**
1. agent-memory v2-lite ist implementiert (Phase 1–4).
2. Das **Extension System** (eigenes PRD) ist implementiert — inklusive Core-Voraussetzungen C1–C6 (§2.5 dort). Insbesondere C1 (offener `type`-Wert `idea`/`synthesis`) ist Blocker für IdeaForge.

### Phase 1: Extension + Intake (Woche 1)

- IdeaForge Extension registrieren
- `ideaforge_meta`-Tabelle
- `idea_store`-Tool (Wrapper um `memory_store` + Haiku-Klassifizierung)
- `idea_status`-Tool
- Telegram Bot: Nachrichten empfangen → `idea_store` aufrufen
- Pre-Processing: Text und URL (Voice kommt in Phase 2)

> **Milestone:** Text-Ideen und Links werden über Telegram erfasst, klassifiziert und in agent-memory gespeichert.

### Phase 2: Pre-Processing (Woche 2)

- Whisper Integration für Voice Notes
- YouTube Transcript Extraction
- Screenshot-Verarbeitung via Haiku Vision
- Research Agent mit Sonnet
- Fehlerbehandlung + Fallbacks

> **Milestone:** Alle Input-Typen funktionieren.

### Phase 3: Resurface (Woche 3)

- `idea_resurface`-Tool (SQL-Queries)
- `idea_digest`-Tool (Telegram-Formatierung)
- Cron-Job für täglichen Digest
- Telegram Inline-Buttons + Callbacks
- Cluster-Detection (Tag-Overlap-Query)
- Opus-Synthese für Cluster

> **Milestone:** Täglicher Digest mit Stale Ideas, Cluster und Decay Warnings. Buttons funktionieren.

### Phase 4: Polish (Woche 4)

- Research-Aggressivität konfigurierbar
- Digest-Zeitpunkt konfigurierbar
- Duplicate Detection (Fuzzy-Match auf Title)
- Multi-Idea Splitting
- Performance-Optimierung
- End-to-End Tests

> **Milestone:** IdeaForge ist produktionsreif.

**Gesamt: 4 Wochen** (nach v2-lite, also Woche 5–8 im Gesamtplan)

---

## 10. Erfolgskriterien

| Metrik | Ziel | Messmethode |
|---|---|---|
| Capture-to-Storage | < 30 Sekunden | Zeitstempel |
| Kosten pro Idee (einfach) | < $0.002 | Token-Logging |
| Kosten pro Idee (mit Research) | < $0.03 | Token-Logging |
| Ideen-Wiederbelebungsrate | > 40% Aktion auf Resurface | Callback-Tracking |
| False-Positive Connections | < 15% | Review-Sampling |
| Extension sauber deinstallierbar | Keine Rückstände in knowledge/connections | Automatisierter Test |
| Adoption | ≥ 3 Ideen pro Tag nach 2 Wochen | Zählung |
| Retention | Keine Nutzungs-Abnahme nach 4 Wochen | Trend-Analyse |

> **Mess-Voraussetzung:** „False-Positive Connections < 15%" ist nur prüfbar gegen ein **gelabeltes Ground-Truth-Set** unter `tests/fixtures/ideaforge/` (Ideen-Paare mit „verwandt: ja/nein"). **Externe Vorbedingung:** Das Labeling muss der Owner liefern — kein Coding-Task, sondern ein Gate vor der Acceptance-Prüfung. Adoption/Retention sind Produkt-KPIs (Beobachtung nach Launch), **keine** Implementierungs-Akzeptanzkriterien — für den Coding-Agent zählen nur die technisch messbaren Zeilen (Capture-Zeit, Kosten, Deinstallation). „Produktionsreif" (§9) = alle technischen Ziele erfüllt + E2E-Tests grün.

---

## 11. Deinstallation

Falls IdeaForge nicht mehr gebraucht wird:

```bash
agent-memory extensions uninstall ideaforge
```

**Was passiert:**
1. `ideaforge_meta`-Tabelle wird gelöscht
2. `ext.ideaforge:`-Block wird aus allen Frontmatter entfernt
3. Extension-Tools werden deregistriert
4. Cron-Job wird gestoppt

**Was bleibt:**
- Alle Ideen-Dateien bleiben als `type: idea` in `knowledge`
- Alle Connections bleiben erhalten
- Alle Tags bleiben erhalten
- Git-History bleibt vollständig

Die Ideen leben als normales Wissen in v2-lite weiter. Sie haben nur kein Status-Tracking und keinen Resurface-Loop mehr.

---

*IdeaForge Extension v1.1 – fitznerIO AI Services – Februar 2026*
