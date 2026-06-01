# Billing Extension – Agent-Memory Extension

**Automatischer Rechnungsabgleich als v2-lite Extension**

| | |
|---|---|
| **Version** | 1.0 |
| **Datum** | 08. Februar 2026 |
| **Autor** | fitznerIO – AI Services |
| **Status** | Draft |
| **Basis** | Agent Knowledge Memory v2-lite PRD |
| **Typ** | agent-memory Extension |

---

## 1. Problem

Jeden Monat das gleiche Spiel: Buchungen auf dem Konto, Rechnungen in 10 verschiedenen Anbieter-Portalen. Manuell prüfen ob alles da ist, PDFs runterladen, ablegen. Bei 15-20 Anbietern kostet das 1-2 Stunden pro Monat – langweilig, fehleranfällig, wird gerne aufgeschoben.

### 1.1 Was der Agent tun soll

1. Kontoauszug entgegennehmen (CSV-Export)
2. Buchungen erkennen und Anbietern zuordnen
3. Rechnungen aus Anbieter-Portalen herunterladen (Playwright)
4. Abgleichen: Buchung ↔ Rechnung
5. Fehlende Rechnungen melden
6. Über Monate und Jahre den Überblick behalten

### 1.2 Was der Agent NICHT tun soll

- Überweisungen tätigen
- Kontodaten speichern (IBAN, Kartennummern, Kontonummern)
- Finanzanalysen oder Steuerberatung
- Zugriff auf das Bankkonto selbst

---

## 2. Einordnung

### 2.1 Was v2-lite liefert

| Feature | v2-lite Tool | Billing nutzt es für |
|---|---|---|
| Buchungen speichern | `memory_store` | Jede Buchung als Einzeldatei |
| Verbindungen | `memory_connect` | Buchung ↔ Rechnung verlinken |
| Suche | `memory_search` | "Welche Hetzner-Buchungen ohne Rechnung?" |
| Tags | Namespace-Tags | `billing/provider/hetzner`, `billing/status/matched` |
| Git | v1 | History aller Buchungen über Jahre |

### 2.2 Was die Billing Extension ergänzt

| Feature | Warum |
|---|---|
| Sanitizer | Sensible Daten (Kartennr., IBAN) aus Buchungsdaten entfernen |
| Anbieter-Erkennung | Verwendungszweck → bekannter Anbieter |
| Status-Tracking | expected → downloaded → matched → missing |
| Perioden-Tracking | Monatsweise Übersicht über Jahre |
| Rechnungs-Download | Playwright-Skripte pro Anbieter |

---

## 3. Extension Definition

### 3.1 Schema

```typescript
export const billingExtension: Extension = {
  name: "billing",
  version: "1.0.0",                          // Pflichtfeld (Extension-Interface §4.1)
  description: "Automatischer Rechnungsabgleich",  // Pflichtfeld

  // Eigene knowledge.type-Werte registrieren (Core-Voraussetzung C1, Ext-PRD §8.4).
  // Ohne diese Deklaration bricht memoryStore(type="transaction") zur Laufzeit.
  knowledgeTypes: [
    { type: "transaction", dir: "episodic/transactions", v1Type: "episodic", idPrefix: "txn" },
    { type: "provider",    dir: "semantic/providers",    v1Type: "semantic", idPrefix: "prov" },
  ],

  schema: {
    table: "billing_meta",
    columns: [
      { name: "provider",     type: "TEXT" },
      { name: "amount",       type: "REAL" },
      { name: "currency",     type: "TEXT",    default: "'EUR'" },
      { name: "booking_date", type: "TEXT" },
      { name: "period",       type: "TEXT" },       // "2026-02"
      { name: "invoice_nr",   type: "TEXT" },
      { name: "invoice_path", type: "TEXT" },       // Pfad zur PDF
      { name: "status",       type: "TEXT",    default: "'expected'" },
      { name: "source_ref",   type: "TEXT" },       // Bereinigte Buchungsreferenz
      { name: "retry_count",  type: "INTEGER", default: "0" },  // Download-Versuche (über Runs kumulativ)
      { name: "last_attempt_at", type: "TEXT" },    // Zeitpunkt letzter Download-Versuch
    ],
  },

  tools: [
    billingImport,
    billingMatch,
    billingStatus,
    billingOverview,
  ],

  // Hooks erhalten ctx (Extension-Interface §4.1); ctx.db ist synchron (kein await).
  async onInstall(ctx) {
    ctx.db.run(`CREATE INDEX idx_bill_provider ON billing_meta(provider)`);
    ctx.db.run(`CREATE INDEX idx_bill_period ON billing_meta(period)`);
    ctx.db.run(`CREATE INDEX idx_bill_status ON billing_meta(status)`);
  },

  async onUninstall(ctx) {
    await cleanFrontmatterNamespace(ctx.memoryPath, "billing");
  },
};
```

### 3.2 SQLite-Tabelle

