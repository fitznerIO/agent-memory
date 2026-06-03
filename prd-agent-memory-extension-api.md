# PRD: agent-memory v0.3.0 — Öffentliche Registrierung externer Extensions

**Version:** 0.3.0 (Minor, additiv, abwärtskompatibel)
**Datum:** 2026-05-31
**Owner:** Sascha
**Repo:** `github.com/fitznerIO/agent-memory` (Umsetzung erfolgt dort durch den Owner)
**Status:** Spec — bereit zur Umsetzung
**Anlass:** Voraussetzung für fioOS v0.8 (Spine = agent-memory + fioOS-eigene Extensions). Siehe `prd-fitznerio-os-0.8.md` §4.3.

> Diese Spec wurde gegen den **realen v0.2.0-Code** (Tag `v0.2.0`, Commit `372620f`) erstellt. Datei:Zeile-Angaben beziehen sich auf diesen Stand.

---

## 1. Problem

Das Extension-System (v0.2.0) ist intern voll funktionsfähig, aber **nur build-intern erweiterbar**: registrierbare Extensions stehen ausschließlich im statischen Array `AVAILABLE_EXTENSIONS` (`src/extensions/registry.ts`):

```ts
export const AVAILABLE_EXTENSIONS: Extension[] = [bookmarkExtension];
// Kommentar: "Explicit and static — no folder scanning, no dynamic imports.
//             Adding an extension = one entry here."
```

Alle Zugriffe (`installExtensionByName`, `uninstallExtensionByName`, `listExtensions`, `extensionStatus`, `start()→loadExtensions`) lesen ausschließlich dieses Array. `createMemorySystem(overrides?)` nimmt **keine** Extensions entgegen; `index.ts` re-exportiert weder die Extension-Typen noch `installExtension`/`loadExtensions`. Das `package.json` exportiert nur `"."`.

**Konsequenz:** Ein **Consumer**, der agent-memory als Dependency einbindet (z. B. **fioOS**, das die Library als read-only npm/GitHub-Dependency nutzt), kann **keine eigene Extension** registrieren. Er müsste `AVAILABLE_EXTENSIONS` in der Library editieren — was bei einer Dependency nicht geht und die generische Library an Consumer-Domänen koppeln würde.

fioOS v0.8 setzt aber genau darauf: Domänendaten (`lead`, `campaign`, `run`, `task`) als **fioOS-eigene Extensions**. Das ist mit v0.2.0 nicht umsetzbar.

---

## 2. Ziel & Nicht-Ziele

**Ziel:** Eine **öffentliche, abwärtskompatible API**, mit der ein Consumer beim Erzeugen des MemorySystems **eigene Extensions** mitgibt — gleichberechtigt zu den eingebauten, über denselben Lifecycle (`install`/`uninstall`/`load`/`status`).

**Nicht-Ziele:**
- Kein Folder-Scanning / dynamisches Import-Laden (bleibt explizit, wie vom Library-Prinzip vorgesehen).
- Keine Änderung am Extension-Modell selbst (`Extension`-Interface, Lifecycle, `<name>_meta`-Mechanik bleiben unverändert).
- Kein Plugin-Marketplace, keine Runtime-Discovery.
- Keine Änderung an der Modul-Isolation (shared/ importiert weiterhin nicht aus extensions/).

---

## 3. Aktueller Zustand (Ist) — relevante Stellen

| Stelle | Datei:Zeile | Verhalten |
|---|---|---|
| Statisches Registry-Array | `src/extensions/registry.ts` | `AVAILABLE_EXTENSIONS = [bookmarkExtension]` |
| Factory | `src/index.ts:236` | `createMemorySystem(overrides?: Partial<MemoryConfig>)` — kein Extensions-Parameter |
| install | `src/index.ts:1360-1364` | `AVAILABLE_EXTENSIONS.find(...)` |
| uninstall | `src/index.ts:1366-1370` | `AVAILABLE_EXTENSIONS.find(...)` |
| list | `src/index.ts:1372-1382` | `AVAILABLE_EXTENSIONS.map(...)` |
| status | `src/index.ts:1384-1409` | `AVAILABLE_EXTENSIONS.find(...)` |
| load (start) | `src/index.ts:1460-1465` | `loadExtensions({ ..., available: AVAILABLE_EXTENSIONS })` |
| Typ-Exports | `src/index.ts:37-…` | `export type { … }` — enthält **keine** Extension-Typen |

