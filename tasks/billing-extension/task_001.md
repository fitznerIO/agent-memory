# Task 001: Phase 1 — Extension-Registrierung + Schema + Sanitizer

## Dependencies
- Requires: extension-system/007 (validiertes Extension System)

## Description
(aus Billing-PRD §3, §4)

**Extension-Definition** (`src/extensions/billing/index.ts`):

```typescript
export const billingExtension: Extension = {
  name: "billing",
  version: "1.0.0",
  description: "Automatischer Rechnungsabgleich",
  knowledgeTypes: [
    { type: "transaction", dir: "episodic/transactions", v1Type: "episodic", idPrefix: "txn" },
    { type: "provider",    dir: "semantic/providers",    v1Type: "semantic", idPrefix: "prov" },
  ],
  schema: {
    table: "billing_meta",
    columns: [
      { name: "provider", type: "TEXT" }, { name: "amount", type: "REAL" },
      { name: "currency", type: "TEXT", default: "'EUR'" }, { name: "booking_date", type: "TEXT" },
      { name: "period", type: "TEXT" }, { name: "invoice_nr", type: "TEXT" },
      { name: "invoice_path", type: "TEXT" }, { name: "status", type: "TEXT", default: "'expected'" },
      { name: "source_ref", type: "TEXT" },
      { name: "retry_count", type: "INTEGER", default: "0" }, { name: "last_attempt_at", type: "TEXT" },
    ],
  },
  tools: [ billingImport, billingMatch, billingStatus, billingOverview ],
  async onInstall(ctx) {
    ctx.db.run(`CREATE INDEX idx_bill_provider ON billing_meta(provider)`);
    ctx.db.run(`CREATE INDEX idx_bill_period ON billing_meta(period)`);
    ctx.db.run(`CREATE INDEX idx_bill_status ON billing_meta(status)`);
  },
  async onUninstall(ctx) { await cleanFrontmatterNamespace(ctx.memoryPath, "billing"); },
};
```

**Sanitizer** (`src/extensions/billing/sanitizer.ts`) — entfernt sensible Daten VOR dem ersten LLM-Call, deterministisch, reine Funktion. Reihenfolge relevant (IBAN/Karte vor BIC). Pattern: IBAN (ISO-Land + flexible Spacing), Kreditkarte, maskierte Karte (`\*{2,}`), BIC (NUR mit `BIC`-Anker — sonst werden Großwörter wie `RECHNUNG` fälschlich redacted), Kontonummer, BLZ, Mandatsref, Gläubiger-ID, SEPA-Ref. Was NICHT entfernt wird: Anbietername, Betrag, Buchungsdatum, Rechnungsnummer, bereinigter Verwendungszweck.

```typescript
const ISO_COUNTRY = 'AD|AE|AL|AT|BE|BG|CH|CY|CZ|DE|DK|EE|ES|FI|FR|GB|GR|HR|HU|IE|IL|IS|IT|LI|LT|LU|LV|MC|MT|NL|NO|PL|PT|RO|SE|SI|SK';
function sanitize(rawText: string): string {
  return rawText
    .replace(new RegExp(`\\b(?:${ISO_COUNTRY})\\d{2}(?:[\\s]?[A-Z0-9]){11,30}`, 'gi'), '[IBAN]')
    .replace(/\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, '[KARTE]')
    .replace(/\b\d{4}[\s\-]?\*{2,}[\s\-]?\*{0,}[\s\-]?\d{4}\b/g, '[KARTE]')
    .replace(new RegExp(`\\bBIC[:\\s]+[A-Z]{4}(?:${ISO_COUNTRY})[A-Z0-9]{2}(?:[A-Z0-9]{3})?\\b`, 'g'), '[BIC]')
    .replace(/\bKto\.?\s*\d{6,12}\b/gi, '[KONTO]')
    .replace(/\bBLZ\.?\s*\d{8}\b/gi, '[BLZ]')
    .replace(/Mandatsref\.?\s*[\w\-]{10,}/gi, '[MANDAT]')
    .replace(/Gl(?:ä|ae)ubiger[\s\-]?ID\.?\s*[\w\-]{10,}/gi, '[GLÄUBIGER]')
    .replace(/(?:End-to-End-Ref|EREF)\s*[\w\-\+]{15,}/gi, '[SEPA-REF]');
}
```

## Expected Outcome
- `billingExtension` registriert via `AVAILABLE_EXTENSIONS`; `agent-memory extensions install billing` erstellt `billing_meta` (mit `retry_count`/`last_attempt_at`) + Indizes, registriert `transaction`/`provider` Typen.
- `sanitize()` entfernt alle in §4.2 gelisteten Pattern; Tests mit realen (anonymisierten) Auszügen beweisen: kein sensibler Wert passiert (inkl. BIC-Anker-Verhalten, IBAN-Spacing-Varianten).
- Tool-Stubs (`billingImport` etc.) existieren, werfen „Not implemented" bis zur jeweiligen Task.

## Agent Context
Erste Billing-Aufgabe; baut auf dem validierten Extension System (Task 007 dort) auf. Liefert die Extension-Registrierung und den sicherheitskritischen Sanitizer als eigenständig getestete reine Funktion — die Grundlage, auf der der Import (Task 002) aufsetzt.