```sql
CREATE TABLE billing_meta (
  entry_id      TEXT PRIMARY KEY,
  provider      TEXT,                -- "Hetzner", "Anthropic", "Telekom"
  amount        REAL,                -- 5.29
  currency      TEXT DEFAULT 'EUR',
  booking_date  TEXT,                -- "2026-02-01"
  period        TEXT,                -- "2026-02"
  invoice_nr    TEXT,                -- "RE-2026-042"
  invoice_path  TEXT,                -- "/invoices/hetzner/2026-02.pdf"
  status          TEXT DEFAULT 'expected',
  source_ref      TEXT,              -- Bereinigte Buchungsreferenz
  retry_count     INTEGER DEFAULT 0, -- Download-Versuche, über billing_match-Runs KUMULATIV
  last_attempt_at TEXT,              -- ISO-Zeitstempel des letzten Versuchs
  FOREIGN KEY (entry_id) REFERENCES knowledge(id)
);
```

### 3.3 Frontmatter-Format

```yaml
---
id: txn-042
title: "Hetzner Cloud Server CX22"
type: transaction
tags:
  - billing/provider/hetzner
  - billing/period/2026-02
  - billing/category/hosting
  - billing/status/matched
created: 2026-02-08
updated: 2026-02-08
connections:
  - target: txn-017
    type: related
    note: "Gleicher Anbieter, gleicher Service, Vormonat"
ext.billing:
  provider: Hetzner
  amount: 5.29
  currency: EUR
  booking_date: 2026-02-01
  period: 2026-02
  invoice_nr: RE-2026-042
  invoice_path: /invoices/hetzner/2026-02.pdf
  status: matched
  source_ref: "Hetzner Cloud RE-2026-042"
---

## Buchung
Monatliche Abbuchung Hetzner Cloud Server CX22.

## Rechnung
PDF heruntergeladen am 2026-02-08.
Betrag auf Rechnung stimmt mit Buchung überein.
```

---

## 4. Sanitizer – Datenschutz ohne Infrastruktur

### 4.1 Das Prinzip

Der Kontoauszug wird lokal geparsed. Bevor der Agent irgendetwas sieht, entfernt ein Sanitizer alle sensiblen Daten aus den Buchungstexten. Kein Hash, kein Vault, kein Crypto – einfach Pattern erkennen und durch generische Platzhalter ersetzen.

### 4.2 Was entfernt wird

| Pattern | Beispiel | Ersetzt durch |
|---|---|---|
| Kreditkartennummern | 4532-1234-5678-9012 | `[KARTE]` |
| Maskierte Karten | 4532-****-****-9012 | `[KARTE]` |
| IBANs | DE89 3704 0044 0532 0130 00 | `[IBAN]` |
| Kontonummern | Kto. 0532013000 | `[KONTO]` |
| BLZ | BLZ 37040044 | `[BLZ]` |
| Mandatsreferenzen | Mandatsref M-2024-HTZ-4711 | `[MANDAT]` |
| Gläubiger-IDs | Gläubiger-ID DE98ZZZ09999999999 | `[GLÄUBIGER]` |
| BIC/SWIFT (nur mit `BIC`-Anker) | BIC COBADEFFXXX | `[BIC]` |
| SEPA-Referenz | EREF ABC123… / End-to-End-Ref … | `[SEPA-REF]` |

### 4.3 Was NICHT entfernt wird

| Feld | Warum nicht | Beispiel |
|---|---|---|
| Anbietername | Braucht der Agent zum Zuordnen | "Hetzner", "Anthropic" |
| Betrag | Braucht der Agent zum Rechnungs-Match | €5.29 |
| Buchungsdatum | Braucht der Agent für Perioden-Zuordnung | 2026-02-01 |
| Rechnungsnummer | Braucht der Agent zum Matching | RE-2026-042 |
| Verwendungszweck (bereinigt) | Kontext für Zuordnung | "Hetzner Cloud Server" |

### 4.4 Implementation

```typescript
// Hinweis: Reihenfolge ist relevant — IBAN/Karte VOR BIC, damit Ziffernblöcke
// nicht teil-ersetzt werden. Sanitizer ist konservativ: lieber ein Token mehr
// redacten als einen sensiblen Wert durchlassen. Vollständige Pattern-Liste +
// reale Test-Auszüge sind Pflicht (Risiko §16, "Sanitizer übersieht Pattern").
const ISO_COUNTRY = 'AD|AE|AL|AT|BE|BG|CH|CY|CZ|DE|DK|EE|ES|FI|FR|GB|GR|HR|HU|IE|IL|IS|IT|LI|LT|LU|LV|MC|MT|NL|NO|PL|PT|RO|SE|SI|SK';

function sanitize(rawText: string): string {
  return rawText
    // IBANs ZUERST: Ländercode + 2 Prüfziffern + 11–30 alphanum. Zeichen mit
    // beliebigen Whitespace-Gruppen dazwischen (nicht auf 4er-Blöcke fixiert →
    // fängt auch ungewöhnliche/fehlende Gruppierung, NBSP, Tabs). \b vorne, am
    // Ende lookahead statt \b (Bindestrich-Glue).
    .replace(new RegExp(`\\b(?:${ISO_COUNTRY})\\d{2}(?:[\\s]?[A-Z0-9]){11,30}`, 'gi'), '[IBAN]')
    // Kreditkartennummern (16 Ziffern, ggf. mit Trennzeichen)
    .replace(/\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, '[KARTE]')
    // Maskierte Karten (2+ Sterne pro Gruppe, nicht nur 2–4)
    .replace(/\b\d{4}[\s\-]?\*{2,}[\s\-]?\*{0,}[\s\-]?\d{4}\b/g, '[KARTE]')
    // BIC/SWIFT — NUR mit Kontext-Anker ("BIC ..."), sonst werden gewöhnliche
    // 8-/11-Buchstaben-Großwörter wie "RECHNUNG" fälschlich als [BIC] redacted
    // (das würde den Verwendungszweck zerstören, den der Agent braucht).
    // Struktur: 4 Bank + 2 ISO-Land + 2 Location (+ optional 3 Branch).
    .replace(new RegExp(`\\bBIC[:\\s]+[A-Z]{4}(?:${ISO_COUNTRY})[A-Z0-9]{2}(?:[A-Z0-9]{3})?\\b`, 'g'), '[BIC]')
    // Kontonummern
    .replace(/\bKto\.?\s*\d{6,12}\b/gi, '[KONTO]')
    // BLZ
    .replace(/\bBLZ\.?\s*\d{8}\b/gi, '[BLZ]')
    // Mandatsreferenzen
    .replace(/Mandatsref\.?\s*[\w\-]{10,}/gi, '[MANDAT]')
    // Gläubiger-ID
    .replace(/Gl(?:ä|ae)ubiger[\s\-]?ID\.?\s*[\w\-]{10,}/gi, '[GLÄUBIGER]')
    // SEPA-Referenzen (lange alphanumerische Strings)
    .replace(/(?:End-to-End-Ref|EREF)\s*[\w\-\+]{15,}/gi, '[SEPA-REF]');
}
```