**Modul-Isolation (aus agent-memory `CLAUDE.md`):** Module dürfen nur aus `../shared/*` und dem eigenen Verzeichnis importieren; `src/index.ts` ist der einzige Integrationspunkt und darf aus allen Modulen importieren. → `shared/config.ts` (wo `MemoryConfig` lebt) darf **nicht** aus `extensions/` importieren. Das bestimmt das API-Design (siehe §5).

---

## 4. Ziel-Zustand (Soll) — die API

`createMemorySystem` erhält einen **zweiten, optionalen** Parameter für externe Extensions:

```ts
export interface CreateMemoryOptions {
  /** Vom Consumer definierte Extensions, zusätzlich zu den eingebauten. */
  extensions?: Extension[];
}

export function createMemorySystem(
  overrides?: Partial<MemoryConfig>,
  opts?: CreateMemoryOptions,
): MemorySystem;
```

**Warum zweiter Parameter statt `MemoryConfig.extensions`?** Weil `MemoryConfig` in `shared/config.ts` lebt und shared/ laut Modul-Isolation nicht aus `extensions/` importieren darf — ein `Extension[]`-Feld dort würde die Isolation brechen. `createMemorySystem` liegt in `index.ts` (Orchestrator) und darf aus `extensions/` importieren. Der zweite Parameter ist zudem für künftige Optionen erweiterbar. (Alternative siehe §9.)

Die eingebauten und externen Extensions werden zu **einer** Liste gemergt (Namenskollision = Fehler), und **alle** bestehenden Zugriffsstellen nutzen diese gemergte Liste.

---

## 5. Änderungsplan (konkret)

### 5.1 `src/index.ts` — Import (Zeile 17)
`ExtensionContext` wird bereits importiert; `Extension` ergänzen:
```ts
import type { Extension, ExtensionContext } from "./extensions/types.ts";
```

### 5.2 `src/index.ts` — Signatur + Merge (ab Zeile 236)
```ts
export interface CreateMemoryOptions {
  extensions?: Extension[];
}

export function createMemorySystem(
  overrides?: Partial<MemoryConfig>,
  opts?: CreateMemoryOptions,
): MemorySystem {
  const config = { ...createDefaultConfig(), ...overrides };

  // Eingebaute + externe Extensions zusammenführen. Namenskollision = Fehler,
  // damit ein Consumer keine eingebaute Extension still überschreibt.
  const available = mergeExtensions(AVAILABLE_EXTENSIONS, opts?.extensions ?? []);
  // …rest unverändert…
}

/** Modul-lokaler Helper (oben/unten in index.ts). */
function mergeExtensions(builtin: Extension[], external: Extension[]): Extension[] {
  const byName = new Map<string, Extension>(builtin.map((e) => [e.name, e]));
  for (const e of external) {
    if (byName.has(e.name)) {
      throw new Error(`Extension name already registered: "${e.name}"`);
    }
    byName.set(e.name, e);
  }
  return [...byName.values()];
}
```

> **Scope:** `const available = mergeExtensions(…)` wird direkt nach `const config` im Funktionskörper von `createMemorySystem` deklariert (Ausgangsstand ~Z.239); `mergeExtensions` ist ein modul-lokaler Helper in `index.ts`. `available` ist per Closure für **alle** `system`-Methoden und `start()` sichtbar — genau wie `config`.

### 5.3 `src/index.ts` — die 5 Zugriffsstellen auf `available` umstellen
`AVAILABLE_EXTENSIONS` → `available` (das closure-lokale gemergte Array) an:
- `:1361` (`installExtensionByName`)
- `:1367` (`uninstallExtensionByName`)
- `:1376` (`listExtensions`)
- `:1385` (`extensionStatus`)
- `:1464` (`start()` → `loadExtensions({ …, available })`)

Der `import { AVAILABLE_EXTENSIONS }` (Zeile 16) bleibt — es ist die Basis des Merges.

> **Zeilennummern:** beziehen sich auf den **Ausgangsstand** (v0.2.0); nach dem Einfügen von §5.2 verschieben sie sich um den Einschub-Offset. Die fünf Stellen sind eindeutig über ihren **Funktionsnamen** zu finden (`installExtensionByName`, `uninstallExtensionByName`, `listExtensions`, `extensionStatus`, `start`).

