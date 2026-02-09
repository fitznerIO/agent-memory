# Review: SEARCH-IMPROVEMENT-PLAN.md

**Datum:** 2026-02-09
**Perspektive:** Agentic Coding / Vector DBs / Speichersysteme
**Scope:** Aktuelles System bewerten → Plan gegen reale Schwächen prüfen

---

## 0. Was seit Erstellung des Plans passiert ist

Der Plan wurde vor den Commits `bd5241a`–`00b3b4e` geschrieben. Seitdem wurden **zwei der vier Maßnahmen teilweise umgesetzt:**

| Plan-Maßnahme | Status | Commit |
|----------------|--------|--------|
| §1 Score-Normalisierung (RRF → Raw-Score) | **Nicht umgesetzt** — aber Dynamic k implementiert | `3a18606` |
| §2 Embedding-Modell (→ multilingual-e5-base 768d) | **Teilweise** — multilingual-MiniLM statt e5-base, weiterhin 384d | `bd5241a` |
| §3 Deutsche FTS-Vorbereitung | **Nicht umgesetzt** | — |
| §4 Query Expansion | **Nicht umgesetzt** | — |

Zusätzlich: E2E Scoring-Test existiert (`00b3b4e`), der Score-Spread > 0.05 und Query-Differenzierung prüft.

---

## 1. Bewertung des aktuellen Systems

### 1.1 Was funktioniert

**Embedding-Modell** (`Xenova/paraphrase-multilingual-MiniLM-L12-v2`, 384d)
- Multilingual: 50+ Sprachen inkl. Deutsch
- Paraphrase-Variante: optimiert auf semantische Ähnlichkeit (nicht nur NLI)
- 384d ist ausreichend für Korpora < 500 Dokumente
- L2-normalisiert → Cosine Distance über sqlite-vec ist korrekt

**Hybrid Search Architektur**
- RRF mit dynamischem k (`min(rrfK, poolSize/4)`) löst das Kompressionsproblem für kleine Korpora
- 3x Pool-Size vor Merge ist Standard-Practice
- Recency-Boost mit 365-Tage-Halbwertzeit ist vernünftig konservativ
- Gewichtung 0.4/0.55/0.05 priorisiert Vector-Kanal korrekt

**v2-lite Infrastruktur**
- `knowledge` + `entry_tags` + `connections` Tabellen sind vorhanden und indexiert
- Access-Tracking mit `last_accessed` / `access_count` funktioniert
- Bidirektionale Connections mit Inverse-Types

**Testabdeckung**
- Unit-Tests für FTS, Vector, Hybrid einzeln
- E2E-Test prüft Score-Spread und Query-Differenzierung
- v2-lite Tests für Knowledge CRUD, Tags, Connections

### 1.2 Reale Schwächen

**Schwäche 1: RRF-Scores sind nicht interpretierbar** — BESTÄTIGT

Dynamic k verbessert den Spread, aber die Scores bleiben im RRF-typischen Bereich (< 1.0, nicht normalisiert). Ein Agent kann aus `score: 0.23` nicht ableiten ob das Ergebnis relevant ist. `minScore: 0.1` ist effektiv deaktiviert — es filtert fast nichts.

```
Aktuelles Verhalten:
  Top-Treffer:     ~0.19–0.30
  Irrelevant:      ~0.12–0.18
  Differenz:       ~0.07–0.12
  → Threshold-basiertes Filtering funktioniert nicht zuverlässig
```

**Schwäche 2: FTS5 kann kein Deutsch** — BESTÄTIGT

Porter Stemmer (`tokenize='porter unicode61'`) ist ein englischer Stemmer. Nachweisbare Lücken:
- "Stundensätze" ≠ "Stundensatz" (kein Plural-Match)
- "KI-Services" wird nicht in "KI" + "Services" aufgelöst
- "Patientenkommunikation" wird nicht in Bestandteile zerlegt
- Bei gemischtsprachigem Content (DE/EN) greift Porter nur auf der EN-Seite

Impact: Der FTS-Kanal (40% Gewicht) underperformt systematisch bei deutschem Content. Der Vector-Kanal kompensiert das teilweise, aber 40% des Scoring-Budgets sind verschwendet.

**Schwäche 3: v2-lite Features werden im Search-Ranking nicht genutzt**