### 4.5 Datenfluss

```
Kontoauszug (CSV)
  │
  ▼ parseCSV() – lokal, kein LLM
  │
  │ Spalten-Filter:
  │   ✅ Buchungsdatum
  │   ✅ Betrag
  │   ✅ Verwendungszweck
  │   ❌ Eigene IBAN        → wird nicht gelesen
  │   ❌ Kontostand/Saldo   → wird nicht gelesen
  │   ❌ Empfänger-IBAN     → wird nicht gelesen
  │   ❌ Auftraggeber-Konto → wird nicht gelesen
  │
  ▼ sanitize() – pro Verwendungszweck
  │
  │   "VISA 4532-1234-5678-9012 Hetzner Cloud RE-2026-042
  │    IBAN DE89370400440532013000 Mandatsref M-2024-HTZ-4711"
  │
  │   → "VISA [KARTE] Hetzner Cloud RE-2026-042
  │      [IBAN] [MANDAT]"
  │
  ▼ extractProvider() – Anbieter erkennen
  │
  │   "Hetzner Cloud RE-2026-042" → provider: "Hetzner"
  │
  ▼ Bereinigte Buchung → an Agent
  │
  │   { date: "2026-02-01",
  │     provider: "Hetzner",
  │     amount: 5.29,
  │     reference: "Hetzner Cloud RE-2026-042",
  │     period: "2026-02" }
```

**Kein sensibler Wert erreicht jemals den Agent oder die API.** Die Filterung passiert vor dem ersten LLM-Call, deterministisch, in einer reinen Funktion.

---

## 5. Anbieter-Erkennung

### 5.1 Bekannte Anbieter

Eine einfache Mapping-Tabelle die wächst:

```typescript
const KNOWN_PROVIDERS: ProviderRule[] = [
  { pattern: /hetzner/i,           name: "Hetzner",      category: "hosting" },
  { pattern: /anthropic/i,         name: "Anthropic",     category: "ai" },
  { pattern: /openai/i,            name: "OpenAI",        category: "ai" },
  { pattern: /telekom|t-mobile/i,  name: "Telekom",       category: "telekommunikation" },
  { pattern: /vodafone/i,          name: "Vodafone",      category: "telekommunikation" },
  { pattern: /aws|amazon web/i,    name: "AWS",           category: "hosting" },
  { pattern: /github/i,            name: "GitHub",        category: "software" },
  { pattern: /google cloud/i,      name: "Google Cloud",  category: "hosting" },
  { pattern: /spotify/i,           name: "Spotify",       category: "abo" },
  { pattern: /netflix/i,           name: "Netflix",       category: "abo" },
  // ... wächst über Zeit
];

function extractProvider(reference: string): { name: string, category: string } | null {
  for (const rule of KNOWN_PROVIDERS) {
    if (rule.pattern.test(reference)) {
      return { name: rule.name, category: rule.category };
    }
  }
  return null;  // Unbekannter Anbieter → Agent soll klassifizieren
}
```

### 5.2 Unbekannte Anbieter

Wenn der Parser den Anbieter nicht erkennt, wird die bereinigte Buchung trotzdem gespeichert. Der Agent bekommt die Aufgabe: "Buchung vom 2026-02-05, €29.99, Verwendungszweck: '[bereinigter Text]'. Welcher Anbieter?"

Der Agent klassifiziert einmalig, danach wird der neue Anbieter in die Mapping-Tabelle aufgenommen (automatisch via `memory_store`).

### 5.3 Anbieter als Knowledge-Einträge

Jeder bekannte Anbieter bekommt eine eigene Datei in agent-memory:

```yaml
---
id: prov-001
title: "Hetzner"
type: provider
tags:
  - billing/provider/hetzner
  - billing/category/hosting
connections:
  - target: txn-042
    type: contains
  - target: txn-017
    type: contains
ext.billing:
  expected_amount: 5.29
  billing_cycle: monthly
  expected_day: 1
  portal_url: "https://accounts.hetzner.com"
  download_method: playwright
  last_downloaded: 2026-02-08
---

## Anbieter
Hetzner Online GmbH – Cloud Hosting.
Monatliche Abbuchung für CX22 Server.
```

Das ermöglicht:
- "Welche Anbieter buchen monatlich ab?" → `memory_search(type="provider")`
- "Wann wurde zuletzt die Hetzner-Rechnung geladen?" → `last_downloaded`
- "Stimmt der Betrag mit dem erwarteten überein?" → Lokaler Vergleich `amount == expected_amount`

---

## 6. Status-Lifecycle

### 6.1 Status-Werte

```
expected → downloaded → matched → archived
   │            │
   │            ↘ missing (Betrag passt nicht / Rechnung unbrauchbar)
   ↘ missing (3x Download fehlgeschlagen)
```

`missing` ist aus **zwei** Zuständen erreichbar: aus `expected` (Download scheitert 3×) und aus `downloaded` (PDF geladen, aber Abgleich schlägt fehl). `billing_match` persistiert `downloaded` als Zwischenschritt (siehe §7.2 Schritt e), bevor der Abgleich `matched`/`missing` setzt — der Status ist also nicht überspringbar.

| Status | Bedeutung | Wann gesetzt |
|---|---|---|
| `expected` | Buchung importiert, Rechnung noch nicht geprüft | Nach Import |
| `downloaded` | Rechnung heruntergeladen, noch nicht abgeglichen | Nach Download |
| `matched` | Buchung und Rechnung stimmen überein | Nach Abgleich |
| `missing` | Rechnung nicht auffindbar nach mehreren Versuchen | Nach 3 fehlgeschlagenen Downloads |
| `archived` | Abgeschlossen, für's Archiv | Am Periodenende oder manuell |

### 6.2 Automatische Transitions

| Transition | Trigger | Bedingung |
|---|---|---|
| expected → downloaded | Playwright lädt PDF | PDF existiert und ist > 0 Bytes |
| downloaded → matched | Lokaler Vergleich | Betrag auf Rechnung ≈ Buchungsbetrag (±0.01) |
| expected → missing | 3x Download fehlgeschlagen | `retry_count ≥ 3` (über Runs kumulativ, persistiert in `billing_meta.retry_count`) |
| matched → archived | Monatsabschluss | Alle Buchungen der Periode matched |

---

## 7. Extension Tools

### 7.1 billing_import

Importiert einen Kontoauszug. Parsed, sanitized, erstellt Buchungs-Einträge.

```typescript
billing_import(
  csv_path: string,           // Pfad zur CSV-Datei
  format?: "sparkasse" | "dkb" | "ing" | "commerzbank" | "generic",
) → {
  imported: number,           // Anzahl importierter Buchungen
  providers_known: number,    // Davon mit bekanntem Anbieter
  providers_unknown: number,  // Davon unbekannt → Agent soll klassifizieren
  duplicates_skipped: number, // Bereits importierte Buchungen
  period: string,             // Erkannte Periode "2026-02"
  unknown_bookings: Array<{   // Unbekannte zur Klassifizierung
    id: string,
    date: string,
    amount: number,
    reference: string,        // Bereits bereinigt!
  }>,
}
```

**Was intern passiert:**

```
1. CSV lesen (lokal)
2. Format erkennen (Spaltenreihenfolge je Bank)
3. Pro Zeile:
   a. Spalten-Filter: Nur Datum, Betrag, Verwendungszweck
   b. sanitize(verwendungszweck)
   c. extractProvider(verwendungszweck)
   d. Duplikat-Check (Datum + Betrag + Provider + CSV-Zeilenindex der Periode).
      Der Zeilenindex als Tiebreaker verhindert, dass zwei legitime identische
      Buchungen (gleicher Tag/Betrag/Anbieter, z.B. 2× €5 API-Top-up) fälschlich
      als Duplikat verworfen werden. Beim Re-Import derselben CSV greift der Check
      trotzdem (gleiche Zeilen). Übersprungene werden gemeldet (`duplicates_skipped`).
   e. memory_store(type="transaction") + billing_meta INSERT
4. Unbekannte Anbieter als Liste zurückgeben
```

### 7.2 billing_match

Startet den Rechnungs-Download und Abgleich für eine Periode.

```typescript
billing_match(
  period: string,             // "2026-02"
  providers?: string[],       // Optional: nur bestimmte Anbieter
) → {
  matched: number,
  downloaded: number,
  failed: number,
  missing: Array<{
    id: string,
    provider: string,
    amount: number,
    reason: string,           // "Portal nicht erreichbar" / "Rechnung nicht gefunden"
  }>,
}
```

**Nebenläufigkeit (v1: dokumentierte Regel, kein Lock-Mechanismus).** Single-User-System: derselbe Mensch triggert Cron und manuellen Lauf. Regel für v1: **der Cron ist der einzige geplante Writer; nicht parallel manuell `billing match` starten.** Als billige Absicherung gegen torn PDFs schreibt der Download write-temp-then-rename (`<period>.pdf.tmp` → atomar umbenennen). Ein echter Single-Flight-Lock pro `(period, provider)` ist erst nötig, wenn mehrere Trigger-Quellen gleichzeitig laufen (Multi-User/Multi-Device) — siehe §16 als spätere Option.

