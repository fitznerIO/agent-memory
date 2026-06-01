# Task 007: Phase 3 — Validierung mit Referenz-Extension + Tests

## Dependencies
- Requires: 006

## Description
(aus Ext-PRD §14 Phase 3, §13, §15)

Eine erste echte (minimale) Extension implementieren, die das Interface gegen einen echten Use Case validiert — Anpassungen am Interface falls nötig. Ziel: das Extension System läuft end-to-end.

**Test-Layout** (`tests/extensions/`):
```
tests/extensions/
├── loader.test.ts
├── manager.test.ts
└── frontmatter.test.ts
```

**Erfolgskriterien (§15), als Tests prüfbar:**
| Metrik | Ziel |
|---|---|
| Installation einer Extension | < 1 Sekunde |
| Deinstallation sauber | Keine Rückstände in DB oder Frontmatter |
| Neue Extension hinzufügen | Core-Code-Änderung: 1 Eintrag in `AVAILABLE_EXTENSIONS` (registry.ts) |
| Extension-Isolation | Extension kann andere Extensions nicht beeinflussen |
| CASCADE Delete | Extension-Daten werden bei knowledge-Löschung mitgelöscht |

Eigene `type`-Werte überleben sowohl `store` als auch `rebuild-index` (Regressionstest gegen C1, Task 001).

## Expected Outcome
- Eine minimale Referenz-Extension (eigene Tabelle + 1 Tool + `knowledgeTypes`) ist installierbar, ihr Tool aufrufbar, sauber deinstallierbar.
- Tests in `tests/extensions/` (loader, manager, frontmatter) grün.
- Regressionstest: Extension-`type` überlebt store + rebuild-index ohne Verlust.
- Interface-Anpassungen (falls die Validierung welche aufdeckt) dokumentiert.

## Agent Context
Letzte Fundament-Aufgabe. Validiert das gesamte Extension System (Phase 0–2) mit einer echten, minimalen Extension und sichert es per Tests ab. Nach Abschluss können Billing (`tasks/billing-extension/`) und IdeaForge (`tasks/ideaforge-extension/`) implementiert werden.