### 5.4 `src/index.ts` — Typ-Exports ergänzen
Damit ein Consumer eine Extension **typsicher** definiert — inkl. Tool-Handler, die `ctx.log` (`Logger`) bzw. `ctx.memory.search()` (`SearchFilters`/`MemorySearchHit`) nutzen — die Extension-Typen öffentlich re-exportieren (eigener Block, da sie aus `extensions/types.ts` stammen):
```ts
export type {
  Extension,
  ExtensionTool,
  ExtensionColumn,
  ExtensionSchema,
  ExtensionKnowledgeType,
  ExtensionContext,
  ExtensionDB,
  MemoryAPI,
  Logger,
  SearchFilters,
  MemorySearchHit,
} from "./extensions/types.ts";
```
`CreateMemoryOptions` ist **bereits** durch das `export interface` in §5.2 öffentlich — **kein** zusätzlicher Re-Export (insbesondere **kein** `export … from "./index.ts"` aus derselben Datei).

### 5.5 `package.json`
- `"version": "0.3.0"`.
- `bun run build` ausführen, damit `dist/index.d.ts` die neuen Exports enthält (greift für npm-Consumer; GitHub-Dep-Consumer nutzen ohnehin `src` über den `bun`-Export).

### 5.6 Tag
Nach Merge: Git-Tag **`v0.3.0`** setzen + pushen, damit Consumer (fioOS) darauf pinnen können (`github:fitznerIO/agent-memory#v0.3.0`).

---

## 6. API-Beispiel (Consumer-Sicht, fioOS)

```ts
import { createMemorySystem, type Extension } from "agent-memory";

const leadExtension: Extension = {
  name: "lead",
  version: "1.0.0",
  description: "fioOS lead pipeline metadata",
  schema: {
    table: "lead_meta",
    columns: [
      { name: "status", type: "TEXT", notNull: true },
      { name: "score", type: "REAL", default: "0" },
      { name: "source", type: "TEXT" },
      { name: "company", type: "TEXT" },
    ],
  },
  knowledgeTypes: [
    { type: "lead", dir: "semantic/leads", v1Type: "semantic", idPrefix: "lead" },
  ],
  tools: [
    {
      name: "lead_add",
      description: "Create a lead (knowledge entry + lead_meta row)",
      inputSchema: { type: "object", properties: { company: { type: "string" } }, required: ["company"] },
      async handler(input, ctx) {
        const { company } = input as { company: string };
        const id = await ctx.memory.store({ title: company, type: "lead", content: `Lead: ${company}`, tags: ["lead"] });
        ctx.db.run("INSERT INTO lead_meta (entry_id, status, source, company) VALUES (?, 'new', 'manual', ?)", [id, company]);
        await ctx.memory.setExtensionData(id, "lead", { status: "new", company });
        return { id };
      },
    },
  ],
};

const mem = createMemorySystem(
  { baseDir: "./data/.agent-memory" },
  { extensions: [leadExtension] },   // ← neu in v0.3.0
);
await mem.start();
await mem.installExtensionByName("lead");   // greift jetzt, weil gemergt
// installExtensionByName aktiviert die Extension in-process: ihre Tools sind
// sofort dispatchbar (kein zweites start() nötig).
```

---

## 7. Testing

Neuer Test `tests/extensions/external-extension.test.ts` (Vorlage: `tests/extensions/reference-extension.test.ts`, Helper `createTempDir`/`cleanupTempDir` aus `tests/helpers/fixtures.ts`):

| Test | Erwartung |
|---|---|
| Externe Extension registrieren | `createMemorySystem(cfg, { extensions: [testExt] })` → `start()` → `installExtensionByName("test")` legt `test_meta` an |
| Tool + Daten | Tool-Handler erzeugt Knowledge-Entry + `test_meta`-Row; `getExtensionData(id, "test")` liefert die Frontmatter zurück |
| list/status | `listExtensions()` enthält die externe Extension; `extensionStatus("test")` zeigt sie + rowCount |
| Knowledge-Type | von der Extension eingeführter Knowledge-Type ist nach `start()` registriert (sequentielle ID `<idPrefix>-NNN`) |
| Namenskollision | externe Extension mit Namen `"bookmark"` → `createMemorySystem` wirft `Extension name already registered` |
| Abwärtskompatibilität | `createMemorySystem(cfg)` **ohne** `opts` verhält sich exakt wie v0.2.0; alle bestehenden Tests laufen unverändert grün |
| uninstall | `uninstallExtensionByName("test")` droppt `test_meta` + bereinigt `ext.test`-Frontmatter |