**Was intern passiert:**

```
1. Alle Buchungen der Periode mit status=expected laden
2. Pro Buchung:
   a. Provider-Datei lesen → portal_url, download_method
   b. Playwright-Skript für diesen Anbieter starten
   c. PDF herunterladen → /invoices/<provider>/<period>.pdf
      → Erfolg: Status = downloaded (persistiert, Zwischenschritt)
      → Fehlschlag: retry_count += 1, last_attempt_at = now (persistiert)
      → retry_count ≥ 3 (kumulativ über Runs): Status = missing, weiter zur nächsten Buchung
   d. PDF-Betrag extrahieren (lokal, kein LLM)
   e. Vergleich: PDF-Betrag ≈ Buchungsbetrag (±0.01)?
   f. Status updaten: matched (Betrag passt) oder missing (Betrag passt nicht)
   g. Connection: Buchung → Provider (builds_on)
```

### 7.3 billing_status

Status einer Buchung manuell ändern.

```typescript
billing_status(
  id: string,
  status: "expected" | "downloaded" | "matched" | "missing" | "archived",
  invoice_nr?: string,
  invoice_path?: string,
) → { success: boolean }
```

Für Fälle wo der automatische Download nicht klappt und der User die Rechnung manuell hochlädt.

### 7.4 billing_overview

Übersicht für eine oder mehrere Perioden.

```typescript
billing_overview(
  period?: string,            // "2026-02" oder "2026" für ganzes Jahr
  provider?: string,          // Optional: nur ein Anbieter
  status?: string,            // Optional: nur ein Status
) → {
  period: string,
  total_bookings: number,
  by_status: {
    matched: number,
    expected: number,
    downloaded: number,
    missing: number,
    archived: number,
  },
  by_provider: Array<{
    provider: string,
    count: number,
    total_amount: number,
    all_matched: boolean,
  }>,
  action_needed: Array<{     // Buchungen die Aufmerksamkeit brauchen
    id: string,
    provider: string,
    amount: number,
    status: string,
    days_pending: number,
  }>,
}
```

**Interne Queries:**

```sql
-- Übersicht nach Status
-- ACHTUNG: GROUP BY liefert nur Zeilen für Status, die VORKOMMEN. Status mit
-- 0 Einträgen fehlen → das by_status-Objekt muss im Mapping-Layer auf alle fünf
-- Schlüssel (matched/expected/downloaded/missing/archived) zero-gefüllt werden,
-- sonst liefert by_status.archived `undefined` statt 0 (Vertragsbruch §7.4-Return).
SELECT status, COUNT(*) as count
FROM billing_meta
WHERE period = ?
GROUP BY status

-- Übersicht nach Anbieter
SELECT provider, COUNT(*) as count, SUM(amount) as total,
  MIN(CASE WHEN status != 'matched' AND status != 'archived' THEN 1 ELSE 0 END) = 0 as all_matched
FROM billing_meta
WHERE period = ?
GROUP BY provider
ORDER BY total DESC

-- Action needed: Nicht-abgeschlossene Buchungen
SELECT b.*, k.updated_at,
  julianday('now') - julianday(k.created_at) as days_pending
FROM billing_meta b
JOIN knowledge k ON b.entry_id = k.id
WHERE b.period = ?
AND b.status IN ('expected', 'missing')
ORDER BY days_pending DESC
```

### 7.5 Tool-Übersicht

| Tool | Zweck | LLM-Kosten | Aufgerufen von |
|---|---|---|---|
| `billing_import` | Kontoauszug importieren | $0.00 (nur Parser) | User/Telegram |
| `billing_match` | Rechnungen laden + abgleichen | $0.00 (Playwright + lokaler Vergleich) | Cron oder manuell |
| `billing_status` | Status manuell ändern | $0.00 | User/Telegram |
| `billing_overview` | Monats-/Jahresübersicht | $0.00 (nur SQL) | User/Telegram |

**Auffällig:** Die Tools **selbst** rufen kein LLM — Import, Match, Status und Overview sind reine Parser-/Playwright-/SQL-Operationen. LLM-Kosten entstehen nur **außerhalb** der Tools, wenn ein unbekannter Anbieter vom Agent (Haiku) klassifiziert wird (§5.2). Das ist im Normalbetrieb regelmäßig der Fall (Telegram-Beispiel §10.2: 3 von 18 Buchungen unbekannt), aber pro neuem Anbieter nur einmalig.

---

## 8. Rechnungs-Download

### 8.1 Architektur

Jeder Anbieter hat ein eigenes Playwright-Skript. Die Skripte sind einfache Funktionen die sich einloggen, zur Rechnungsseite navigieren und die PDF herunterladen.

```typescript
interface InvoiceDownloader {
  login(page: Page, credentials: Credentials): Promise<void>;
  downloadInvoice(page: Page, period: string): Promise<string>;  // → PDF-Pfad
  extractAmount(pdfPath: string): Promise<number>;               // → Betrag aus PDF
}
```

### 8.2 Credentials

