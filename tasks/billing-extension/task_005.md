# Task 005: Phase 4 — Polish (weitere Formate/Downloader, Jahresübersicht, Error-Handling, Tests)

## Dependencies
- Requires: 003, 004

## Description
(aus Billing-PRD §14 Phase 4, §15, §16)

- Weitere Bank-Formate (ING, Commerzbank, N26)
- Weitere Anbieter-Downloader + Generic Downloader für unbekannte Portale (Login → Rechnungsseite → PDF)
- Jahresübersicht
- Duplikat-Erkennung bei erneutem Import härten
- Error Handling + Retry-Logik
- Tests

**Erfolgskriterien (§15), als Tests prüfbar:**
| Metrik | Ziel |
|---|---|
| Sanitizer: keine sensiblen Daten in API-Calls | 100% (Audit auf API-Logs) |
| Import-Genauigkeit | > 95% korrekt geparsed |
| Anbieter-Erkennung | > 80% automatisch |
| Rechnungs-Match-Rate | > 90% automatisch |
| False Matches | 0% |
| Deinstallation sauber | keine Rückstände in knowledge/connections |

> **Mess-Voraussetzung:** Prozent-Ziele nur binär prüfbar gegen ein committed Fixture-Set (`tests/fixtures/billing/`). Externe Vorbedingung: Fixtures muss der Owner bereitstellen — kein Coding-Task, sondern ein Gate vor der Acceptance-Prüfung.

**Risiken (§16):** Bank ändert CSV-Format (Format-Detection + User-Feedback), Anbieter-Portal ändert UI (Selektoren pflegbar, Agent meldet Fehler), Sanitizer übersieht neues Pattern (Regex-Tests mit realen Auszügen, regelmäßig erweitern), PDF-Extraktion scheitert (Fallback: User bestätigt manuell).

## Expected Outcome
- ≥ 5 Bank-Formate, Generic Downloader vorhanden.
- Vollständige Test-Suite grün; Erfolgskriterien gegen Fixture-Set erfüllt (sofern Fixtures bereitgestellt).
- Error-Handling + Retry produktionsreif.
- „Produktionsreif" = alle Tabellen-Ziele erfüllt + alle Tests grün.

## Agent Context
Letzte Billing-Aufgabe; Härtung über Import (002), Match (003) und Übersicht (004). Bringt die Extension auf Produktionsreife und sichert die Erfolgskriterien per Tests ab.
