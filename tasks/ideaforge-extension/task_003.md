# Task 003: Phase 3 — idea_resurface + idea_digest + Cluster-Detection + Cron + Telegram-Buttons

## Dependencies
- Requires: 001

## Description
(aus IdeaForge-PRD §3.3, §3.4, §4.3, §6, §9 Phase 3)

**idea_resurface-Tool** (§3.3): Findet Ideen, die Aufmerksamkeit brauchen. Modi `stale | clusters | decay_warning | all`. Keine LLM-Kosten — nur SQL + lokale Aggregation.

- **Stale**: unprocessed > 7 Tage, NICHT in letzten 3 Tagen gezeigt (`last_resurfaced_at`-Cooldown gegen Digest-Spam). Nach Digest: `UPDATE ideaforge_meta SET last_resurfaced_at = now` für gezeigte Einträge.
- **Cluster**: SQL liefert PAARE (Ideen mit ≥ 2 gemeinsamen Tags, beide `active`). SCHRITT 2 in TS: Union-Find über die Paare → Connected Components mit ≥ 3 Membern = Cluster. `theme` = häufigster shared_tag. Die rohe SQL allein erfüllt den `{theme, member_ids[], shared_tags[]}`-Vertrag NICHT.
- **Decay Warnings**: `urgency=now`, `status=active`, keine Aktion seit 3 Tagen.

**idea_digest-Tool** (§3.4): Formatiert Resurface-Ergebnisse als Telegram-Text + Inline-Buttons.

**Cluster-Handling** (§4.3): Cluster sind keine eigene Entität. Bei „Details?": Opus bekommt Cluster-Ideen → Synthese → `idea_store(type="synthesis", connections=[part_of zu allen Membern])`. Kein Cluster-Lifecycle, keine Cluster-Tabelle.

**Cron + Telegram-Buttons** (§6): Täglich 09:00 → `idea_resurface(mode="all")` → `idea_digest` → Telegram. Buttons: 🗑️ `archive:{id}`, 📌 `keep:{id}` (resettet updated_at), 🚀 `project:{id}`, 🔍 `details:{id}`.

## Expected Outcome
- `idea_resurface` liefert stale (mit Cooldown), clusters (via Union-Find, ≥3 Member), decay_warnings — reine SQL + Aggregation, $0 LLM.
- `idea_digest` formatiert Telegram-Nachricht + Buttons.
- Täglicher Cron-Digest läuft; Buttons rufen `idea_status` korrekt.
- Cluster-Synthese (Opus) als `synthesis`-Eintrag (`syn-NNN`) mit part_of-Connections.
- Resurface-Loop terminiert (📌/🗑️ entfernen Idee aus stale/decay-Set); kein Endlos-Spam (Cooldown).

## Agent Context
Baut auf Task 001 (Ideen + Status + ideaforge_meta) auf, unabhängig von Task 002. Liefert das Kernfeature: Ideen werden nicht vergessen, sondern täglich kuratiert vorgelegt. Cluster-Detection ist hier das Herzstück.
