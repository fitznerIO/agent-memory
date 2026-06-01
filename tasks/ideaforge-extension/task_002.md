# Task 002: Phase 2 — Pre-Processing (Voice/YouTube/Screenshot) + Research Agent

## Dependencies
- Requires: 001

## Description
(aus IdeaForge-PRD §4.2, §5, §8, §9 Phase 2)

**Pre-Processing-Tools** (§5, außerhalb agent-memory, im IdeaForge-Projekt):

| Tool | Technologie | Funktion | Fallback |
|---|---|---|---|
| whisper_transcribe | Whisper CLI (lokal) | Voice → Text | OpenAI Whisper API |
| youtube_transcript | yt-dlp | Video → Transcript | YouTube Transcript API |
| Screenshot | Haiku Vision | Screenshot → Text | – |
| fetch_url | readability-cli | URL → Clean Text (bereits Task 001) | Playwright Headless |
| web_search | SearXNG (self-hosted) | Websuche | DuckDuckGo (ddgr) |

**Research Agent (Sonnet)** (§4.2): Nach Intake, nur wenn `needs_research` erkannt: `web_search` + `fetch_url` (max 3×) → `memory_update()` mit Research-Inhalt → `idea_status(id, "active")`.

**Error Handling** (§8): Whisper Timeout (Retry 2× → OpenAI Fallback), URL nicht erreichbar (Playwright Fallback → nur URL speichern), API Rate Limit (Exponential Backoff → Queue), Haiku-Klassifizierung invalide (Schema-Validation → nur Raw Content), `ideaforge_meta` inkonsistent (Rebuild aus Frontmatter — Frontmatter ist Truth).

## Expected Outcome
- Alle Input-Typen funktionieren: Voice (Whisper + Fallback), YouTube (yt-dlp), Screenshot (Haiku Vision), URL, Text.
- Research Agent läuft nur bei `needs_research`, max 3 Recherche-Schritte, schreibt Ergebnis via `memory_update`, setzt Status `active`.
- Error-Handling/Fallbacks pro Input-Typ implementiert.

## Agent Context
Baut auf Task 001 (Intake-Kern) auf, unabhängig von Task 003. Erweitert die Erfassung um alle Medien-Typen und den optionalen Research-Schritt. Pre-Processing-Tools leben im IdeaForge-Projekt, nicht in der Extension.