> **Test-Isolation:** Die Knowledge-Type-Registry (`shared/knowledge-types.ts`) ist ein **prozess-globaler Singleton** und wirft bei doppeltem `type`/`idPrefix`. Die Test-Extension nutzt daher einen **einzigartigen** `type`/`idPrefix` (z. B. `test`/`tst`), und `afterAll` ruft `unregisterKnowledgeType("test")` (Helper in `shared/knowledge-types.ts:96`), damit wiederholte/parallele Läufe nicht kollidieren.

`bun test` (gesamte Suite) + `bun run typecheck` müssen grün sein.

---

## 8. Abwärtskompatibilität & Versionierung

- **Rein additiv:** `opts` ist optional; ohne Angabe ist `available === AVAILABLE_EXTENSIONS`-Inhalt → unverändertes Verhalten. Kein bestehender Call-Site bricht.
- Keine Signaturänderung an `MemoryConfig`, keine Änderung am `Extension`-Interface.
- Neue **öffentliche Typ-Exports** sind additiv.
- → **Minor-Bump auf 0.3.0**, Tag `v0.3.0`.

---

## 9. Offene Designfragen (Owner entscheidet)

1. **Zweiter Parameter vs. `MemoryConfig.extensions`.** Vorschlag: zweiter Parameter (Isolation-konform, s. §4). Alternative: `Extension`-Typ nach `shared/types.ts` ziehen und `MemoryConfig.extensions` einführen — eleganter für den Consumer (`createMemorySystem({ baseDir, extensions })`), aber invasiver (Typ-Umzug, berührt die Modulgrenzen). Empfehlung: zweiter Parameter.
2. **Namenskollision: Fehler vs. „extern gewinnt".** Vorschlag: **Fehler** (verhindert stilles Überschreiben eingebauter Extensions). Falls Override gewünscht ist, stattdessen letzte gewinnt + Warn-Log.
3. **`installExtension`/`loadExtensions`/`uninstallExtension` als Funktionen exportieren?** Für v0.8 **nicht nötig** (der Consumer nutzt `createMemorySystem(_, {extensions})` + `installExtensionByName`). Nur exportieren, wenn ein Consumer den Lifecycle ohne MemorySystem fahren will (YAGNI → weglassen).
4. **`extensions install <name>` (CLI):** Die CLI (`src/cli.ts`) baut das System ohne externe Extensions — externe Extensions sind nur über die **Library-API** verfügbar (der Consumer-Prozess kennt sie). Das ist für fioOS korrekt (fioOS ruft die Library, nicht die agent-memory-CLI). Kein CLI-Change nötig; ggf. in der Doku klarstellen.
5. **Knowledge-Type-Registry ist prozess-global.** `registerKnowledgeType` (`shared/knowledge-types.ts`) mutiert ein Modul-Singleton (prozessweit, nicht system-lokal) und wirft bei `type`/`idPrefix`-Kollision. Relevant für Consumer mit **mehreren** `createMemorySystem`-Instanzen oder Tests im selben Prozess; Teardown via `unregisterKnowledgeType`. Kein Blocker für v0.3.0 — nur dokumentieren.

---

## 10. Akzeptanzkriterien

- [ ] `createMemorySystem(overrides?, opts?)` akzeptiert `opts.extensions: Extension[]`.
- [ ] Eingebaute + externe Extensions werden gemergt; alle 5 Zugriffsstellen nutzen die gemergte Liste.
- [ ] Namenskollision wirft einen klaren Fehler.
- [ ] `Extension` & die zugehörigen Typen sind aus `agent-memory` importierbar.
- [ ] Eine extern definierte Extension lässt sich installieren, ihr Tool nutzen, Daten via `get/setExtensionData` lesen/schreiben, und wieder deinstallieren.
- [ ] Ohne `opts` unverändertes Verhalten; gesamte bestehende Test-Suite + `typecheck` grün.
- [ ] `version` = `0.3.0`, Tag `v0.3.0` gepusht.
