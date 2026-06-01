# Task 001: Phase 1 — Extension-Registrierung + Schema + idea_store + idea_status + Telegram-Intake (Text/URL)

## Dependencies
- Requires: extension-system/007 (validiertes Extension System)

## Description
(aus IdeaForge-PRD §2, §3.1, §3.2, §9 Phase 1)

**Extension-Definition** (`src/extensions/ideaforge/index.ts`):

```typescript
export const ideaforgeExtension: Extension = {
  name: "ideaforge",
  version: "1.1.0",
  description: "Autonomous Second Brain",
  knowledgeTypes: [
    { type: "idea",      dir: "semantic/ideas",     v1Type: "semantic", idPrefix: "idea" },
    { type: "synthesis", dir: "semantic/syntheses", v1Type: "semantic", idPrefix: "syn" },
  ],
  schema: {
    table: "ideaforge_meta",
    columns: [
      { name: "status", type: "TEXT", default: "'unprocessed'" },
      { name: "urgency", type: "TEXT", default: "'someday'" },
      { name: "source_type", type: "TEXT", default: "'text'" },
      { name: "source_url", type: "TEXT" },
      { name: "last_resurfaced_at", type: "TEXT" },   // Snooze-Cooldown
    ],
  },
  tools: [ ideaStore, ideaResurface, ideaStatus, ideaDigest ],
  async onInstall(ctx) {
    ctx.db.run(`CREATE INDEX idx_if_status ON ideaforge_meta(status)`);
    ctx.db.run(`CREATE INDEX idx_if_urgency ON ideaforge_meta(urgency)`);
  },
  async onUninstall(ctx) { await cleanFrontmatterNamespace(ctx.memoryPath, "ideaforge"); },
};
```

**idea_store-Tool** (§3.1): Wrapper um `memory_store` mit IdeaForge-Feldern + Pre-Processing. Intern: falls `title`/`tags` fehlen → Haiku-Call zur Klassifizierung (Raw-Content → strukturiert `{title, tags[]}`, Schema-validiert; Fallback bei invalide: nur Raw Content speichern) → `memory_store(type="idea")` (IDs `idea-NNN`) → `ideaforge_meta`-Row → `ext.ideaforge`-Block ins Frontmatter (via `setExtensionData`) → suggested connections + existing tags zurück.

**idea_status-Tool** (§3.2): Status ändern (`unprocessed|active|archived|project`, optional `project_name`). Transitions inkl. `active → active` (📌, resettet `updated_at`), `archived → active` (Resurface).

**Telegram-Intake (Phase 1, Text/URL)**: Nachrichten empfangen → `idea_store`. Pre-Processing für Text (direkt) und URL (readability-cli → Clean Text). Voice/YouTube/Screenshot kommen in Task 002.

## Expected Outcome
- `ideaforgeExtension` registriert; Install erstellt `ideaforge_meta` (mit `last_resurfaced_at`) + Indizes, registriert `idea`/`synthesis`.
- `idea_store` erzeugt `idea`-Einträge (IDs `idea-NNN`), schreibt `ideaforge_meta` + `ext.ideaforge`-Frontmatter, klassifiziert per Haiku wenn nötig (mit Fallback).
- `idea_status` setzt Status korrekt inkl. updated_at-Reset bei 📌.
- Telegram-Bot erfasst Text-Ideen und Links.
- Tool-Stubs `ideaResurface`/`ideaDigest` existieren (Task 003).

## Agent Context
Erste IdeaForge-Aufgabe; baut auf dem validierten Extension System (Task 007 dort) auf. Liefert Erfassung + Klassifizierung + Status — der Kern, auf dem Pre-Processing (Task 002) und Resurface (Task 003) unabhängig aufsetzen.
