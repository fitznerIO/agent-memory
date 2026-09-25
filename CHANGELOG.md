# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`--quiet` for `note`, `store`, `update` and `connect`** (#12): one line instead
  of JSON, e.g. `stored dec-012 semantic/decisions/dec-012-….md`. On a real store
  a plain `store` answers with about 400 lines, almost all of them
  `existing_tags`; an agent took such a successful call for a failure. A result
  with `success: false` is still printed in full, and `update` says when the
  search index was not updated.
- **The CLI warns when it is about to create an empty store.** Running from the
  wrong working directory used to build a fresh, empty store in silence — every
  search then came back with nothing, indistinguishable from a store without a
  match. The warning goes to stderr, so stdout stays parseable JSON.

### Fixed

- **No more `dtype not specified` warning on every call** (#12). The embedding
  pipeline is now created with `dtype: "auto"` — exactly what the library does
  without a dtype (the model's own setting, else fp32 on CPU), minus the warning.
  The vectors are identical (checked) and stored indexes stay valid.
- **`relevance` in `suggested_connections` is rounded to three decimals.**
- **Rare words are no longer buried by vector neighbours** (#7). An entry found by
  only one search channel got the length of the *other* channel's result list plus
  one as its substitute rank; for a rare word full-text returns one row, so "missing from
  full-text" scored almost like a full-text rank 1 and most vector neighbours
  outranked the one exact match. Both channels now use `poolSize + 1`. On a copy of
  a real 503-entry store, words that stand in exactly one entry reached the top 5
  of the default search in 31 of 33 cases (before: 4); none of the measured
  queries got worse. It does not guarantee position 1.
- **Numeric CLI flags are validated** (#9). `--limit` must be a whole number from 1
  to 200, `--depth` a whole number above 0, `--min-score` a number from 0 to 1;
  anything else (`-1`, `abc`, an empty value, `--limit 0`, `--limit 300`,
  `--min-score 1.5`) stops with `Invalid --limit: -1 (expected a whole number from 1
  to 200)` instead of failing in SQLite with `k value in knn queries must be >= 0`,
  `datatype mismatch` or `k value in knn query too large`. Values are read as
  numbers, not with `parseInt`: `--limit 1e1` now means 10 (was 1).
- **The README matches the code again** (#9): what the normalised score means
  (ordinal within one response, not a relevance measure; also on
  `MemorySearchOutput.score`), that `limit` is part of the ranking, the real default
  weights, model and `minScore`, and an RRF example that can actually occur.
- **The CLI refuses to create a store inside a store** (#10). A store has its own
  `.git`, so the project-root walk from anywhere inside `<proj>/.agent-memory/…`
  stopped at the store itself and used `<proj>/.agent-memory/.agent-memory` — a
  new, empty store that nothing else reads, while `note` and `store` reported
  success. Every command that opens a store now stops with exit code 1 and a
  message naming the enclosing store and the project root, and creates nothing.
  Every write location is checked — the project store (also via `--project-dir` /
  `--base-dir`), the search index (`--sqlite-path`) and the global store
  (`--global-dir`) — with symlinks resolved.
- **`forget` only deletes entries that contain the query** (#8). It used to delete
  every hybrid search result above `minScore 0.3`, but that score is min-max
  normalised per call, so the best candidate always scored 1.0 — a query that
  matched nothing still deleted up to ten unrelated files, and `--scope entry`
  searched at limit 1, where the one entry containing the word could lose to its
  nearest vector neighbour. Candidates now have to be full-text matches whose title
  or text also contains the query as a phrase — its words as whole words, in
  order, only spaces or punctuation between them, case-insensitive. Full-text
  search alone expands German prefixes (`Vertrages` would have matched
  `Betrages`), drops one-letter words and reads a bare `OR` as an operator. Among
  the candidates the hybrid ranking picks the order. A query that matches nothing
  deletes nothing and says so. A query that is one entry id (`dec-012`, `note 130`,
  `DEC‑012`, `note #130`, a UUID; case, any spaces or punctuation between prefix
  and number, and surrounding punctuation ignored) deletes exactly that entry, or
  nothing — also `session 3`, even if an entry contains those words; a query with
  ids in a list or a sentence is refused — as text it matched exactly the entries
  citing those ids. The CLI rejects a `--scope` other
  than `entry`/`topic` and a `--query` without a value.
- **Search no longer crashes on hyphenated queries.** `sanitizeFtsQuery` used a
  split regex (`/\b(\w+)-(\w+)\b/g`) that missed chained hyphens and non-ASCII
  words, so `"2026-08-27"` and `"NEUSTART-ÜBERGABE"` reached FTS5 with a hyphen
  intact — which FTS5 reads as column-exclusion syntax and rejects with
  `no such column: <token>`. Sanitizing is now a whitelist (`\p{L}\p{N}_` plus
  whitespace, unicode-aware), so umlauts survive and no punctuation can leak
  through. Comma and semicolon were failing the same way and are covered too.
- **A rejected FTS query no longer takes down hybrid search.** `searchText` now
  returns an empty result and logs a warning when FTS5 refuses to parse the
  MATCH expression, so the vector half still runs and the caller gets fewer
  results rather than none. Only parse errors are swallowed — a missing table,
  a closed database or an I/O error still throws, because that is a bug in the
  index rather than bad user input.
- **`update --mode append` appends instead of replacing.** The mode was parsed by
  the CLI and then dropped, so an append silently overwrote the existing body.
  `MemoryUpdateInput` now carries `mode?: "replace" | "append"` (default
  `"replace"`, unchanged behaviour); append keeps the current body and adds the
  new content after a blank line. The reported diff quotes the length actually
  written, not the input length — that mismatch is why a shrinking file looked
  like a normal update.
- **An unknown `--mode` is rejected** instead of falling back to `replace`. The
  flag decides whether the existing body survives; a typo used to overwrite it
  without a word.

## [0.3.0] — 2026-06-01

### Added

- **Public extension registration for consumers.** `createMemorySystem` now takes
  an optional second argument, `{ extensions?: Extension[] }`, so a project that
  uses agent-memory as a dependency can register its own extensions alongside the
  built-in ones — same lifecycle (`install` / `uninstall` / `load` / `status`),
  no need to edit the library.
- **Public extension-authoring types** re-exported from the package entry point:
  `Extension`, `ExtensionTool`, `ExtensionColumn`, `ExtensionSchema`,
  `ExtensionKnowledgeType`, `ExtensionContext`, `ExtensionDB`, `MemoryAPI`,
  `Logger`, `SearchFilters`, `MemorySearchHit` — so consumers can define
  extensions and tool handlers in a fully typed way.
- `CreateMemoryOptions` interface for the new options argument.

### Changed

- `installExtensionByName` / `uninstallExtensionByName` now keep the in-process
  loaded-extension set in sync, so a freshly installed extension's tools are
  dispatchable immediately — no second `start()` required.

### Notes

- Built-in and consumer extensions are merged into one list; a **name collision
  throws** (a consumer cannot silently shadow a built-in extension).
- Consumer-defined extensions are available through the **library API only** —
  the `agent-memory` CLI builds the system without them (it has no way to know
  them). Their tools run in the consumer's process via the dispatch map.
- Backward compatible: calling `createMemorySystem(overrides)` without the second
  argument behaves exactly as in 0.2.0.

## [0.2.0] — 2026-06-01

### Added

- **Extension system** — a plugin layer that adds domain-specific data and tools
  without changing the core schema. Each extension gets:
  - its own SQLite table (`<name>_meta`, with `FOREIGN KEY (entry_id) REFERENCES
    knowledge(id) ON DELETE CASCADE`),
  - its own `ext.<name>` frontmatter namespace,
  - its own knowledge types (resolved through a runtime registry),
  - its own tools, dispatched from the CLI as `agent-memory <tool> --flags`.
- **Runtime knowledge-type registry** (`src/shared/knowledge-types.ts`) — extensions
  register their own `knowledge.type` values (directory, v1 mapping, ID prefix)
  at install/startup instead of being limited to the built-in closed set.
- **Extension CLI commands** — `extensions list | install <name> | uninstall <name>
  | status <name>`.
- **Core extension API** on `MemorySystem` — `setExtensionData` / `getExtensionData`
  (read/write an entry's `ext.<name>` block), plus `installExtensionByName`,
  `uninstallExtensionByName`, `listExtensions`, `extensionStatus`,
  `getLoadedExtensions`.
- **`searchIndex.extensionDb()`** — a scoped, synchronous DB accessor (run/get/all)
  over the project store's connection, so extension tables share `foreign_keys=ON`
  and CASCADE fires correctly.
- **Reference extension** (`src/extensions/examples/bookmark.ts`) validating the
  full install → use → forget (CASCADE) → uninstall lifecycle end to end.
- Documentation: extension system documented in `README.md` and `CLAUDE.md`.

### Changed

- `MemoryStoreInput.type` and `KnowledgeEntry.type` widened to
  `KnowledgeType | (string & {})` so extensions can use their own registered
  types while built-in types keep autocomplete. Backward compatible.
- Markdown parsing/serialization moved to `src/shared/markdown.ts` so every module
  can use it without a cross-module import; `src/memory/parser.ts` re-exports it
  for compatibility.

### Fixed

- `forget()` now removes the v2-lite `knowledge` row (and its tags/connections),
  not just the v1 `memories` row — so deleting an entry correctly cascades to any
  extension `<ext>_meta` table.
- `rebuild-index` no longer wipes extension tables: `resetAll()` suppresses foreign
  keys during the knowledge wipe, and `rebuildIndex` reconciles each extension
  table afterward (pruning only rows orphaned by a deleted Markdown file).

## [0.1.0]

### Added

- Core persistent memory system: Markdown files as the source of truth, SQLite as
  a derived index, Git for versioning.
- **Hybrid search** — FTS5 keyword matching + sqlite-vec vector similarity merged
  via Reciprocal Rank Fusion, with local embeddings (no API calls).
- **Knowledge graph** — structured knowledge types with sequential IDs,
  bidirectional connections, hierarchical namespace tags, and connection discovery.
- **Git versioning** via isomorphic-git with semantic commit messages.
- **Consolidation** of session notes into knowledge files (heuristic, no LLM).
- **Decay** — archive-candidate detection based on access patterns.
- **Migrations** — split-files, namespace-tags, discover-connections.
- CLI (`agent-memory`) and a programmatic API (`createMemorySystem()`).
- Per-project and optional global memory stores.

[0.3.0]: https://github.com/fitznerIO/agent-memory/releases/tag/v0.3.0
[0.2.0]: https://github.com/fitznerIO/agent-memory/releases/tag/v0.2.0
[0.1.0]: https://github.com/fitznerIO/agent-memory/releases/tag/v0.1.0
