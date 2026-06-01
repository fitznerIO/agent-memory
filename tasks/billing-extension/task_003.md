# Task 003: Phase 2 — Playwright-Download + PDF-Betrag + billing_match + billing_status

## Dependencies
- Requires: 002

## Description
(aus Billing-PRD §6, §7.2, §7.3, §8)

**Status-Lifecycle** (§6): `expected → downloaded → matched → archived`, `missing` aus expected (3× Download fehlgeschlagen) UND downloaded (Betrag passt nicht). Transitions persistieren `downloaded` als Zwischenschritt; `retry_count` (aus Schema Task 001) kumulativ über `billing_match`-Runs.

**Rechnungs-Download** (§8): Pro Anbieter ein Playwright-Skript:
```typescript
interface InvoiceDownloader {
  login(page, credentials): Promise<void>;
  downloadInvoice(page, period): Promise<string>;   // → PDF-Pfad
  extractAmount(pdfPath): Promise<number>;           // → Betrag aus PDF, lokal, kein LLM
}
```
Credentials NIE in agent-memory. Decryption via `fio-vault` (`loadSecrets()`, Passphrase `FIO_VAULT_PASSPHRASE`). Agent sieht nur „Credentials konfiguriert: ✅/❌". Start mit 3-5 Anbietern (Hetzner, Anthropic, Telekom, AWS, GitHub).

**billing_match-Tool** (§7.2): Lädt Buchungen der Periode mit `status=expected`. Pro Buchung: Provider-Datei lesen (portal_url, download_method) → Playwright → PDF nach `/invoices/<provider>/<period>.pdf` (atomar: write-temp-then-rename) → Status `downloaded` oder bei 3× Fehlschlag `missing` → PDF-Betrag extrahieren → Vergleich (±0.01) → `matched`/`missing` → Connection Buchung → Provider. Nebenläufigkeit v1: dokumentierte Regel (Cron = einziger geplanter Writer), kein Lock.

**billing_status-Tool** (§7.3): Status einer Buchung manuell ändern (`expected|downloaded|matched|missing|archived`), optional `invoice_nr`/`invoice_path` — für manuell hochgeladene Rechnungen.

## Expected Outcome
- `InvoiceDownloader`-Skripte für 3-5 Anbieter; Credentials nur via fio-vault, nie im Agent-Kontext.
- `billing_match` lädt + matched automatisch; Status-Transitions korrekt (downloaded persistiert, retry_count kumulativ → missing nach 3×).
- PDF-Betrag-Extraktion lokal; Match per Betrag-Vergleich (±0.01).
- `billing_status` erlaubt manuelle Korrektur.
- Connection Buchung → Provider gesetzt.
- Atomarer PDF-Write verhindert torn files.

## Agent Context
Baut auf den importierten `expected`-Buchungen (Task 002) auf. Liefert den Download- und Abgleich-Kern inkl. fio-vault-Credentials und Status-Maschine. Die Übersicht (Task 004) konsumiert die hier gesetzten Status.