Login-Daten für Anbieter-Portale werden NIEMALS im agent-memory gespeichert. Sie liegen in einer separaten, verschlüsselten Datei die nur die Playwright-Skripte lesen. **Decryption-Pfad:** via `fio-vault` (GPG-basiertes Secret-Management für Bun, bereits im Stack) — `loadSecrets()` liest die Credentials zur Laufzeit, Passphrase über `FIO_VAULT_PASSPHRASE`. Kein eigenes Crypto in der Billing-Extension.

```yaml
# ~/.billing-credentials.yaml (verschlüsselt, chmod 600)
providers:
  hetzner:
    url: https://accounts.hetzner.com
    email: sascha@fitzner.io
    password: <encrypted>
  anthropic:
    url: https://console.anthropic.com
    email: sascha@fitzner.io
    password: <encrypted>
```

Der Agent weiß nur: "Credentials für Hetzner sind konfiguriert: ✅/❌". Er sieht nie Passwörter oder Login-Daten.

### 8.3 Beispiel: Hetzner Downloader

```typescript
const hetznerDownloader: InvoiceDownloader = {
  async login(page, credentials) {
    await page.goto('https://accounts.hetzner.com/login');
    await page.fill('#_username', credentials.email);
    await page.fill('#_password', credentials.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/account/**');
  },

  async downloadInvoice(page, period) {
    await page.goto('https://accounts.hetzner.com/invoices');
    // Rechnung für Periode finden und downloaden
    const row = page.locator(`text=${period}`).first();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      row.locator('a[href*="pdf"]').click(),
    ]);
    const path = `/invoices/hetzner/${period}.pdf`;
    await download.saveAs(path);
    return path;
  },

  async extractAmount(pdfPath) {
    // PDF-Text extrahieren, Betrag finden (lokal, kein LLM)
    const text = await extractPDFText(pdfPath);
    const match = text.match(/Gesamtbetrag:?\s*([\d.,]+)\s*€/i);
    return match ? parseFloat(match[1].replace(',', '.')) : 0;
  },
};
```

### 8.4 Neue Anbieter hinzufügen

Wenn ein neuer Anbieter auftaucht, erstellt der Agent ein Skeleton-Skript:

```
Agent: "Neuer Anbieter 'DigitalOcean' erkannt. 
        Kein Download-Skript vorhanden.
        Soll ich ein Basis-Skript erstellen?"

User:  "Ja"

Agent: → Erstellt downloaders/digitalocean.ts mit Login + Download Skeleton
       → User muss Portal-URL und CSS-Selektoren ergänzen
       → Oder: Agent versucht es per Generic-Downloader (Login → Rechnungsseite → PDF)
```

---

## 9. Datei-Ablage

### 9.1 Rechnungen

```
/invoices/
├── hetzner/
│   ├── 2026-01.pdf
│   ├── 2026-02.pdf
│   └── ...
├── anthropic/
│   ├── 2026-01.pdf
│   └── ...
├── telekom/
│   └── ...
└── _unsorted/              # Manuell hochgeladene Rechnungen
    └── rechnung-unbekannt.pdf
```

### 9.2 In agent-memory

```
~/.agent-memory/
├── semantic/
│   └── providers/          # Anbieter-Stammdaten
│       ├── prov-001-hetzner.md
│       ├── prov-002-anthropic.md
│       └── prov-003-telekom.md
├── episodic/
│   └── transactions/       # Buchungen als Einzeldateien
│       ├── txn-042-hetzner.md
│       ├── txn-043-anthropic.md
│       └── txn-044-telekom.md
└── ...
```

---

## 10. Telegram Interface

### 10.1 Commands

| Command | Funktion |
|---|---|
| CSV als Datei senden | `billing_import` – automatisch erkannt |
| `/billing` | Übersicht aktueller Monat |
| `/billing 2026-02` | Übersicht für Periode |
| `/billing match` | Rechnungs-Download starten |
| `/billing missing` | Nur fehlende Rechnungen zeigen |
| `/billing year` | Jahresübersicht |

### 10.2 Beispiel-Interaktion

```
User: [sendet sparkasse-2026-02.csv]

Bot:  ✅ Import abgeschlossen:
      18 Buchungen für Februar 2026
      15 bekannte Anbieter
      3 unbekannte Buchungen:

      1. 05.02. – €29.99 – "AMZN Digital*123ABC"
      2. 12.02. – €4.99 – "SPOTIFY AB"
      3. 18.02. – €149.00 – "PAYPAL *DESIGNTOOL"

      [Amazon] [Spotify] [Andere eingeben]

User: [klickt Spotify bei Nr. 2]

Bot:  ✅ Als Spotify gespeichert.
      Noch 2 unbekannte. Was ist "PAYPAL *DESIGNTOOL"?

User: Figma

Bot:  ✅ Als Figma gespeichert.
      Was ist "AMZN Digital*123ABC"?

User: Das ist AWS

Bot:  ✅ Als AWS gespeichert.
      Alle 18 Buchungen klassifiziert.

      Soll ich jetzt die Rechnungen runterladen?
      [Ja, alle] [Nur fehlende] [Später]
```

### 10.3 Monatlicher Digest

Optional als Cron-Job am Monatsende:

```
📊 Billing Report – Februar 2026

✅ 15 von 18 Rechnungen abgeglichen
⬇️  2 heruntergeladen, noch nicht geprüft
❌  1 Rechnung fehlt:
    Figma (€149.00) – Portal nicht erreichbar

Aktion nötig:
[Figma manuell hochladen] [Retry Download] [Ignorieren]
```

---

## 11. Wiederkehrende Buchungen

### 11.1 Auto-Detection

Nach 3 Monaten mit gleicher Buchung (Anbieter + ähnlicher Betrag ± 10%) erkennt das System automatisch eine wiederkehrende Buchung:

```sql
SELECT provider, AVG(amount) as avg_amount,
  COUNT(DISTINCT period) as months_seen
FROM billing_meta
WHERE provider = ?
GROUP BY provider
HAVING months_seen >= 3
```

### 11.2 Erwartungs-Check

Wenn ein bekannter monatlicher Anbieter in einem neuen Kontoauszug NICHT auftaucht:

```
⚠️ Erwartet aber nicht gefunden:
    Hetzner (monatlich ~€5.29) – fehlt im Februar-Auszug.
    Möglich: Noch nicht abgebucht / Kündigung / Anderes Konto?
```

---

## 12. Jahresübersicht und Langzeit-Tracking

### 12.1 Warum Langzeit

Rechnungen müssen in Deutschland 10 Jahre aufbewahrt werden. Das System ist so designed dass Buchungen und Rechnungen über Jahre bestehen bleiben.

### 12.2 Perioden-Navigation

```sql
-- Alle verfügbaren Perioden
SELECT DISTINCT period, COUNT(*) as bookings,
  SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) as matched,
  SUM(CASE WHEN status = 'missing' THEN 1 ELSE 0 END) as missing
FROM billing_meta
GROUP BY period
ORDER BY period DESC

-- Jahresübersicht: Ausgaben pro Anbieter
SELECT provider, SUM(amount) as total_year,
  COUNT(*) as booking_count
FROM billing_meta
WHERE period LIKE '2026-%'
GROUP BY provider
ORDER BY total_year DESC
```

### 12.3 Connections über Zeit

Buchungen desselben Anbieters werden automatisch verlinkt:

```yaml
# txn-042-hetzner.md
connections:
  - target: txn-017
    type: related
    note: "Gleicher Anbieter, Vormonat"
  - target: prov-001
    type: part_of
```

Über `memory_traverse` kann der Agent die komplette Buchungshistorie eines Anbieters aufrufen.

---

## 13. Bank-Format-Parser

### 13.1 Unterstützte Formate

Jede Bank exportiert CSV anders. Der Parser erkennt das Format automatisch:

```typescript
interface BankFormat {
  name: string;
  detectHeader: (headers: string[]) => boolean;
  mapColumns: {
    date: string;           // Spaltenname für Buchungsdatum
    amount: string;         // Spaltenname für Betrag
    reference: string;      // Spaltenname für Verwendungszweck
    // Alle anderen Spalten werden ignoriert
  };
  parseAmount: (raw: string) => number;  // "1.234,56" vs "1234.56"
  dateFormat: string;       // "DD.MM.YYYY" vs "YYYY-MM-DD"
}

const BANK_FORMATS: BankFormat[] = [
  {
    name: "sparkasse",
    detectHeader: (h) => h.includes("Buchungstag") && h.includes("Verwendungszweck"),
    mapColumns: {
      date: "Buchungstag",
      amount: "Betrag",
      reference: "Verwendungszweck",
    },
    parseAmount: (raw) => parseFloat(raw.replace('.', '').replace(',', '.')),
    dateFormat: "DD.MM.YY",
  },
  {
    name: "dkb",
    detectHeader: (h) => h.includes("Buchungsdatum") && h.includes("Verwendungszweck"),
    mapColumns: {
      date: "Buchungsdatum",
      amount: "Betrag (€)",
      reference: "Verwendungszweck",
    },
    parseAmount: (raw) => parseFloat(raw.replace('.', '').replace(',', '.')),
    dateFormat: "DD.MM.YYYY",
  },
  // Weitere Formate...
];
```

### 13.2 Neues Format hinzufügen

Wenn ein unbekanntes CSV-Format kommt, zeigt der Agent dem User die ersten 3 Zeilen und fragt:

```
Unbekanntes CSV-Format. Erste Zeile:
"Valuta";"Buchungstext";"Umsatz";"Währung"

Welche Spalte ist was?
[Valuta = Datum] [Umsatz = Betrag] [Buchungstext = Verwendungszweck]
```

Das neue Format wird gespeichert und beim nächsten Import automatisch erkannt.

---

## 14. Implementation Roadmap

**Voraussetzungen (beide zwingend):**
1. agent-memory v2-lite ist implementiert.
2. Das **Extension System** (eigenes PRD) ist implementiert — inklusive der Core-Voraussetzungen C1–C6 (§2.5 dort). Insbesondere C1 (offene `type`-Werte für `transaction`/`provider`) und C2 (semantische IDs `txn-…`) sind Blocker: ohne sie ist Billing nicht lauffähig.

### Phase 1: Import + Sanitizer (Woche 1)

- Billing Extension registrieren
- `billing_meta`-Tabelle
- CSV-Parser mit Sparkasse + DKB Format
- `sanitize()`-Funktion
- `extractProvider()` mit Basis-Anbieterliste
- `billing_import`-Tool
- Telegram: CSV empfangen → Import
- Tests: Sanitizer erkennt alle Pattern

