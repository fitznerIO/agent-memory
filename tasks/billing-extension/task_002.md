# Task 002: Phase 1 — CSV-Parser + Anbieter-Erkennung + billing_import

## Dependencies
- Requires: 001

## Description
(aus Billing-PRD §5, §7.1, §13)

**Bank-Format-Parser** (`src/extensions/billing/`): Jede Bank exportiert CSV anders; Format wird automatisch erkannt.

```typescript
interface BankFormat {
  name: string;
  detectHeader: (headers: string[]) => boolean;
  mapColumns: { date: string; amount: string; reference: string };  // andere Spalten ignoriert
  parseAmount: (raw: string) => number;  // "1.234,56" vs "1234.56"
  dateFormat: string;
}
```
Start mit Sparkasse + DKB. Unbekanntes Format → Agent zeigt erste 3 Zeilen, User mappt Spalten, Format wird gespeichert.

**Anbieter-Erkennung** (`src/extensions/billing/providers.ts`): Mapping-Tabelle `KNOWN_PROVIDERS` (Pattern → Name + Kategorie), wächst über Zeit. Unbekannt → bereinigte Buchung trotzdem speichern, Agent klassifiziert einmalig (Haiku), neuer Anbieter wird aufgenommen. Bekannte Anbieter als eigene Knowledge-Einträge (`type: provider`, IDs `prov-NNN`).

**billing_import-Tool** (§7.1): Importiert Kontoauszug. Parsed, sanitized (Task 001), erstellt Buchungs-Einträge. Intern: CSV lesen → Format erkennen → pro Zeile: Spalten-Filter (nur Datum/Betrag/Verwendungszweck) → `sanitize()` → `extractProvider()` → Duplikat-Check (Datum + Betrag + Provider + CSV-Zeilenindex als Tiebreaker gegen False-Skip identischer Buchungen) → `memory_store(type="transaction")` + `billing_meta` INSERT. Return: `imported`, `providers_known/unknown`, `duplicates_skipped`, `period`, `unknown_bookings[]` (bereits bereinigt).

## Expected Outcome
- CSV-Parser erkennt Sparkasse + DKB automatisch; Beträge/Daten korrekt geparsed.
- `extractProvider()` erkennt bekannte Anbieter; unbekannte landen in `unknown_bookings`.
- `billing_import` erstellt `transaction`-Einträge (IDs `txn-NNN`) + `billing_meta`-Rows, mit Sanitizer im Pfad.
- Duplikat-Check verwirft keine legitimen identischen Buchungen (Zeilenindex-Tiebreaker), meldet Skips.
- Bekannte Anbieter als `provider`-Einträge (`prov-NNN`).
- Tests gegen Fixture-Auszüge (Owner-bereitgestellt, `tests/fixtures/billing/`).

## Agent Context
Baut auf Task 001 (Extension + Sanitizer) auf. Liefert den vollständigen Import-Pfad — der erste echte Use-Case, der das Extension-Interface gegen Realdaten validiert. Download/Matching (Task 003) setzt auf den so erzeugten `expected`-Buchungen auf.
