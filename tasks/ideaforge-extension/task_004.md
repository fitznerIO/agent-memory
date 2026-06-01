# Task 004: Phase 4 — Polish (konfigurierbar, Duplicate Detection, Multi-Idea-Splitting, E2E-Tests)

## Dependencies
- Requires: 002, 003

## Description
(aus IdeaForge-PRD §9 Phase 4, §10)

- Research-Aggressivität konfigurierbar
- Digest-Zeitpunkt konfigurierbar (`/config`)
- Duplicate Detection (Fuzzy-Match auf Title)
- Multi-Idea Splitting (eine Nachricht mit mehreren Ideen aufteilen)
- Performance-Optimierung
- End-to-End Tests

**Erfolgskriterien (§10), als Tests prüfbar:**
| Metrik | Ziel |
|---|---|
| Capture-to-Storage | < 30 Sekunden |
| Kosten pro Idee (einfach) | < $0.002 |
| Kosten pro Idee (mit Research) | < $0.03 |
| Ideen-Wiederbelebungsrate | > 40% Aktion auf Resurface |
| False-Positive Connections | < 15% |
| Extension sauber deinstallierbar | keine Rückstände in knowledge/connections |

> **Mess-Voraussetzung:** „False-Positive Connections < 15%" nur prüfbar gegen ein gelabeltes Ground-Truth-Set (`tests/fixtures/ideaforge/`). Externe Vorbedingung: Labeling muss der Owner liefern — kein Coding-Task, sondern ein Gate vor der Acceptance-Prüfung. Adoption/Retention sind Produkt-KPIs (Beobachtung nach Launch), keine Implementierungs-Akzeptanzkriterien. „Produktionsreif" = alle technischen Ziele erfüllt + E2E-Tests grün.

## Expected Outcome
- Research-Aggressivität + Digest-Zeitpunkt konfigurierbar.
- Duplicate Detection (Fuzzy-Title) + Multi-Idea-Splitting funktionieren.
- E2E-Tests grün; technische Erfolgskriterien (Capture-Zeit, Kosten, saubere Deinstallation) erfüllt.

## Agent Context
Letzte IdeaForge-Aufgabe; Härtung über Intake/Pre-Processing (001/002) und Resurface (003). Bringt die Extension auf Produktionsreife und sichert die technisch messbaren Kriterien per E2E-Tests ab.
