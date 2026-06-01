# Task 001: Phase 0 — C1 Runtime-KnowledgeType-Registry

## Dependencies
- Requires: None

## Description
(aus Ext-PRD §2.5 C1 + §8.4.1)

`KnowledgeType` ist heute eine geschlossene Union (`src/shared/types.ts:222`). `knowledgeTypeDir()` und `knowledgeToMemoryType()` sind erschöpfende `switch` ohne `default` (`src/shared/utils.ts:76,96`) → ein unbekannter Typ ⇒ `undefined` ⇒ Pfad-`join()` bricht.

C1 ist kein einzelnes Feld, sondern ein Core-Refactor: fünf Funktionen, die heute die geschlossene Union zur Compile-Zeit lesen, müssen stattdessen ein **Laufzeit-Registry** konsultieren. Neu:

```typescript
// src/shared/knowledge-types.ts (neu) — mutable Registry, mit den 7 Kern-Typen geseedet
registerKnowledgeType(decl: { type: string; dir: string; v1Type: "semantic"|"episodic"|"procedural"; idPrefix: string }): void
```

Diese 5 Funktionen müssen vom switch/const auf das Registry umgestellt werden:

| Funktion | Datei | Heute | Nach C1 |
|---|---|---|---|
| `knowledgeTypeDir()` | `src/shared/utils.ts:76` | `switch` ohne default | Registry-Lookup `dir` |
| `knowledgeToMemoryType()` | `src/shared/utils.ts:96` | `switch` ohne default | Registry-Lookup `v1Type` |
| `TYPE_PREFIX` / `PREFIX_TO_TYPE` | `src/shared/utils.ts:8,19` | `const` Record | aus Registry abgeleitet |
| `getNextSequentialId()` | `src/search/index.ts:835` | nutzt `TYPE_PREFIX` | Registry-`idPrefix` (tolerant: `?? type`) |
| `rebuildIndex()` Typ-Gate | `src/index.ts:888` | hartes `KNOWLEDGE_TYPES`-Set | Registry-Keys (Kern + Extension) |

**`rebuildIndex()` ist kritisch:** Das hartcodierte `KNOWLEDGE_TYPES`-Set lässt `isV2Lite` für `transaction`/`idea`/… **false** werden → diese Einträge werden bei `rebuild-index` nicht in die `knowledge`-Tabelle geschrieben, alle `JOIN <ext>_meta`-Queries brechen. Da `rebuild-index` als Mitigation für dangling Connections empfohlen wird, würde der Recovery-Pfad sonst alle Extension-Einträge ent-indexieren. Das Typ-Gate MUSS aus dem Registry kommen.

**Wann wird registriert (Reihenfolge zwingend):**
1. Beim Startup für jede installierte Extension: `loadExtensions()` ruft `registerKnowledgeType()`, bevor der erste Tool-Call laufen kann.
2. Beim Install: `installExtension()` registriert die Typen vor `onInstall`.
3. Registry-Einträge mergen mit den 7 Kern-Typen, überschreiben sie nie. Doppelter `type` oder `idPrefix` ⇒ Install-Fehler.

## Expected Outcome
- `src/shared/knowledge-types.ts` existiert: `registerKnowledgeType()` + die 7 Kern-Typen (`decision`/`incident`/`entity`/`pattern`/`workflow`/`note`/`session`) vorgeseedet mit ihren bisherigen `dir`/`v1Type`/`idPrefix`-Werten.
- `knowledgeTypeDir()`, `knowledgeToMemoryType()`, `TYPE_PREFIX`/`PREFIX_TO_TYPE`, `getNextSequentialId()` und das `rebuildIndex()`-Typ-Gate konsultieren das Registry.
- Ein nicht registrierter Typ bricht nicht mehr hart (definierter Fallback statt `undefined`).
- Modul-Isolation gewahrt: Registry liegt in `src/shared/` (erlaubter Import für alle Module).
- Alle bestehenden Tests grün — die 7 Kern-Typen verhalten sich identisch zu vorher.

## Agent Context
Erste Phase-0-Aufgabe, baut auf nichts auf. Der Core nutzt heute geschlossene `switch`/`const` über `KnowledgeType`. Diese Aufgabe macht den Typ-Satz zur Laufzeit erweiterbar — die zentrale Voraussetzung, ohne die keine Extension lauffähig ist.
