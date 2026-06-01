# Task 004: Phase 3 — billing_overview + Telegram-Interface + Digest + Wiederkehrende/Erwartungs-Check

## Dependencies
- Requires: 002, 003

## Description
(aus Billing-PRD §7.4, §10, §11, §12)

**billing_overview-Tool** (§7.4): Übersicht für eine/mehrere Perioden. Return: `period`, `total_bookings`, `by_status` (alle fünf Schlüssel, im Mapping-Layer zero-gefüllt — GROUP BY liefert nur vorkommende Status), `by_provider[]` (count, total_amount, all_matched), `action_needed[]` (nicht-abgeschlossene Buchungen mit days_pending). Reine SQL-Queries, $0 LLM.

**Telegram-Interface** (§10): CSV als Datei → `billing_import` automatisch. Commands: `/billing` (aktueller Monat), `/billing <period>`, `/billing match`, `/billing missing`, `/billing year`. Inline-Buttons für unbekannte Anbieter. Monatlicher Digest (Cron) mit Report + Aktion-nötig.

**Wiederkehrende Buchungen** (§11): Nach 3 Monaten gleicher Buchung (Anbieter + Betrag ±10%) Auto-Detection. Erwartungs-Check: bekannter monatlicher Anbieter fehlt im neuen Auszug → Warnung.

**Langzeit-Tracking** (§12): Perioden-Navigation, Jahresübersicht (Ausgaben pro Anbieter), Connections über Zeit (gleicher Anbieter automatisch verlinkt). 10-Jahres-Aufbewahrung.

## Expected Outcome
- `billing_overview` liefert vollständige Übersicht; `by_status` immer alle fünf Schlüssel (zero-fill).
- Telegram: CSV-Upload triggert Import; alle `/billing`-Commands funktionieren; unbekannte Anbieter per Inline-Button klassifizierbar.
- Monatlicher Digest als Cron.
- Wiederkehrende Buchungen erkannt; fehlende erwartete Anbieter gemeldet.
- Jahresübersicht + Perioden-Navigation per SQL.

## Agent Context
Baut auf Import (Task 002) und Match (Task 003) auf. Liefert die Nutzer-zugewandte Schicht: Übersicht, Telegram-Bot, Digest und Langzeit-Features. Damit ist der monatliche Billing-Workflow vollständig.