`entry_tags` und `connections` existieren in der DB, fließen aber **nicht** in das Hybrid-Scoring ein:
- Keine Tag-Überlappung als Ranking-Signal
- Keine Connection-Proximity als Boost
- Kein Type-Boosting (Decision vs. Note)
- `searchHybrid` arbeitet ausschließlich auf der `memories`-Tabelle

Das ist die größte verpasste Chance: Die v2-lite Datenstruktur IST da, wird für Ranking aber ignoriert.

**Schwäche 4: Schema-Kommentar ist veraltet**

`schema.sql:36` sagt `-- 384 dimensions for all-MiniLM-L6-v2`, das Modell ist aber `paraphrase-multilingual-MiniLM-L12-v2`. Kein funktionaler Bug, aber ein Wartungsproblem.

**Schwäche 5: Kein Benchmark mit Ground Truth**

Der E2E-Test (`hybrid-search-scoring.test.ts`) prüft nur:
- Score-Spread > 0.05
- Verschiedene Queries → verschiedene Top-Ergebnisse

Das ist notwendig aber nicht hinreichend. Es fehlt:
- Precision@K mit erwarteten Ergebnissen
- Recall-Messung (findet die Suche alle relevanten Docs?)
- Ranking-Qualität (nDCG): Ist die Reihenfolge korrekt?

---

## 2. Bewertung der offenen Plan-Maßnahmen

### §1 Score-Normalisierung — Löst Schwäche 1

**Empfehlung: Umsetzen, aber anders als beschrieben.**

| Plan-Vorschlag | Problem | Alternative |
|----------------|---------|-------------|
| Sigmoid auf BM25 | Scale-Parameter ist Corpus-abhängig, fragil bei wachsendem Index | Min-Max-Normalisierung über die Ergebnismenge |
| Raw-Score-Fusion statt RRF | RRF ist robuster gegenüber Score-Skala-Unterschieden | RRF beibehalten, Output-Score auf 0–1 remappen |

**Pragmatischer Ansatz:** RRF-Scoring beibehalten (funktioniert), aber den finalen Score über die aktuelle Ergebnismenge auf 0–1 normalisieren:

```
normalized = (score - minScore) / (maxScore - minScore)
```

- Bereich: 0.0–1.0 (per Definition)
- Top-Treffer: immer ~1.0
- Worst Treffer: immer ~0.0
- `minScore: 0.3` wird interpretierbar
- Kein empirischer Scale-Parameter
- Edge Case 1 Ergebnis: Score = 1.0

**Aufwand:** 0.5 Tage (implementierung + Tests)

---

### §2 Embedding-Modell-Upgrade — Löst aktuell keine nachgewiesene Schwäche

Der Plan schlug `intfloat/multilingual-e5-base` (768d) vor. Das aktuelle Modell ist bereits multilingual.

**Status:** Der Modell-Switch von `all-MiniLM-L6-v2` → `paraphrase-multilingual-MiniLM-L12-v2` war der richtige Schritt. Ein weiteres Upgrade auf e5-base bringt:

| Pro | Contra |
|-----|--------|
| 768d → feinere Differenzierung | Doppelter Speicher im Vec-Index |
| Besseres Training auf Deutsch | Schema-Migration nötig (`float[384]` → `float[768]`) |
| Query/Passage-Prefixes verbessern Retrieval | Alle Embeddings müssen neu berechnet werden |
| | Prefix-Logik muss in `engine.ts` (Query vs. Passage) |
| | **Kein Benchmark der den Bedarf belegt** |

**Empfehlung: Zurückstellen.** Erst Benchmark mit Ground Truth erstellen. Wenn der Vector-Kanal nachweislich das Bottleneck ist (falsche Ranking-Reihenfolge trotz richtiger FTS-Treffer), dann upgraden. Sonst nicht.

Falls doch: Unbedingt **VOR** der Score-Normalisierung, weil sich die Raw-Score-Verteilung ändert.

---

### §3 Deutsche FTS-Vorbereitung — Löst Schwäche 2 teilweise

**Differenzierte Bewertung der drei Teilmaßnahmen:**

#### a) Bindestrich-Splitting — MACHEN