> **Milestone:** Kontoauszug kann importiert und bereinigt werden. Buchungen werden als Einzeldateien gespeichert.

### Phase 2: Download + Matching (Woche 2)

- Playwright Setup
- 3-5 Anbieter-Downloader (Hetzner, Anthropic, Telekom, AWS, GitHub)
- PDF-Betrag-Extraktion (lokal)
- `billing_match`-Tool
- `billing_status`-Tool
- Automatisches Matching (Betrag-Vergleich)
- Connection: Buchung → Provider

> **Milestone:** Rechnungen werden automatisch heruntergeladen und abgeglichen.

### Phase 3: Übersicht + Telegram (Woche 3)

- `billing_overview`-Tool
- Telegram Commands (/billing, /billing match, /billing missing)
- Inline-Buttons für unbekannte Anbieter
- Monatlicher Digest (Cron)
- Wiederkehrende-Buchungen-Erkennung
- Erwartungs-Check (fehlt ein Anbieter?)

> **Milestone:** Vollständiger monatlicher Billing-Workflow über Telegram.

### Phase 4: Polish (Woche 4)

- Weitere Bank-Formate (ING, Commerzbank, N26)
- Weitere Anbieter-Downloader
- Generic Downloader für unbekannte Portale
- Jahresübersicht
- Duplikat-Erkennung bei erneutem Import
- Error Handling + Retry-Logik
- Tests

> **Milestone:** Billing Extension ist produktionsreif.

**Gesamt: 4 Wochen** (nach v2-lite + ggf. parallel zu IdeaForge)

---

## 15. Erfolgskriterien

| Metrik | Ziel | Messmethode |
|---|---|---|
| Sanitizer: Keine sensiblen Daten in API-Calls | 100% | Automated Audit auf API-Logs |
| Import-Genauigkeit | > 95% der Buchungen korrekt geparsed | Vergleich mit Original-CSV |
| Anbieter-Erkennung | > 80% automatisch erkannt | Known vs. Unknown Count |
| Rechnungs-Match-Rate | > 90% automatisch gematched | matched / total |
| False Matches | 0% | Stichproben-Review |
| Zeitersparnis | < 10 Min/Monat statt 1-2 Stunden | Zeitmessung |
| Langzeit-Stabilität | Buchungen über 12 Monate konsistent | Periodische Query |
| Deinstallation sauber | Keine Rückstände in knowledge/connections | Automatisierter Test |

> **Mess-Voraussetzung:** Die Prozent-Ziele (Import-Genauigkeit, Anbieter-Erkennung, Match-Rate) sind nur binär prüfbar gegen ein **committed Fixture-Set** — ein versionierter Satz realer (anonymisierter) Kontoauszüge + erwartete Ergebnisse unter `tests/fixtures/billing/`. **Externe Vorbedingung:** Diese Fixtures muss der Owner bereitstellen (echte anonymisierte Daten) — kein Coding-Task, sondern ein Gate, das vor der Acceptance-Prüfung erfüllt sein muss. „False Matches 0%" wird gegen dieses Set geprüft, nicht per Stichprobe. „Produktionsreif" (§14) ist kein Akzeptanzkriterium, sondern ein Sammel-Milestone — die binäre Definition ist: alle Tabellen-Ziele hier erfüllt + alle Tests grün.

---

## 16. Risiken

| Risiko | Impact | Mitigation |
|---|---|---|
| Bank ändert CSV-Format | Mittel | Format-Detection + User-Feedback |
| Anbieter-Portal ändert UI | Hoch | Playwright-Selektoren pro Anbieter pflegbar, Agent meldet Fehler |
| Sanitizer übersieht neues Pattern | Hoch | Regex-Tests mit realen Kontoauszügen, regelmäßig erweitern |
| PDF-Betrag-Extraktion scheitert | Mittel | Fallback: User bestätigt manuell |
| Doppel-Import gleicher CSV | Niedrig | Duplikat-Check auf Datum + Betrag + Provider + CSV-Zeilenindex (Tiebreaker gegen False-Skip identischer Buchungen) |
| Concurrent `billing_match` (Cron + manuell) | Niedrig (Single-User) | v1: dokumentierte Regel (Cron = einziger geplanter Writer) + atomares write-temp-then-rename. Echter Lock erst bei Multi-Device (§16) |

---

## 17. Deinstallation

```bash
agent-memory extensions uninstall billing
```

**Was passiert:**
1. `billing_meta`-Tabelle wird gelöscht
2. `ext.billing:`-Block aus Frontmatter entfernt
3. Tools werden deregistriert
4. Cron-Job wird gestoppt

**Was bleibt:**
- Buchungs-Dateien bleiben als `type: transaction` in knowledge
- Provider-Dateien bleiben als `type: provider`
- Connections bleiben erhalten
- Heruntergeladene PDFs in `/invoices/` bleiben
- Git-History bleibt

**Was manuell gelöscht werden muss:**
- `/invoices/`-Verzeichnis (enthält die PDFs)
- `~/.billing-credentials.yaml` (enthält Logins)

---

*Billing Extension v1.0 – fitznerIO AI Services – Februar 2026*