```typescript
// Trivial, risikoarm, sofort wirksam
"KI-Services" → "KI-Services KI Services"
"DSGVO-konform" → "DSGVO-konform DSGVO konform"
```

Aufwand: 1–2 Stunden. Kein Risiko. Sofortiger Gewinn für gemischtsprachige Terme.

#### b) Kompositazerlegung per Regex — NICHT MACHEN

Der Plan behauptet "~30 Zeilen Regex". Deutsche Kompositazerlegung ist ein NLP-Forschungsproblem:

```
"Staubecken"  → "Stau+becken" oder "Staub+ecken"?
"Wachstube"   → "Wach+stube" oder "Wachs+tube"?
"Hochzeit"    → NICHT "Hoch+zeit"
"Erzählung"   → NICHT "Erz+ählung"
```

Ohne Wörterbuch oder statistisches Modell produziert Regex-Splitting systematisch False Positives. Bei < 200 Dokumenten ist das Kosten-Nutzen-Verhältnis schlecht: Der Vector-Kanal erkennt "Patientenkommunikation" ≈ "Patient" semantisch ohnehin.

#### c) Einfaches deutsches Stemming — NICHT in Regex-Form

Die vorgeschlagenen Regeln (Endungen -en, -er, -e, -s abschneiden wenn Wort > 5 Zeichen) produzieren Müll:

```
"Messer"   → "Mess" ❌      "Butter"    → "Butt" ❌
"Wasser"   → "Wass" ❌      "Fenster"   → "Fenst" ❌
"Computer" → "Comput" ❌    "Kalender"  → "Kalend" ❌
```

**Alternative:** Snowball German Stemmer als npm-Paket. `snowball-stemmers` oder `natural` liefern einen getesteten deutschen Stemmer. Aufwand: 0.5–1 Tag für Integration + Custom-Tokenizer in FTS5 (oder Preprocessing-Layer).

**Gesamtempfehlung für §3:**
- Bindestrich-Splitting: Ja (2h)
- Regex-Komposita/Stemming: Nein
- Snowball German Stemmer: Evaluieren, nicht sofort. Erst Benchmark zeigen lassen ob FTS wirklich das Bottleneck ist, oder ob eine Gewichtsverschiebung Richtung Vector reicht.

---

### §4 Query Expansion — Löst kein priorisiertes Problem

**Statische Synonym-Map (Plan-Vorschlag A):** Widerspricht dem PRD-Kernprinzip. 50-100 Einträge pflegen ist manueller Aufwand, egal ob der Agent oder der User es tut. Bei einem System das auf "Null Pflege-Aufwand für den User" ausgelegt ist, ist das ein Designbruch.

**Embedding-basierte Expansion (Plan-Vorschlag B):** Theoretisch elegant, praktisch Over-Engineering für < 200 Docs.

**Pragmatische Alternative: Gewichte verschieben.**

Wenn der FTS-Kanal bei Deutsch systematisch schwächelt, ist die einfachste Maßnahme das Vector-Gewicht zu erhöhen:

```
Aktuell:    FTS 0.40 / Vector 0.55 / Recency 0.05
Vorschlag:  FTS 0.25 / Vector 0.70 / Recency 0.05
```

Der Vector-Kanal löst Synonyme implizit ("Preise" ≈ "Pricing" ≈ "Kosten" im Embedding-Space). Mehr Gewicht = mehr Einfluss auf das Ranking. Das ist eine Config-Änderung, kein neuer Code.

---

## 3. Was der Plan komplett übersieht

### v2-lite Features als Ranking-Signale

Die größte verpasste Chance. Drei sofort nutzbare Signale:

**a) Tag-Overlap-Boost**
Wenn die Query-Ergebnisse und der aktuelle Kontext (z.B. aktive Tags aus der Session) überlappen, könnten Ergebnisse mit matchenden Tags höher gerankt werden. Die `entry_tags`-Tabelle ist da, wird aber nicht im Scoring genutzt.

**b) Connection-Proximity**
Wenn der Agent gerade an `dec-007` arbeitet, sollten Ergebnisse die direkte Connections zu `dec-007` haben, einen Boost bekommen. Das wäre ein natürliches "Context-Aware Search".

**c) Type-Weighting**
Nicht alle Knowledge-Typen sind gleich relevant. Für eine architektonische Frage sind `decision`-Einträge relevanter als `session`-Logs. Ein Type-Boost-Multiplikator im Scoring wäre trivial:

```typescript
const TYPE_BOOST: Record<string, number> = {
  decision: 1.2,
  pattern: 1.15,
  incident: 1.1,
  workflow: 1.0,
  entity: 1.0,
  note: 0.9,
  session: 0.8,
};
```

Diese drei Maßnahmen nutzen vorhandene Datenstrukturen und erfordern keinen neuen Index, keine NLP-Library und keine Pflege.

### Benchmark-Framework

Ohne Ground-Truth-Benchmark ist jede behauptete Verbesserung Spekulation. Der existierende E2E-Test (`hybrid-search-scoring.test.ts`) ist ein Smoke-Test, kein Benchmark. Was fehlt:

```typescript
// 20-30 Queries mit erwarteten Top-Ergebnissen
const BENCHMARK = [
  { query: "SSL Zertifikat Problem", expected: ["inc-001", "inc-002"] },
  { query: "Warum Webhooks statt Polling", expected: ["dec-001"] },
  { query: "Kubernetes Deployment", expected: ["doc-devops"] },
  // ...
];

// Metriken
// - Precision@3: Wie viele der Top 3 sind relevant?
// - MRR (Mean Reciprocal Rank): Wo steht das erste relevante Ergebnis?
```

Aufwand: 0.5 Tage. Einmal gebaut, validiert jede zukünftige Änderung automatisch.

---

## 4. Empfohlene Priorisierung

| # | Maßnahme | Aufwand | Löst | Impact |
|---|----------|---------|------|--------|
| 1 | **Benchmark-Suite** mit Ground Truth | 0.5 Tage | Messbarkeit | Basis für alles weitere |
| 2 | **Score-Normalisierung** (Min-Max auf RRF) | 0.5 Tage | Schwäche 1 | `minScore` wird nutzbar |
| 3 | **Bindestrich-Splitting** im FTS-Preprocessing | 2 Std. | Schwäche 2 (teilweise) | Trivial, risikoarm |
| 4 | **Gewichte tunen** (FTS↓ Vector↑), Benchmark-gesteuert | 1 Std. | Schwäche 2 (kompensiert) | Config-only, kein Code |
| 5 | **Tag-Boosting / Type-Weighting** im Hybrid-Score | 0.5 Tage | Schwäche 3 | Low-Hanging Fruit |
| 6 | **Schema-Kommentar fixen** | 5 Min. | Schwäche 4 | Hygiene |
| | **Gesamt** | **~2 Tage** | | |

### Was ich **nicht** in der nächsten Iteration empfehle

| Maßnahme | Grund |
|----------|-------|
| Embedding-Modell-Upgrade auf e5-base | Kein Benchmark der den Bedarf belegt. Aktuelle MiniLM ist bereits multilingual. |
| Regex-Kompositazerlegung | Fehleranfällig, Aufwand-Nutzen stimmt nicht bei < 200 Docs |
| Regex-Stemming für Deutsch | Zu viele False Positives ohne Wörterbuch |
| Statische Synonym-Map | Widerspricht PRD-Prinzip "Null manueller Pflegeaufwand" |

---

## 5. Fazit

Der Plan identifiziert die richtigen Probleme (Score-Kompression, FTS-Schwäche bei Deutsch), aber:

1. **Zwei Maßnahmen sind schon teilweise umgesetzt** (Modell-Switch, Dynamic k) — der Plan ist veraltet.
2. **Die größte Chance wird ignoriert:** v2-lite hat Tags, Connections und Knowledge-Types die als Ranking-Signale sofort nutzbar wären.
3. **German NLP wird unterschätzt:** Kompositazerlegung und Stemming per Regex sind keine "~30 Zeilen" — sie sind ein Wartungsproblem.
4. **Ohne Benchmark ist alles Spekulation.** Das muss der erste Schritt sein, nicht Score-Normalisierung.

Die empfohlene Priorisierung (Benchmark → Min-Max-Normalisierung → Bindestrich-Split → Gewichte tunen → Tag/Type-Boosting) kostet ~2 Tage, nutzt die vorhandene v2-lite-Infrastruktur und ist in jedem Schritt messbar.
